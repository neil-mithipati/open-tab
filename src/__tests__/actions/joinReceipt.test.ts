import { describe, it, expect, vi, beforeEach } from "vitest";

const isClaimJoinRateLimited = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("@/lib/rateLimit", () => ({
  isClaimJoinRateLimited: (...args: unknown[]) => isClaimJoinRateLimited(...args),
}));

// Rows behind the two username lookups. Empty by default, so the resume lookup
// misses, no profile matches, and the insert wins.
let participantRows: { id: string; venmo_username: string }[] = [];
let profileRows: { id: string; display_name: string; venmo_username: string }[] = [];
let insertedRows: Record<string, unknown>[] = [];

// Postgres ILIKE with the default backslash escape: `_` matches any single
// character, `%` any run of them, and a backslash makes the next character
// literal. Modelling this is the point of the tests below — a mock that ignores
// the pattern cannot tell an escaped lookup from an unescaped one.
function ilikeMatches(pattern: string, value: string): boolean {
  const literal = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "\\") {
      i += 1;
      if (i < pattern.length) source += literal(pattern[i]);
    } else if (ch === "_") {
      source += ".";
    } else if (ch === "%") {
      source += ".*";
    } else {
      source += literal(ch);
    }
  }
  return new RegExp(`^${source}$`, "i").test(value);
}

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
// fallback) and inserted into once. Reads match participantRows against the
// ILIKE pattern the action actually passed.
function participantsChain() {
  const chain: Record<string, unknown> = {};
  let pattern: string | null = null;
  let inserting = false;
  const matched = () => {
    const p = pattern;
    if (p === null) return [];
    return participantRows.filter((row) => ilikeMatches(p, row.venmo_username));
  };
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.ilike = (_column: string, value: string) => {
    pattern = value;
    return chain;
  };
  chain.insert = (payload: Record<string, unknown>) => {
    inserting = true;
    insertedRows.push(payload);
    return chain;
  };
  // maybeSingle() errors rather than picking a row when the filter matches more
  // than one, exactly as PostgREST does.
  chain.maybeSingle = async () => {
    const rows = matched();
    if (rows.length > 1) return { data: null, error: { code: "PGRST116" } };
    return { data: rows[0] ?? null, error: null };
  };
  chain.single = async () =>
    inserting ? { data: { id: "p1" }, error: null } : { data: matched()[0] ?? null, error: null };
  // The race fallback awaits the filtered builder directly, with no terminal
  // .single()/.maybeSingle(), so the chain has to be thenable too.
  chain.then = (resolve: (v: { data: unknown[] }) => void) => resolve({ data: matched() });
  return chain;
}

// Matched the same way; empty by default, so the participant is external.
function profilesChain() {
  const chain: Record<string, unknown> = {};
  let pattern: string | null = null;
  chain.select = () => chain;
  chain.ilike = (_column: string, value: string) => {
    pattern = value;
    return chain;
  };
  chain.maybeSingle = async () => {
    const p = pattern;
    const rows = p === null ? [] : profileRows.filter((row) => ilikeMatches(p, row.venmo_username));
    if (rows.length > 1) return { data: null, error: { code: "PGRST116" } };
    return { data: rows[0] ?? null, error: null };
  };
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
  participantRows = [];
  profileRows = [];
  insertedRows = [];
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

  it("resumes a returning claimer by exact username", async () => {
    participantRows = [{ id: "victim", venmo_username: "alicejones" }];

    const { joinReceipt } = await import("@/app/actions/claim");
    const res = await joinReceipt("tok", "alicejones");

    expect(res).toEqual({ participantId: "victim" });
  });

  // `_` is legal in a Venmo username and is also a single-character ILIKE
  // wildcard, so an unescaped resume lookup hands the typist someone else's
  // participant id — and with it their claims and their charges.
  it("does not resume another participant when the typed username substitutes for `_`", async () => {
    participantRows = [{ id: "victim", venmo_username: "alicejones" }];

    const { joinReceipt } = await import("@/app/actions/claim");
    const res = await joinReceipt("tok", "alice_ones");

    expect(res).toEqual({ participantId: "p1" });
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({ venmo_username: "alice_ones" });
  });

  // The other direction: a participant whose username really contains `_` must
  // resume their own row even when a same-length neighbour differs only in that
  // position. Unescaped, the pattern matches both and maybeSingle() fails.
  it("resumes the literal-underscore participant, not a same-length neighbour", async () => {
    participantRows = [
      { id: "underscore", venmo_username: "alice_ones" },
      { id: "neighbour", venmo_username: "alicejones" },
    ];

    const { joinReceipt } = await import("@/app/actions/claim");
    const res = await joinReceipt("tok", "alice_ones");

    expect(res).toEqual({ participantId: "underscore" });
    expect(insertedRows).toHaveLength(0);
  });

  it("does not resume a literal-underscore participant from a substituted username", async () => {
    participantRows = [{ id: "underscore", venmo_username: "alice_ones" }];

    const { joinReceipt } = await import("@/app/actions/claim");
    const res = await joinReceipt("tok", "alicejones");

    expect(res).toEqual({ participantId: "p1" });
    expect(insertedRows[0]).toMatchObject({ venmo_username: "alicejones" });
  });

  // Same wildcard, second lookup: linking the new participant to an unrelated
  // account would take that account's id and display name.
  it("does not link a new participant to a profile matched only by the `_` wildcard", async () => {
    profileRows = [{ id: "prof1", display_name: "Alice Jones", venmo_username: "alicejones" }];

    const { joinReceipt } = await import("@/app/actions/claim");
    const res = await joinReceipt("tok", "alice_ones");

    expect(res).toEqual({ participantId: "p1" });
    expect(insertedRows[0]).toMatchObject({
      user_id: null,
      venmo_username: "alice_ones",
      display_name: "alice_ones",
    });
  });

  it("links a new participant to a profile whose username matches exactly", async () => {
    profileRows = [{ id: "prof1", display_name: "Alice Jones", venmo_username: "alice_ones" }];

    const { joinReceipt } = await import("@/app/actions/claim");
    const res = await joinReceipt("tok", "alice_ones");

    expect(res).toEqual({ participantId: "p1" });
    expect(insertedRows[0]).toMatchObject({ user_id: "prof1", display_name: "Alice Jones" });
  });
});
