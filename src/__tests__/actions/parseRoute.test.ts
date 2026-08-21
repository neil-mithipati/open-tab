import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const isParseRateLimited = vi.fn();
const extractStoragePath = vi.fn();
const parseReceiptImage = vi.fn();

// Mutable stand-in for the two tables this route touches. `receipt` is the row
// the ownership lookup returns; the update the route makes after a parse writes
// back into it, so a replayed request sees what the first one stored.
type Row = Record<string, unknown> | null;
type DbError = { message: string; code?: string } | null;
const db: {
  receipt: Row;
  itemCount: number;
  // Model attempts the caller has spent this hour on OTHER receipts. The
  // receipt under test adds its own — see attemptedThisHour.
  otherAttemptsThisHour: number;
  // Set to make the claim's conditional update fail, the way an unapplied
  // migration 0020 or 0025 would.
  claimError: DbError;
  // Set to make the release of a claim fail without touching anything else.
  releaseError: DbError;
  // Set to make the post-parse write-back fail without touching the claim.
  writeBackError: DbError;
  // Set to make the hourly attempt count fail, the way an unapplied 0025 would.
  attemptCountError: DbError;
} = {
  receipt: null,
  itemCount: 0,
  otherAttemptsThisHour: 0,
  claimError: null,
  releaseError: null,
  writeBackError: null,
  attemptCountError: null,
};
const spies = {
  receiptUpdate: vi.fn(),
  receiptDelete: vi.fn(),
  itemsInsert: vi.fn(),
  storageRemove: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => {
  // The claim is a conditional update — `.eq(...).eq(...).is("parsed_at",
  // null).select("id")` — so the mock has to model filters rather than assume
  // a fixed chain shape. A single builder collects them, matches the row
  // itself, and is awaitable like a real PostgrestFilterBuilder, which is what
  // makes the atomicity testable: whichever request applies its update first
  // flips parsed_at, and every later one matches nothing.
  type Filters = { eq: [string, unknown][]; isNull: string[] };

  const matchesRow = (filters: Filters): boolean => {
    const row = db.receipt;
    if (!row) return false;
    if (!filters.eq.every(([col, val]) => row[col] === val)) return false;
    return filters.isNull.every((col) => row[col] === null || row[col] === undefined);
  };

  interface WriteBuilder<T> extends PromiseLike<T> {
    eq(col: string, val: unknown): WriteBuilder<T>;
    is(col: string, val: unknown): WriteBuilder<T>;
    select(cols?: string): Promise<T>;
  }

  function writeBuilder<T>(filters: Filters, run: () => T): WriteBuilder<T> {
    const builder: WriteBuilder<T> = {
      eq(col, val) {
        filters.eq.push([col, val]);
        return builder;
      },
      is(col, val) {
        if (val === null) filters.isNull.push(col);
        return builder;
      },
      select: async () => run(),
      then: (onOk, onErr) => Promise.resolve(run()).then(onOk, onErr),
    };
    return builder;
  }

  // Every model attempt this caller has made inside the hourly window: the
  // receipt under test counts its own the moment it has been claimed once
  // (0025's last_parse_attempt_at survives a release), plus whatever other
  // receipts the test says the caller spent.
  const attemptedThisHour = () => {
    const rows: { parse_attempts: number | null }[] = [];
    if (db.otherAttemptsThisHour > 0) {
      rows.push({ parse_attempts: db.otherAttemptsThisHour });
    }
    const row = db.receipt;
    if (row && row.last_parse_attempt_at) {
      rows.push({ parse_attempts: (row.parse_attempts as number | null) ?? 0 });
    }
    return rows;
  };

  // Two read shapes on `receipts`, so one builder serves both: the ownership
  // lookup ends in .single(), and the hourly attempt count is awaited straight
  // off .gte().
  interface ReadBuilder
    extends PromiseLike<{ data: { parse_attempts: number | null }[] | null; error: DbError }> {
    eq(col: string, val: unknown): ReadBuilder;
    gte(col: string, val: unknown): ReadBuilder;
    single(): Promise<{ data: Row }>;
  }

  function readBuilder(): ReadBuilder {
    const run = () =>
      db.attemptCountError
        ? { data: null, error: db.attemptCountError }
        : { data: attemptedThisHour(), error: null };
    const builder: ReadBuilder = {
      eq: () => builder,
      gte: () => builder,
      // A copy, not the stored row. A real read hands back a snapshot, and
      // aliasing it would let a request see its own claim land in the row it
      // read — which is exactly the stale read the tally's compare-and-set
      // exists to refuse, and would make the concurrency below untestable.
      single: async () => ({ data: db.receipt ? { ...db.receipt } : null }),
      then: (onOk, onErr) => Promise.resolve(run()).then(onOk, onErr),
    };
    return builder;
  }

  const receipts = () => ({
    select: () => readBuilder(),
    update: (values: Record<string, unknown>) => {
      const filters: Filters = { eq: [], isNull: [] };
      return writeBuilder(filters, () => {
        // The claim stamps parsed_at; the release hands it back. Both touch
        // the same column, so they are told apart by what they write.
        const isClaim = values.parsed_at != null;
        const isRelease = "parsed_at" in values && values.parsed_at === null;
        if (isClaim && db.claimError) return { data: null, error: db.claimError };
        if (isRelease && db.releaseError) return { data: null, error: db.releaseError };
        if (!isClaim && !isRelease && db.writeBackError) {
          return { data: null, error: db.writeBackError };
        }
        if (!matchesRow(filters)) return { data: [], error: null };
        const id = filters.eq.find(([col]) => col === "id")?.[1];
        spies.receiptUpdate(values, id);
        Object.assign(db.receipt as Record<string, unknown>, values);
        return { data: [{ id }], error: null };
      });
    },
    delete: () => {
      const filters: Filters = { eq: [], isNull: [] };
      return writeBuilder(filters, () => {
        if (!matchesRow(filters)) return { data: [], error: null };
        const id = filters.eq.find(([col]) => col === "id")?.[1];
        const userId = filters.eq.find(([col]) => col === "created_by")?.[1];
        spies.receiptDelete(id, userId);
        db.receipt = null;
        return { data: [{ id }], error: null };
      });
    },
  });

  const receiptItems = () => ({
    select: () => ({
      eq: async () => ({ count: db.itemCount }),
    }),
    insert: async (rows: unknown) => {
      spies.itemsInsert(rows);
      return {};
    },
  });

  return {
    getSupabaseServerClient: async () => ({ auth: { getUser } }),
    getSupabaseServiceClient: async () => ({
      from: (table: string) => (table === "receipts" ? receipts() : receiptItems()),
      storage: {
        from: () => ({
          createSignedUrl: async () => ({ data: { signedUrl: "https://signed" } }),
          remove: async (paths: string[]) => {
            spies.storageRemove(paths);
            return {};
          },
        }),
      },
    }),
  };
});

vi.mock("@/lib/rateLimit", () => ({
  PARSE_LIMIT_PER_HOUR: 15,
  isParseRateLimited: (...args: unknown[]) => isParseRateLimited(...args),
}));

vi.mock("@/lib/storage", () => ({
  extractStoragePath: (...args: unknown[]) => extractStoragePath(...args),
}));

// Only the model call is mocked. parsedReceiptCentsSchema is the real one, so
// the route's validate-before-write step is genuinely exercised here rather
// than stubbed into always passing.
vi.mock("@/lib/gemini/parseReceipt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gemini/parseReceipt")>()),
  parseReceiptImage: (...args: unknown[]) => parseReceiptImage(...args),
}));

import { POST } from "@/app/api/receipts/parse/route";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/receipts/parse", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function rawRequest(body: string) {
  return new Request("http://localhost/api/receipts/parse", {
    method: "POST",
    body,
  });
}

const UNPARSED = {
  id: "r1",
  created_by: "u1",
  image_url: "https://x/receipt-images/u1/r1.jpg",
  // 0020's marker. Null means the receipt's parse is not claimed right now.
  parsed_at: null,
  // 0025's tally and its clock. Zero attempts spent, never attempted.
  parse_attempts: 0,
  last_parse_attempt_at: null,
  merchant_name: null,
  date_of_receipt: null,
  subtotal: null,
  tax: null,
  tip: null,
  total: null,
};

// What Gemini returns for a blank, dark, or unreadable photo: valid JSON, all
// nulls, no items. The route validates it and refuses to write any of it — no
// line items and no total means nothing was read off the photo, and persisting
// it would look exactly like a receipt that parsed cleanly and had no values.
const EMPTY_RESULT = {
  merchant_name: null,
  date_of_receipt: null,
  subtotal: null,
  tax: null,
  tip: null,
  total: null,
  items: [],
};

// Integer cents, which is what parseReceiptImage now returns: $10 subtotal,
// $1 tax, $2 tip, $13 total, one $5 latte at quantity 2. It reconciles —
// 500 x 2 = 1000 = subtotal, and 1000 + 100 + 200 = 1300 = total.
const PARSE_RESULT = {
  merchant_name: "Cafe",
  date_of_receipt: "2026-08-19",
  subtotal: 1000,
  tax: 100,
  tip: 200,
  total: 1300,
  items: [{ name: "Latte", price: 500, quantity: 2 }],
};

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } } });
  isParseRateLimited.mockReset().mockResolvedValue(false);
  extractStoragePath.mockReset().mockReturnValue("u1/r1.jpg");
  parseReceiptImage.mockReset().mockResolvedValue(PARSE_RESULT);
  Object.values(spies).forEach((spy) => spy.mockReset());
  db.receipt = { ...UNPARSED };
  db.itemCount = 0;
  db.otherAttemptsThisHour = 0;
  db.claimError = null;
  db.releaseError = null;
  db.writeBackError = null;
  db.attemptCountError = null;
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(10),
  }) as unknown as typeof fetch;
});

describe("POST /api/receipts/parse", () => {
  it("returns 401 without a session and never checks the rate limit", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(res.status).toBe(401);
    expect(isParseRateLimited).not.toHaveBeenCalled();
  });

  it("returns 400 on a malformed body instead of throwing a 500", async () => {
    const res = await POST(rawRequest("not json"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
    expect(parseReceiptImage).not.toHaveBeenCalled();
  });

  it("returns 400 on an empty body", async () => {
    const res = await POST(rawRequest(""));
    expect(res.status).toBe(400);
  });

  it("returns 400 when receiptId is missing or not a string", async () => {
    expect((await POST(request({ mimeType: "image/jpeg" }))).status).toBe(400);
    expect((await POST(request({ receiptId: 7 }))).status).toBe(400);
    expect(parseReceiptImage).not.toHaveBeenCalled();
  });

  it("returns 403 for a receipt that is not the caller's", async () => {
    db.receipt = null;

    const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(res.status).toBe(403);
    expect(parseReceiptImage).not.toHaveBeenCalled();
  });

  it("proceeds to parse when under the limit", async () => {
    const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(parseReceiptImage).toHaveBeenCalledTimes(1);
  });

  it("logs a failed write-back but still returns the parsed data to the caller", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    db.writeBackError = { message: "connection reset" };

    const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    const json = await res.json();

    // The claim already spent the receipt's one parse and the model already
    // ran, so a persistence failure here must not cost the caller the result
    // they already paid for.
    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, data: PARSE_RESULT });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("write-back failed"));
    logged.mockRestore();
  });

  it("excludes the receipt being parsed from the hourly count", async () => {
    await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(isParseRateLimited).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      { excludeReceiptId: "r1" }
    );
  });

  // ── the replay bypass ─────────────────────────────────────────────────────
  // The limiter counts receipt rows, so replaying one receiptId never moved it.
  // The route has to refuse the second parse itself.
  it("does not invoke Gemini a second time when a receiptId is replayed", async () => {
    const first = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    expect(first.status).toBe(200);
    expect(parseReceiptImage).toHaveBeenCalledTimes(1);

    const replay = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: "already_parsed" });
    expect(parseReceiptImage).toHaveBeenCalledTimes(1);
  });

  it("refuses a whole replay loop after one parse", async () => {
    await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    for (let i = 0; i < 10; i++) {
      const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
      expect(res.status).toBe(409);
    }
    expect(parseReceiptImage).toHaveBeenCalledTimes(1);
  });

  it("refuses a receipt that already carries parsed data", async () => {
    db.receipt = { ...UNPARSED, merchant_name: "Cafe" };

    const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(res.status).toBe(409);
    expect(parseReceiptImage).not.toHaveBeenCalled();
  });

  it("refuses a receipt whose only parsed evidence is line items", async () => {
    db.itemCount = 3;

    const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(res.status).toBe(409);
    expect(parseReceiptImage).not.toHaveBeenCalled();
  });

  // ── the parse that produces nothing ───────────────────────────────────────
  // The evidence checks above can only see a parse that SUCCEEDED. These are
  // the parses that write nothing back, which is why the receipt has to be
  // marked before the model call rather than after it.
  it("stamps the receipt before calling Gemini, not after", async () => {
    let stampedAtCallTime: unknown;
    parseReceiptImage.mockImplementation(async () => {
      stampedAtCallTime = db.receipt?.parsed_at;
      return PARSE_RESULT;
    });

    await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(stampedAtCallTime).toEqual(expect.any(String));
  });

  it("does not re-parse a receipt whose parse came back all nulls", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    parseReceiptImage.mockResolvedValue(EMPTY_RESULT);

    // 500, not 200: an all-nulls parse fails validation and writes nothing.
    // The replay guard below is unaffected — parsed_at was stamped before the
    // model call, which is the whole point of claiming first.
    const first = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    expect(first.status).toBe(500);
    expect(await first.json()).toEqual({ error: "parse_failed" });
    expect(parseReceiptImage).toHaveBeenCalledTimes(1);
    logged.mockRestore();

    const replay = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: "already_parsed" });
    expect(parseReceiptImage).toHaveBeenCalledTimes(1);
  });

  it("refuses a whole replay loop after one empty parse", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    parseReceiptImage.mockResolvedValue(EMPTY_RESULT);

    await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    logged.mockRestore();
    for (let i = 0; i < 10; i++) {
      expect((await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }))).status).toBe(409);
    }
    expect(parseReceiptImage).toHaveBeenCalledTimes(1);
  });

  it("does not re-parse a receipt whose parse threw and returned 500", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    parseReceiptImage.mockRejectedValue(new Error("gemini exploded"));

    const first = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    expect(first.status).toBe(500);

    const replay = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(replay.status).toBe(409);
    expect(parseReceiptImage).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  // ── manual entry after a failed parse ─────────────────────────────────────
  // The alternative fix — discarding the row on an empty parse or a 500, the
  // way the 429 path does — would have closed the same hole by taking the
  // user's tab away. It must stay: an unparseable receipt is exactly when
  // someone needs to type the items in by hand.
  it("keeps the receipt row after a parse that came back all nulls", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    parseReceiptImage.mockResolvedValue(EMPTY_RESULT);

    await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(spies.receiptDelete).not.toHaveBeenCalled();
    expect(spies.storageRemove).not.toHaveBeenCalled();
    // The row is still there for the user to fill in by hand, and nothing from
    // the failed parse reached it — not even the status flip the write-back
    // used to perform, because the write-back never ran.
    expect(db.receipt).toMatchObject({
      id: "r1",
      created_by: "u1",
      merchant_name: null,
      subtotal: null,
      total: null,
    });
    expect(db.receipt).not.toHaveProperty("status");
    expect(spies.itemsInsert).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("keeps the receipt row after a parse that threw", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    parseReceiptImage.mockRejectedValue(new Error("gemini exploded"));

    await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(spies.receiptDelete).not.toHaveBeenCalled();
    expect(spies.storageRemove).not.toHaveBeenCalled();
    expect(db.receipt).toMatchObject({ id: "r1", created_by: "u1" });
    logged.mockRestore();
  });

  it("still has the row to edit after the replay is refused", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    parseReceiptImage.mockRejectedValue(new Error("gemini exploded"));

    await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    const replay = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(replay.status).toBe(409);
    // 409 is not 429: nothing is discarded, so the manual editor still opens
    // on this receipt. CaptureStep sends every non-429 failure to "split".
    expect(spies.receiptDelete).not.toHaveBeenCalled();
    expect(db.receipt).toMatchObject({ id: "r1" });
    logged.mockRestore();
  });

  // ── the race ──────────────────────────────────────────────────────────────
  it("calls Gemini once for N concurrent requests on one receiptId", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        POST(request({ receiptId: "r1", mimeType: "image/jpeg" }))
      )
    );
    const statuses = results.map((res) => res.status).sort();

    expect(parseReceiptImage).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([200, 409, 409, 409, 409]);
  });

  it("claims the parse with a filter that only matches an unclaimed receipt", async () => {
    await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    // The claim is the update carrying parsed_at; it is what makes the race
    // above resolve to one winner rather than five. Since 0025 it carries the
    // tally that bounds the retry and the clock the hourly count bills
    // against, in the same statement — one write, or the two can disagree.
    expect(spies.receiptUpdate).toHaveBeenCalledWith(
      {
        parsed_at: expect.any(String),
        last_parse_attempt_at: expect.any(String),
        parse_attempts: 1,
      },
      "r1"
    );
  });

  it("refuses rather than calling Gemini when the claim cannot be written", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    db.claimError = { message: 'column "parsed_at" does not exist', code: "42703" };

    const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "parse_unavailable" });
    expect(parseReceiptImage).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("does not burn the parse on a request refused before the model call", async () => {
    const res = await POST(request({ receiptId: "r1", mimeType: "image/gif" }));

    expect(res.status).toBe(400);
    expect(db.receipt?.parsed_at).toBeNull();

    // so a corrected retry still parses
    const retry = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    expect(retry.status).toBe(200);
    expect(parseReceiptImage).toHaveBeenCalledTimes(1);
  });

  // ── the hourly limit ──────────────────────────────────────────────────────
  it("returns 429 naming the limit when the caller is over it", async () => {
    isParseRateLimited.mockResolvedValue(true);

    const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json).toEqual({ error: "rate_limited", limit: 15 });
    expect(parseReceiptImage).not.toHaveBeenCalled();
  });

  it("leaves no orphan receipt row or stored image behind on a 429", async () => {
    isParseRateLimited.mockResolvedValue(true);

    await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(spies.storageRemove).toHaveBeenCalledWith(["u1/r1.jpg"]);
    expect(spies.receiptDelete).toHaveBeenCalledWith("r1", "u1");
  });

  it("does not delete a stored object outside the caller's own path", async () => {
    isParseRateLimited.mockResolvedValue(true);
    extractStoragePath.mockReturnValue("someone-else/r9.jpg");

    await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(spies.storageRemove).not.toHaveBeenCalled();
    expect(spies.receiptDelete).toHaveBeenCalledWith("r1", "u1");
  });

  // A concurrent request can claim the parse in the gap between the
  // rate-limit read and this delete. When that happens the row delete's
  // `parsed_at is null` filter matches nothing, and the image must survive
  // too — deleting it anyway would leave the winning request's receipt
  // pointing at storage that no longer exists.
  it("leaves the stored image alone when the row delete loses the race to a concurrent claim", async () => {
    // A concurrent request claims the parse during the gap between the
    // rate-limit check (which already ran the free `alreadyParsed` read) and
    // the discard's delete — the earliest point this route re-touches the
    // row.
    isParseRateLimited.mockImplementation(async () => {
      if (db.receipt) (db.receipt as Record<string, unknown>).parsed_at = new Date().toISOString();
      return true;
    });

    await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(spies.receiptDelete).not.toHaveBeenCalled();
    expect(spies.storageRemove).not.toHaveBeenCalled();
  });

  it("rejects an image path that is not the caller's own", async () => {
    extractStoragePath.mockReturnValue("someone-else/r9.jpg");

    const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_image" });
    expect(parseReceiptImage).not.toHaveBeenCalled();
  });

  it("rejects a mime type outside the allow list before calling Gemini", async () => {
    const res = await POST(request({ receiptId: "r1", mimeType: "image/gif" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_image" });
    expect(parseReceiptImage).not.toHaveBeenCalled();
  });

  it("writes parsed data back against the stored row id", async () => {
    await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(spies.receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ merchant_name: "Cafe", total: 13, status: "open" }),
      "r1"
    );
    expect(spies.itemsInsert).toHaveBeenCalledWith([
      { receipt_id: "r1", name: "Latte", price: 5, quantity: 2, sort_order: 0 },
    ]);
  });

  // ── the receipt that does not add up (OT-136) ─────────────────────────────
  // A total the model misread is one the split step would turn into a Venmo
  // charge without anyone having checked it. The numbers still come back so
  // the user lands on the edit screen looking at them — but nothing is
  // written, so no later read can mistake them for a clean parse.
  describe("reconciliation", () => {
    // Items sum to 1000¢ and the subtotal agrees, but 1000 + 100 + 200 is
    // 1300¢, not the 1500¢ the total claims.
    const BAD_TOTAL = { ...PARSE_RESULT, total: 1500 };
    // Two $5 lattes are 1000¢, whatever the subtotal says.
    const BAD_ITEM_SUM = { ...PARSE_RESULT, subtotal: 1400, total: 1700 };

    it("persists nothing when subtotal plus tax and tip misses the total", async () => {
      const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
      parseReceiptImage.mockResolvedValue(BAD_TOTAL);

      const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

      expect(res.status).toBe(200);
      expect(spies.receiptUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({ merchant_name: "Cafe" }),
        "r1"
      );
      expect(spies.itemsInsert).not.toHaveBeenCalled();
      expect(db.receipt).toMatchObject({ merchant_name: null, total: null });
      warned.mockRestore();
    });

    it("returns the numbers and the fields to flag on the edit screen", async () => {
      const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
      parseReceiptImage.mockResolvedValue(BAD_TOTAL);

      const json = await (
        await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }))
      ).json();

      expect(json.success).toBe(true);
      expect(json.data).toEqual(BAD_TOTAL);
      expect(json.reconciliation.ok).toBe(false);
      expect(json.reconciliation.flagged).toEqual(["subtotal", "total"]);
      expect(json.reconciliation.issues[0]).toMatchObject({
        check: "sum_vs_total",
        expectedCents: 1300,
        actualCents: 1500,
      });
      warned.mockRestore();
    });

    it("persists nothing when the line items miss the subtotal", async () => {
      const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
      parseReceiptImage.mockResolvedValue(BAD_ITEM_SUM);

      const json = await (
        await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }))
      ).json();

      expect(json.reconciliation.flagged).toEqual(["items", "subtotal"]);
      expect(spies.itemsInsert).not.toHaveBeenCalled();
      expect(db.receipt).toMatchObject({ subtotal: null });
      warned.mockRestore();
    });

    it("spends the parse and offers no retry — the model ran either way", async () => {
      const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
      parseReceiptImage.mockResolvedValue(BAD_TOTAL);

      await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

      expect(db.receipt?.parsed_at).toEqual(expect.any(String));
      expect(db.receipt?.parse_attempts).toBe(1);
      const replay = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
      expect(replay.status).toBe(409);
      expect(parseReceiptImage).toHaveBeenCalledTimes(1);
      warned.mockRestore();
    });

    it("says nothing about reconciliation when the receipt adds up", async () => {
      const json = await (
        await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }))
      ).json();

      expect(json).toEqual({ success: true, data: PARSE_RESULT });
    });
  });

  // ── the bounded retry (0025) ──────────────────────────────────────────────
  // A model call that fails for a reason with nothing to do with the receipt
  // used to spend its only parse. It now hands the claim back — but only for
  // that class of failure, and only three times ever.
  const transient: [string, () => unknown][] = [
    ["a provider 5xx", () => Object.assign(new Error("upstream"), { status: 503 })],
    ["a dropped connection", () => Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNRESET" },
    })],
    ["a timeout", () => Object.assign(new Error("timed out"), { name: "AbortError" })],
  ];

  it.each(transient)(
    "leaves the receipt retryable after %s, and says so distinctly",
    async (_label, makeError) => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      parseReceiptImage.mockRejectedValue(makeError());

      const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

      // Distinct from every other failure the route can return: not the 500
      // parse_failed of a parse that is spent, not the 503 parse_unavailable
      // of an unwritable claim, not the 409 of a replay.
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "parse_retryable" });
      // The claim is back, so the receipt is retryable — but the attempt it
      // spent is not, which is what keeps the retry bounded.
      expect(db.receipt?.parsed_at).toBeNull();
      expect(db.receipt?.parse_attempts).toBe(1);
      expect(db.receipt?.last_parse_attempt_at).toEqual(expect.any(String));
      logged.mockRestore();
    }
  );

  it("parses on the retry after a transient failure, without a re-upload", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    parseReceiptImage.mockRejectedValueOnce(
      Object.assign(new Error("upstream"), { status: 500 })
    );

    expect((await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }))).status).toBe(503);

    // Same receiptId, same row, same stored image.
    const retry = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ success: true, data: PARSE_RESULT });
    expect(parseReceiptImage).toHaveBeenCalledTimes(2);
    expect(db.receipt?.parse_attempts).toBe(2);
    logged.mockRestore();
  });

  it("does not hand the claim back for a failure that is not transient", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // A 4xx, a bad key, anything unrecognised: the default is the strict one,
    // because misclassifying here hands back a paid model call.
    parseReceiptImage.mockRejectedValue(
      Object.assign(new Error("invalid api key"), { status: 401 })
    );

    const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "parse_failed" });
    expect(db.receipt?.parsed_at).toEqual(expect.any(String));
    expect((await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }))).status).toBe(409);
    expect(parseReceiptImage).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it("reports a transient failure it could not hand the claim back for as spent", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    parseReceiptImage.mockRejectedValue(Object.assign(new Error("upstream"), { status: 502 }));
    db.releaseError = { message: "connection reset" };

    const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    // The claim is still standing, so telling the client to retry would be a
    // lie the next request refuses. Spent is the direction that cannot cost
    // money.
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "parse_failed" });
    expect(db.receipt?.parsed_at).toEqual(expect.any(String));
    logged.mockRestore();
  });

  // ── the parse that succeeded and returned nothing ─────────────────────────
  // The hole 0020 exists to cover. It is not a transient failure: the model
  // ran, was paid for, and answered. It consumes the parse and gets no retry.
  //
  // What it no longer does is come back 200 with an all-nulls body. That
  // response was indistinguishable from a receipt that parsed cleanly and
  // happened to have no values, and the route wrote it. It now fails
  // validation, writes nothing, and returns parse_failed — which CaptureStep
  // already routes to the manual editor, like every other non-429 failure.
  it.each([
    ["an all-nulls result off a blank photo", EMPTY_RESULT],
    ["a reply that failed JSON.parse", { ...EMPTY_RESULT }],
  ])("consumes the parse on %s and offers no retry", async (_label, result) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    parseReceiptImage.mockResolvedValue(result);

    const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    // 500, not the 503 parse_retryable a transient failure returns — nothing
    // in this response tells the client it may try again.
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "parse_failed" });
    // The claim stands and the tally moved: the receipt is spent.
    expect(db.receipt?.parsed_at).toEqual(expect.any(String));
    expect(db.receipt?.parse_attempts).toBe(1);

    const replay = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: "already_parsed" });
    expect(parseReceiptImage).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  // ── the cap ───────────────────────────────────────────────────────────────
  it("stops at three model calls however many transient failures follow", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    parseReceiptImage.mockRejectedValue(Object.assign(new Error("upstream"), { status: 503 }));

    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push((await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }))).status);
    }

    // Two retries granted, then the third failure keeps the claim: the
    // receipt is spent and every later request is refused without a model
    // call.
    expect(statuses).toEqual([503, 503, 500, 409, 409, 409, 409, 409, 409, 409]);
    expect(parseReceiptImage).toHaveBeenCalledTimes(3);
    expect(db.receipt?.parse_attempts).toBe(3);
    logged.mockRestore();
  });

  it("refuses a fourth attempt the client asks for directly", async () => {
    // A receipt whose three attempts are spent and whose claim is not
    // standing — the tally is the only thing that still refuses it, and it is
    // enforced here rather than by the client choosing not to ask.
    db.receipt = { ...UNPARSED, parse_attempts: 3, last_parse_attempt_at: null };

    const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "parse_exhausted", attempts: 3 });
    expect(parseReceiptImage).not.toHaveBeenCalled();
    // and it is not discarded as an unparsed row — the manual editor still
    // opens on it
    expect(spies.receiptDelete).not.toHaveBeenCalled();
  });

  it("gives a row that predates 0025 its full three attempts, and no more", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // Null, not 0: the column was added bare, so every existing row backfills
    // to null and the claim has to filter on `is null` rather than `= 0`.
    db.receipt = { ...UNPARSED, parse_attempts: null };
    parseReceiptImage.mockRejectedValue(Object.assign(new Error("upstream"), { status: 503 }));

    const first = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(first.status).toBe(503);
    expect(db.receipt?.parse_attempts).toBe(1);

    for (let i = 0; i < 5; i++) {
      await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    }
    expect(parseReceiptImage).toHaveBeenCalledTimes(3);
    logged.mockRestore();
  });

  // ── the race, once per attempt ────────────────────────────────────────────
  it("calls Gemini once per attempt for N concurrent requests, and three times in all", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    parseReceiptImage.mockRejectedValue(Object.assign(new Error("upstream"), { status: 503 }));

    // Three rounds of five simultaneous requests on one receiptId. Each round
    // resolves to exactly one winner — the claim is a compare-and-set on both
    // parsed_at and the tally, so a request holding a stale read matches no
    // row rather than overwriting a count it never saw.
    for (const expected of [1, 2, 3]) {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          POST(request({ receiptId: "r1", mimeType: "image/jpeg" }))
        )
      );
      expect(results.filter((res) => res.status !== 409)).toHaveLength(1);
      expect(parseReceiptImage).toHaveBeenCalledTimes(expected);
    }

    // A fourth round buys nothing.
    await Promise.all(
      Array.from({ length: 5 }, () =>
        POST(request({ receiptId: "r1", mimeType: "image/jpeg" }))
      )
    );
    expect(parseReceiptImage).toHaveBeenCalledTimes(3);
    logged.mockRestore();
  });

  it("refuses a claim built on a read that went stale while the claim was released", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    parseReceiptImage.mockRejectedValue(Object.assign(new Error("upstream"), { status: 503 }));

    // Park one request between its ownership read and its claim, holding a
    // read that says zero attempts spent. The rate-limit check is the last
    // await before the claim, so stalling it is the window.
    let resume!: () => void;
    isParseRateLimited.mockImplementationOnce(
      () => new Promise<boolean>((ok) => { resume = () => ok(false); })
    );
    const stale = POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    // Two full attempts land while it waits, each released after a transient
    // failure, so the row is unclaimed again — and `parsed_at is null` alone
    // can no longer tell "never attempted" from "twice attempted".
    expect((await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }))).status).toBe(503);
    expect((await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }))).status).toBe(503);
    expect(db.receipt?.parse_attempts).toBe(2);

    resume();
    const res = await stale;

    // The tally in the claim's filter is what refuses this. Without it the
    // stale request claims the released row and writes the count back to 1 —
    // a lost update that hands the caller a fourth and fifth model call off
    // one upload.
    expect(res.status).toBe(409);
    expect(db.receipt?.parse_attempts).toBe(2);
    expect(parseReceiptImage).toHaveBeenCalledTimes(2);

    // Whatever the caller does next, the cap holds.
    for (let i = 0; i < 5; i++) {
      await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    }
    expect(parseReceiptImage).toHaveBeenCalledTimes(3);
    logged.mockRestore();
  });

  // ── every attempt costs a slot ────────────────────────────────────────────
  it("charges a retry against the hourly limit like any other attempt", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // 14 attempts already spent this hour on other receipts, so this receipt's
    // first attempt is the fifteenth and last.
    db.otherAttemptsThisHour = 14;
    parseReceiptImage.mockRejectedValue(Object.assign(new Error("upstream"), { status: 503 }));

    const first = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    expect(first.status).toBe(503);
    expect(parseReceiptImage).toHaveBeenCalledTimes(1);

    // The retry is refused: the attempt just spent counted, even though it
    // added no receipt row for the limiter's own count to see.
    const retry = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(retry.status).toBe(429);
    expect(await retry.json()).toEqual({ error: "rate_limited", limit: 15 });
    expect(parseReceiptImage).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it("keeps the row and the image when a retry is the thing refused for the hour", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    db.otherAttemptsThisHour = 14;
    parseReceiptImage.mockRejectedValue(Object.assign(new Error("upstream"), { status: 503 }));

    await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    // A 429 on a fresh receipt discards the row and its image, because the
    // parse never happened. This one has an attempt left and a photo the
    // retry exists to save the user from uploading again.
    expect(spies.receiptDelete).not.toHaveBeenCalled();
    expect(spies.storageRemove).not.toHaveBeenCalled();
    expect(db.receipt).toMatchObject({ id: "r1", parse_attempts: 1 });
    logged.mockRestore();
  });

  it("fails the hourly attempt count open, and the claim closed, when 0025 is unapplied", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    db.attemptCountError = { message: 'column "last_parse_attempt_at" does not exist', code: "42703" };

    // Failing this count open costs nothing: the claim reads the same missing
    // columns a moment later and refuses before the model.
    db.claimError = { message: 'column "parse_attempts" does not exist', code: "42703" };

    const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "parse_unavailable" });
    expect(parseReceiptImage).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
