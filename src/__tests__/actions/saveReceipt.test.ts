import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const getUser = vi.fn();
const revalidatePath = vi.fn();
const updateTag = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
  updateTag: (...args: unknown[]) => updateTag(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser }, rpc }),
}));

import { saveReceiptState, type SaveReceiptInput } from "@/app/actions/saveReceipt";

const input = (over: Partial<SaveReceiptInput> = {}): SaveReceiptInput => ({
  receiptId: "r1",
  items: [],
  participants: [],
  assignments: {},
  charges: [],
  receipt: {},
  ...over,
});

// The payload the action handed to the RPC.
function payload() {
  return rpc.mock.calls[0][1];
}

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } } });
  revalidatePath.mockReset();
  updateTag.mockReset();
});

describe("saveReceiptState", () => {
  it("refuses without a session and never touches the database", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    expect(await saveReceiptState(input())).toEqual({ error: "Not signed in." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends one save_receipt_state call, not a sequence of writes", async () => {
    await saveReceiptState(input());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("save_receipt_state");
    expect(payload().p_receipt_id).toBe("r1");
  });

  it("maps items to snake_case rows, numbering sort_order by position", async () => {
    await saveReceiptState(
      input({
        items: [
          { clientId: "i1", name: "Toast", price: 9.5, quantity: 2 },
          { clientId: "i2", name: "Coffee", price: 4, quantity: 1 },
        ],
      })
    );

    expect(payload().p_items).toEqual([
      { client_id: "i1", name: "Toast", price: 9.5, quantity: 2, sort_order: 0 },
      { client_id: "i2", name: "Coffee", price: 4, quantity: 1, sort_order: 1 },
    ]);
  });

  it("maps participants, defaulting a missing user id to null", async () => {
    await saveReceiptState(
      input({
        participants: [
          {
            clientId: "p1",
            userId: "u1",
            venmoUsername: "alice",
            displayName: "Alice",
            isOwner: true,
          },
          {
            clientId: "p2",
            venmoUsername: "bob",
            displayName: "Bob",
            isOwner: false,
          },
        ],
      })
    );

    expect(payload().p_participants).toEqual([
      {
        client_id: "p1",
        user_id: "u1",
        venmo_username: "alice",
        display_name: "Alice",
        is_owner: true,
      },
      {
        client_id: "p2",
        user_id: null,
        venmo_username: "bob",
        display_name: "Bob",
        is_owner: false,
      },
    ]);
  });

  it("flattens the assignment map into one row per claim", async () => {
    await saveReceiptState(
      input({
        items: [{ clientId: "i1", name: "Toast", price: 9.5, quantity: 1 }],
        participants: [
          { clientId: "p1", venmoUsername: "alice", displayName: "Alice", isOwner: false },
          { clientId: "p2", venmoUsername: "bob", displayName: "Bob", isOwner: false },
        ],
        assignments: { i1: ["p1", "p2"] },
      })
    );

    expect(payload().p_assignments).toEqual([
      { item_client_id: "i1", participant_client_id: "p1" },
      { item_client_id: "i1", participant_client_id: "p2" },
    ]);
  });

  it("drops assignments pointing at an item or participant that is gone", async () => {
    await saveReceiptState(
      input({
        items: [{ clientId: "i1", name: "Toast", price: 9.5, quantity: 1 }],
        participants: [
          { clientId: "p1", venmoUsername: "alice", displayName: "Alice", isOwner: false },
        ],
        assignments: { i1: ["p1", "deleted-participant"], "deleted-item": ["p1"] },
      })
    );

    expect(payload().p_assignments).toEqual([
      { item_client_id: "i1", participant_client_id: "p1" },
    ]);
  });

  it("maps charges by participant client id", async () => {
    await saveReceiptState(
      input({
        participants: [
          { clientId: "p1", venmoUsername: "alice", displayName: "Alice", isOwner: false },
        ],
        charges: [
          {
            participantClientId: "p1",
            amount: 12.34,
            venmoLink: "venmo://paycharge",
            paidAt: "2026-08-18T00:00:00.000Z",
          },
        ],
      })
    );

    expect(payload().p_charges).toEqual([
      {
        participant_client_id: "p1",
        amount: 12.34,
        venmo_link: "venmo://paycharge",
        paid_at: "2026-08-18T00:00:00.000Z",
      },
    ]);
  });

  it("folds a repeated Venmo username into one participant and re-points their claims", async () => {
    await saveReceiptState(
      input({
        items: [{ clientId: "i1", name: "Toast", price: 9.5, quantity: 1 }],
        participants: [
          { clientId: "p1", venmoUsername: "Alice", displayName: "Alice", isOwner: true },
          { clientId: "p2", venmoUsername: "alice", displayName: "alice", isOwner: false },
        ],
        assignments: { i1: ["p2"] },
        charges: [
          { participantClientId: "p2", amount: 5, venmoLink: null, paidAt: null },
        ],
      })
    );

    expect(payload().p_participants).toEqual([
      {
        client_id: "p1",
        user_id: null,
        venmo_username: "Alice",
        display_name: "Alice",
        is_owner: true,
      },
    ]);
    expect(payload().p_assignments).toEqual([
      { item_client_id: "i1", participant_client_id: "p1" },
    ]);
    expect(payload().p_charges).toEqual([
      { participant_client_id: "p1", amount: 5, venmo_link: null, paid_at: null },
    ]);
  });

  it("sends only the receipt columns the caller set", async () => {
    await saveReceiptState(
      input({
        receipt: {
          status: "closed",
          splitMode: "by_item",
          merchantName: "Blue Bottle",
          subtotal: 13.5,
          tax: null,
          tip: 2,
          total: 15.5,
        },
      })
    );

    expect(payload().p_receipt).toEqual({
      status: "closed",
      split_mode: "by_item",
      merchant_name: "Blue Bottle",
      subtotal: 13.5,
      tax: null,
      tip: 2,
      total: 15.5,
    });
  });

  it("leaves status alone for the share flow, which omits it", async () => {
    await saveReceiptState(
      input({ receipt: { splitMode: "by_item", merchantName: "Blue Bottle" } })
    );

    expect(payload().p_receipt).toEqual({
      split_mode: "by_item",
      merchant_name: "Blue Bottle",
    });
    expect("status" in payload().p_receipt).toBe(false);
  });

  it("refreshes the caller's tab list on success", async () => {
    expect(await saveReceiptState(input())).toEqual({});

    expect(revalidatePath).toHaveBeenCalledWith("/receipts/r1");
    expect(updateTag).toHaveBeenCalledWith("receipts:u1");
  });

  it("reports a failed save and leaves the caches alone", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    expect(await saveReceiptState(input())).toEqual({ error: "Couldn't save. Try again." });
    expect(updateTag).not.toHaveBeenCalled();
  });
});
