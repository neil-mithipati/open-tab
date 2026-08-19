import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const isParseRateLimited = vi.fn();
const extractStoragePath = vi.fn();
const parseReceiptImage = vi.fn();

// Mutable stand-in for the two tables this route touches. `receipt` is the row
// the ownership lookup returns; the update the route makes after a parse writes
// back into it, so a replayed request sees what the first one stored.
type Row = Record<string, unknown> | null;
const db: { receipt: Row; itemCount: number } = { receipt: null, itemCount: 0 };
const spies = {
  receiptUpdate: vi.fn(),
  receiptDelete: vi.fn(),
  itemsInsert: vi.fn(),
  storageRemove: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => {
  const receipts = () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({ single: async () => ({ data: db.receipt }) }),
      }),
    }),
    update: (values: Record<string, unknown>) => ({
      eq: async (_col: string, id: string) => {
        spies.receiptUpdate(values, id);
        if (db.receipt) Object.assign(db.receipt, values);
        return {};
      },
    }),
    delete: () => ({
      eq: (_c1: string, id: string) => ({
        eq: async (_c2: string, userId: string) => {
          spies.receiptDelete(id, userId);
          db.receipt = null;
          return {};
        },
      }),
    }),
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
  image_url: "https://x/receipt-images/u1/r1.jpg",
  merchant_name: null,
  date_of_receipt: null,
  subtotal: null,
  tax: null,
  tip: null,
  total: null,
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
