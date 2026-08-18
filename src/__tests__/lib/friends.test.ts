import { describe, it, expect, vi, beforeEach } from "vitest";

const insertSelect = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({
    from: () => ({ insert: () => ({ select: insertSelect }) }),
    rpc,
  }),
}));

import { addFriendByUsername } from "@/lib/friends";

// The profile lookup and the friendship insert both go through RPCs now
// (profiles is own-row only under RLS), so the mock dispatches on the fn name.
function mockRpc(searchResult: unknown[], addResult: { error: unknown } = { error: null }) {
  rpc.mockImplementation(async (fn: string) =>
    fn === "find_profile_by_venmo_username" ? { data: searchResult } : addResult
  );
}

beforeEach(() => {
  insertSelect.mockReset();
  rpc.mockReset();
});

describe("addFriendByUsername", () => {
  it("creates a bidirectional friendship for an Open Tab user", async () => {
    mockRpc([{ id: "p1", display_name: "Alice", venmo_username: "alice" }]);

    const res = await addFriendByUsername("me", "alice");

    expect(res).toEqual({ friend: { id: "p1", display_name: "Alice", venmo_username: "alice" } });
    expect(rpc).toHaveBeenCalledWith("find_profile_by_venmo_username", { username: "alice" });
    expect(rpc).toHaveBeenCalledWith("add_friendship", { a: "me", b: "p1" });
  });

  it("reports an error when the friendship insert is rejected", async () => {
    mockRpc([{ id: "p1", display_name: "Alice", venmo_username: "alice" }], {
      error: { message: "add_friendship: caller must be one of the two users" },
    });

    const res = await addFriendByUsername("me", "alice");

    expect(res).toEqual({ error: "Something went wrong. Try again." });
  });

  it("stores an external contact when the username isn't on Open Tab", async () => {
    mockRpc([]);
    insertSelect.mockResolvedValue({ data: [{ id: "c1", venmo_username: "bob" }], error: null });

    const res = await addFriendByUsername("me", "@bob");

    expect(res).toEqual({ friend: { id: "c1", display_name: "bob", venmo_username: "bob" } });
    expect(rpc).not.toHaveBeenCalledWith("add_friendship", expect.anything());
  });

  it("reports already-added on a duplicate external contact (23505)", async () => {
    mockRpc([]);
    insertSelect.mockResolvedValue({ data: null, error: { code: "23505" } });

    const res = await addFriendByUsername("me", "bob");

    expect(res).toEqual({ already: true });
  });

  it("rejects an empty username", async () => {
    const res = await addFriendByUsername("me", "  @  ");
    expect(res).toEqual({ error: "Enter a username." });
  });
});
