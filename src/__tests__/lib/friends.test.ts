import { describe, it, expect, vi, beforeEach } from "vitest";

const single = vi.fn();
const insertSelect = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({
    from: (table: string) =>
      table === "profiles"
        ? { select: () => ({ ilike: () => ({ neq: () => ({ single }) }) }) }
        : { insert: () => ({ select: insertSelect }) },
    rpc,
  }),
}));

import { addFriendByUsername } from "@/lib/friends";

beforeEach(() => {
  single.mockReset();
  insertSelect.mockReset();
  rpc.mockReset();
});

describe("addFriendByUsername", () => {
  it("creates a bidirectional friendship for an Open Tab user", async () => {
    single.mockResolvedValue({ data: { id: "p1", display_name: "Alice", venmo_username: "alice" } });
    rpc.mockResolvedValue({ error: null });

    const res = await addFriendByUsername("me", "alice");

    expect(res).toEqual({ friend: { id: "p1", display_name: "Alice", venmo_username: "alice" } });
    expect(rpc).toHaveBeenCalledWith("add_friendship", { a: "me", b: "p1" });
  });

  it("stores an external contact when the username isn't on Open Tab", async () => {
    single.mockResolvedValue({ data: null });
    insertSelect.mockResolvedValue({ data: [{ id: "c1", venmo_username: "bob" }], error: null });

    const res = await addFriendByUsername("me", "@bob");

    expect(res).toEqual({ friend: { id: "c1", display_name: "bob", venmo_username: "bob" } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports already-added on a duplicate external contact (23505)", async () => {
    single.mockResolvedValue({ data: null });
    insertSelect.mockResolvedValue({ data: null, error: { code: "23505" } });

    const res = await addFriendByUsername("me", "bob");

    expect(res).toEqual({ already: true });
  });

  it("rejects an empty username", async () => {
    const res = await addFriendByUsername("me", "  @  ");
    expect(res).toEqual({ error: "Enter a username." });
  });
});
