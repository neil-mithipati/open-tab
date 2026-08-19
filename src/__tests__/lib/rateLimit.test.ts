import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isParseRateLimited,
  isClaimJoinRateLimited,
  PARSE_LIMIT_PER_HOUR,
  CLAIM_JOIN_LIMIT_PER_HOUR,
} from "@/lib/rateLimit";

// Minimal chainable stand-in for the slice of the Supabase query builder these
// helpers use. Every filter returns the builder and the builder is thenable, so
// from().select().eq().eq().gte().neq() in any order resolves to
// { count, error }.
function fakeClient(
  count: number | null,
  error: { message: string; code?: string } | null = null
) {
  const calls = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    neq: vi.fn(),
  };

  type Builder = {
    select: (...args: unknown[]) => Builder;
    eq: (...args: unknown[]) => Builder;
    gte: (...args: unknown[]) => Builder;
    neq: (...args: unknown[]) => Builder;
    then: (resolve: (value: { count: number | null; error: unknown }) => void) => void;
  };

  const builder = {} as Builder;
  builder.select = (...args) => { calls.select(...args); return builder; };
  builder.eq = (...args) => { calls.eq(...args); return builder; };
  builder.gte = (...args) => { calls.gte(...args); return builder; };
  builder.neq = (...args) => { calls.neq(...args); return builder; };
  builder.then = (resolve) => resolve({ count, error });

  const client = {
    from: (...args: unknown[]) => { calls.from(...args); return builder; },
  } as unknown as import("@supabase/supabase-js").SupabaseClient;

  return { client, calls };
}

const NOW = new Date("2026-08-19T12:00:00.000Z");
const HOUR_AGO = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isParseRateLimited", () => {
  it("allows a user under the hourly limit", async () => {
    const { client } = fakeClient(PARSE_LIMIT_PER_HOUR - 1);
    expect(await isParseRateLimited(client, "u1", { now: NOW })).toBe(false);
  });

  it("denies a user at the hourly limit", async () => {
    const { client } = fakeClient(PARSE_LIMIT_PER_HOUR);
    expect(await isParseRateLimited(client, "u1", { now: NOW })).toBe(true);
  });

  it("denies a user over the hourly limit", async () => {
    const { client } = fakeClient(PARSE_LIMIT_PER_HOUR + 5);
    expect(await isParseRateLimited(client, "u1", { now: NOW })).toBe(true);
  });

  it("scopes the count to the caller and the last hour", async () => {
    const { client, calls } = fakeClient(0);
    await isParseRateLimited(client, "u1", { now: NOW });

    expect(calls.from).toHaveBeenCalledWith("receipts");
    expect(calls.select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(calls.eq).toHaveBeenCalledWith("created_by", "u1");
    expect(calls.gte).toHaveBeenCalledWith("created_at", HOUR_AGO);
  });

  // The receipt being parsed already exists by the time the route runs, so
  // counting it would make the 15th allowed parse the 14th.
  it("excludes the receipt being parsed from the count", async () => {
    const { client, calls } = fakeClient(PARSE_LIMIT_PER_HOUR - 1);

    const limited = await isParseRateLimited(client, "u1", {
      now: NOW,
      excludeReceiptId: "r1",
    });

    expect(limited).toBe(false);
    expect(calls.neq).toHaveBeenCalledWith("id", "r1");
  });

  it("lets the documented ceiling of 15 be the 15th parse, not the 14th", async () => {
    // 14 other receipts this hour + the one being parsed = the 15th parse.
    const fifteenth = fakeClient(PARSE_LIMIT_PER_HOUR - 1);
    expect(
      await isParseRateLimited(fifteenth.client, "u1", { now: NOW, excludeReceiptId: "r15" })
    ).toBe(false);

    // 15 others + this one = the 16th, which is over.
    const sixteenth = fakeClient(PARSE_LIMIT_PER_HOUR);
    expect(
      await isParseRateLimited(sixteenth.client, "u1", { now: NOW, excludeReceiptId: "r16" })
    ).toBe(true);
  });

  it("does not filter on an id when no receipt is excluded", async () => {
    const { client, calls } = fakeClient(0);
    await isParseRateLimited(client, "u1", { now: NOW });
    expect(calls.neq).not.toHaveBeenCalled();
  });

  it("fails open on a null count and logs which limiter went inert", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient(null);

    expect(await isParseRateLimited(client, "u1", { now: NOW })).toBe(false);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("parse");
  });

  it("fails open on a query error and logs the reason", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient(null, {
      message: 'column "created_at" does not exist',
      code: "42703",
    });

    expect(await isParseRateLimited(client, "u1", { now: NOW })).toBe(false);
    expect(logged).toHaveBeenCalledTimes(1);
    const message = String(logged.mock.calls[0][0]);
    expect(message).toContain("parse");
    expect(message).toContain("42703");
    expect(message).toContain('column "created_at" does not exist');
  });
});

describe("isClaimJoinRateLimited", () => {
  it("allows a receipt under the hourly join limit", async () => {
    const { client } = fakeClient(CLAIM_JOIN_LIMIT_PER_HOUR - 1);
    expect(await isClaimJoinRateLimited(client, "r1", NOW)).toBe(false);
  });

  it("denies a receipt at the hourly join limit", async () => {
    const { client } = fakeClient(CLAIM_JOIN_LIMIT_PER_HOUR);
    expect(await isClaimJoinRateLimited(client, "r1", NOW)).toBe(true);
  });

  it("scopes the count to the receipt and the last hour", async () => {
    const { client, calls } = fakeClient(0);
    await isClaimJoinRateLimited(client, "r1", NOW);

    expect(calls.from).toHaveBeenCalledWith("receipt_participants");
    expect(calls.eq).toHaveBeenCalledWith("receipt_id", "r1");
    expect(calls.gte).toHaveBeenCalledWith("created_at", HOUR_AGO);
  });

  // An owner save deletes and re-inserts every participant row, refreshing
  // created_at on people who joined long ago. Those rows come back with
  // joined_via_share false, so counting only share joins keeps one owner edit
  // on a 20-person dinner from locking out real joiners for an hour.
  it("counts only participants who joined through the share link", async () => {
    const { client, calls } = fakeClient(0);
    await isClaimJoinRateLimited(client, "r1", NOW);
    expect(calls.eq).toHaveBeenCalledWith("joined_via_share", true);
  });

  it("fails open on a query error and logs which limiter went inert", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient(null, {
      message: 'relation "receipt_participants" does not exist',
      code: "42P01",
    });

    expect(await isClaimJoinRateLimited(client, "r1", NOW)).toBe(false);
    expect(logged).toHaveBeenCalledTimes(1);
    const message = String(logged.mock.calls[0][0]);
    expect(message).toContain("claim-join");
    expect(message).toContain("42P01");
  });

  it("fails open on a null count and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient(null);

    expect(await isClaimJoinRateLimited(client, "r1", NOW)).toBe(false);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("claim-join");
  });
});
