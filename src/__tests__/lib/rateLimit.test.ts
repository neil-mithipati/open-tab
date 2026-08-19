import { describe, it, expect, vi } from "vitest";
import {
  isParseRateLimited,
  isClaimJoinRateLimited,
  PARSE_LIMIT_PER_HOUR,
  CLAIM_JOIN_LIMIT_PER_HOUR,
} from "@/lib/rateLimit";

// Minimal chainable stand-in for the slice of the Supabase query builder
// these helpers use: from().select().eq().gte() resolving to { count }.
function fakeClient(count: number | null) {
  const gte = vi.fn().mockResolvedValue({ count });
  const eq = vi.fn(() => ({ gte }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, eq, select, gte } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

const NOW = new Date("2026-08-19T12:00:00.000Z");

describe("isParseRateLimited", () => {
  it("allows a user under the hourly limit", async () => {
    const client = fakeClient(PARSE_LIMIT_PER_HOUR - 1);
    expect(await isParseRateLimited(client, "u1", NOW)).toBe(false);
  });

  it("denies a user at the hourly limit", async () => {
    const client = fakeClient(PARSE_LIMIT_PER_HOUR);
    expect(await isParseRateLimited(client, "u1", NOW)).toBe(true);
  });

  it("denies a user over the hourly limit", async () => {
    const client = fakeClient(PARSE_LIMIT_PER_HOUR + 5);
    expect(await isParseRateLimited(client, "u1", NOW)).toBe(true);
  });

  it("treats a null count as zero and allows the call", async () => {
    const client = fakeClient(null);
    expect(await isParseRateLimited(client, "u1", NOW)).toBe(false);
  });

  it("scopes the count to the caller and the last hour", async () => {
    const client = fakeClient(0);
    await isParseRateLimited(client, "u1", NOW);

    expect(client.from).toHaveBeenCalledWith("receipts");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    expect(c.select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(c.eq).toHaveBeenCalledWith("created_by", "u1");
    expect(c.gte).toHaveBeenCalledWith(
      "created_at",
      new Date(NOW.getTime() - 60 * 60 * 1000).toISOString()
    );
  });
});

describe("isClaimJoinRateLimited", () => {
  it("allows a receipt under the hourly join limit", async () => {
    const client = fakeClient(CLAIM_JOIN_LIMIT_PER_HOUR - 1);
    expect(await isClaimJoinRateLimited(client, "r1", NOW)).toBe(false);
  });

  it("denies a receipt at the hourly join limit", async () => {
    const client = fakeClient(CLAIM_JOIN_LIMIT_PER_HOUR);
    expect(await isClaimJoinRateLimited(client, "r1", NOW)).toBe(true);
  });

  it("scopes the count to the receipt and the last hour", async () => {
    const client = fakeClient(0);
    await isClaimJoinRateLimited(client, "r1", NOW);

    expect(client.from).toHaveBeenCalledWith("receipt_participants");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    expect(c.eq).toHaveBeenCalledWith("receipt_id", "r1");
  });
});
