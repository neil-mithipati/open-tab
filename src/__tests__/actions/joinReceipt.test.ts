import { describe, it, expect, vi, beforeEach } from "vitest";

const isClaimJoinRateLimited = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("@/lib/rateLimit", () => ({
  isClaimJoinRateLimited: (...args: unknown[]) => isClaimJoinRateLimited(...args),
}));

// A charges query awaited without a terminal .single()/.maybeSingle() call
// (claimingLocked reads { count } straight off the builder), so this chain
// resolves itself once `then` is invoked.
function chargesCountChain(count: number) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.then = (resolve: (v: { count: number }) => void) => resolve({ count });
  return chain;
}

function receiptLookupChain(receipt: { id: string; status: string } | null) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.single = async () => ({ data: receipt });
  return chain;
}

// receipt_participants is read twice (resume lookup, then the 23505 race
// fallback) and inserted into once. No row exists for this username, so the
// resume lookup misses and the insert wins.
function participantsChain() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.ilike = () => chain;
  chain.insert = () => chain;
  chain.maybeSingle = async () => ({ data: null });
  chain.single = async () => ({ data: { id: "p1" }, error: null });
  // The race fallback awaits the filtered builder directly, with no terminal
  // .single()/.maybeSingle(), so the chain has to be thenable too.
  chain.then = (resolve: (v: { data: unknown[] }) => void) => resolve({ data: [] });
  return chain;
}

// No profile matches the username, so the participant is external.
function profilesChain() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.ilike = () => chain;
  chain.maybeSingle = async () => ({ data: null });
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServiceClient: async () => ({
    from: (table: string) => {
      if (table === "receipts") return receiptLookupChain({ id: "r1", status: "shared" });
      if (table === "charges") return chargesCountChain(0);
      if (table === "receipt_participants") return participantsChain();
      if (table === "profiles") return profilesChain();
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

beforeEach(() => {
  isClaimJoinRateLimited.mockReset().mockResolvedValue(false);
});

describe("joinReceipt", () => {
  it("rejects a bad username before touching the database", async () => {
    const { joinReceipt } = await import("@/app/actions/claim");
    const res = await joinReceipt("tok", "!!bad!!");
    expect(res).toEqual({ error: "Enter a valid Venmo username." });
  });

  it("returns a friendly error when the receipt is over the join limit", async () => {
    isClaimJoinRateLimited.mockResolvedValue(true);

    const { joinReceipt } = await import("@/app/actions/claim");
    const res = await joinReceipt("tok", "alice");

    expect(res).toEqual({
      error: "Too many people joining right now — try again in a bit.",
    });
    expect(isClaimJoinRateLimited).toHaveBeenCalledWith(expect.anything(), "r1");
  });

  it("joins normally when under the threshold", async () => {
    isClaimJoinRateLimited.mockResolvedValue(false);

    const { joinReceipt } = await import("@/app/actions/claim");
    const res = await joinReceipt("tok", "alice");

    expect(res).toEqual({ participantId: "p1" });
  });
});
