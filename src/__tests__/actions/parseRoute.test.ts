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
  // migration 0020 or 0024 would.
  claimError: DbError;
  // Set to make the release of a claim fail without touching anything else.
  releaseError: DbError;
  // Set to make the post-parse write-back fail without touching the claim.
  writeBackError: DbError;
  // Set to make the hourly attempt count fail, the way an unapplied 0024 would.
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
  // (0024's last_parse_attempt_at survives a release), plus whatever other
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
      single: async () => ({ data: db.receipt }),
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

vi.mock("@/lib/gemini/parseReceipt", () => ({
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
  // 0024's tally and its clock. Zero attempts spent, never attempted.
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
// nulls, no items. Identical in shape to parseReceipt.ts's EMPTY fallback,
// which is what a reply that fails JSON.parse produces. Neither writes
// anything a later request could read as evidence of a parse.
const EMPTY_RESULT = {
  merchant_name: null,
  date_of_receipt: null,
  subtotal: null,
  tax: null,
  tip: null,
  total: null,
  items: [],
};

const PARSE_RESULT = {
  merchant_name: "Cafe",
  date_of_receipt: "2026-08-19",
  subtotal: 10,
  tax: 1,
  tip: 2,
  total: 13,
  items: [{ name: "Latte", price: 5, quantity: 2 }],
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
    parseReceiptImage.mockResolvedValue(EMPTY_RESULT);

    const first = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    expect(first.status).toBe(200);
    expect(parseReceiptImage).toHaveBeenCalledTimes(1);

    const replay = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: "already_parsed" });
    expect(parseReceiptImage).toHaveBeenCalledTimes(1);
  });

  it("refuses a whole replay loop after one empty parse", async () => {
    parseReceiptImage.mockResolvedValue(EMPTY_RESULT);

    await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
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
    parseReceiptImage.mockResolvedValue(EMPTY_RESULT);

    await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));

    expect(spies.receiptDelete).not.toHaveBeenCalled();
    expect(spies.storageRemove).not.toHaveBeenCalled();
    expect(db.receipt).toMatchObject({ id: "r1", created_by: "u1", status: "open" });
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
    // above resolve to one winner rather than five. Since 0024 it carries the
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
});
