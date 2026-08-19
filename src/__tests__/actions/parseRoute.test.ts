import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const isParseRateLimited = vi.fn();
const extractStoragePath = vi.fn();
const parseReceiptImage = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser } }),
  getSupabaseServiceClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({ data: { id: "r1", image_url: "https://x/receipt-images/u1/r1.jpg" } }),
          }),
        }),
      }),
      update: () => ({ eq: async () => ({}) }),
    }),
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: "https://signed" } }),
      }),
    },
  }),
}));

vi.mock("@/lib/rateLimit", () => ({
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

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } } });
  isParseRateLimited.mockReset().mockResolvedValue(false);
  extractStoragePath.mockReset().mockReturnValue("u1/r1.jpg");
  parseReceiptImage.mockReset();
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

  it("returns 429 with a rate_limited error when the caller is over the hourly limit", async () => {
    isParseRateLimited.mockResolvedValue(true);

    const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json).toEqual({ error: "rate_limited" });
    expect(parseReceiptImage).not.toHaveBeenCalled();
  });

  it("proceeds to parse when under the limit", async () => {
    parseReceiptImage.mockResolvedValue({
      merchant_name: "Cafe",
      date_of_receipt: "2026-08-19",
      subtotal: 10,
      tax: 1,
      tip: 2,
      total: 13,
      items: [],
    });

    const res = await POST(request({ receiptId: "r1", mimeType: "image/jpeg" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });
});
