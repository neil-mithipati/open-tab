import { describe, it, expect, vi, beforeEach } from "vitest";

// Writer 2 of 2 into `charges` (the other is the save_receipt_state RPC).
// Migration 0019 gives that table a `with check` requiring the row's receipt
// to be one the caller owns, so what matters here is the shape of the rows
// this path writes: the receipt it was asked to close, stamped with that
// receipt's owner. This action reaches the table through the service-role
// client, which bypasses RLS — so the policy is not what keeps it honest, and
// these tests are what does.

const revalidatePath = vi.fn();
const updateTag = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
  updateTag: (...args: unknown[]) => updateTag(...args),
}));

type Row = Record<string, unknown>;

let sessionUser: { id: string } | null = null;
let receiptRow: Row | null = null;
let itemRows: Row[] = [];
let participantRows: Row[] = [];
let insertedCharges: Row[] = [];
let insertError: unknown = null;
let ops: string[] = [];

function receiptsChain() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.single = async () => {
    ops.push("receipts.select");
    return { data: receiptRow };
  };
  return chain;
}

// Read with `.order()` and awaited directly, so the builder resolves itself.
function itemsChain() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.then = (resolve: (v: { data: Row[] }) => void) => resolve({ data: itemRows });
  return chain;
}

function participantsChain() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.then = (resolve: (v: { data: Row[] }) => void) =>
    resolve({ data: participantRows });
  return chain;
}

function profilesChain() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.single = async () => ({ data: { venmo_username: "owner-fallback" } });
  return chain;
}

function chargesChain() {
  const chain: Record<string, unknown> = {};
  let verb = "";
  chain.delete = () => {
    verb = "delete";
    return chain;
  };
  chain.insert = (rows: Row[]) => {
    verb = "insert";
    insertedCharges.push(...rows);
    return chain;
  };
  chain.eq = () => chain;
  chain.then = (resolve: (v: { error: unknown }) => void) => {
    ops.push(`charges.${verb}`);
    return resolve({ error: verb === "insert" ? insertError : null });
  };
  return chain;
}

function client() {
  return {
    auth: { getUser: async () => ({ data: { user: sessionUser } }) },
    from: (table: string) => {
      if (table === "receipts") return receiptsChain();
      if (table === "receipt_items") return itemsChain();
      if (table === "receipt_participants") return participantsChain();
      if (table === "profiles") return profilesChain();
      if (table === "charges") return chargesChain();
      throw new Error(`unexpected table ${table}`);
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => client(),
  getSupabaseServiceClient: async () => client(),
}));

async function run(receiptId = "r1") {
  const { closeClaiming } = await import("@/app/actions/claim");
  return closeClaiming(receiptId);
}

// The predicate migration 0019 puts on inserts into `charges`, written out:
//
//   auth.uid() = from_user_id
//   and public.receipt_creator_id(receipt_id) = auth.uid()
//
// `owners` stands in for what `receipt_creator_id` reads.
function policyAccepts(row: Row, uid: string, owners: Record<string, string>) {
  return row.from_user_id === uid && owners[row.receipt_id as string] === uid;
}

beforeEach(() => {
  sessionUser = { id: "owner" };
  receiptRow = {
    id: "r1",
    created_by: "owner",
    status: "shared",
    share_token: "tok",
    merchant_name: "Cafe",
    date_of_receipt: null,
    tax: 0,
    tip: 0,
  };
  itemRows = [
    {
      id: "i1",
      name: "Toast",
      price: 20,
      quantity: 1,
      item_assignments: [{ participant_id: "p2" }],
    },
  ];
  participantRows = [
    {
      id: "p1",
      user_id: "owner",
      venmo_username: "owner-venmo",
      display_name: "Owner",
      is_owner: true,
    },
    {
      id: "p2",
      user_id: null,
      venmo_username: "bob",
      display_name: "Bob",
      is_owner: false,
    },
  ];
  insertedCharges = [];
  insertError = null;
  ops = [];
  revalidatePath.mockReset();
  updateTag.mockReset();
});

describe("closeClaiming — the rows it writes", () => {
  it("stamps the receipt's owner on every charge, and the receipt it closed", async () => {
    const result = await run();

    expect(result).toEqual({});
    expect(insertedCharges).toHaveLength(1);
    expect(insertedCharges[0]).toMatchObject({
      receipt_id: "r1",
      from_user_id: "owner",
      to_participant_id: "p2",
    });
  });

  // The point of the test above, made against the policy itself: what this
  // path writes is exactly what 0019 accepts, so tightening the check cannot
  // break the claim flow.
  it("writes only rows the 0019 with check accepts", async () => {
    await run();

    expect(insertedCharges.length).toBeGreaterThan(0);
    for (const row of insertedCharges) {
      expect(policyAccepts(row, "owner", { r1: "owner" })).toBe(true);
    }
  });

  it("clears the old charges before inserting the new ones", async () => {
    await run();

    expect(ops.filter((o) => o.startsWith("charges."))).toEqual([
      "charges.delete",
      "charges.insert",
    ]);
  });

  it("reports a failed insert instead of pretending the tab was closed", async () => {
    insertError = { message: "boom" };

    expect(await run()).toEqual({ error: "Couldn't create charges. Try again." });
  });
});

describe("closeClaiming — who may write", () => {
  it("refuses a signed-in caller who does not own the receipt", async () => {
    sessionUser = { id: "mallory" };

    expect(await run()).toEqual({ error: "Not found." });
    expect(insertedCharges).toEqual([]);
  });

  it("refuses with no session at all", async () => {
    sessionUser = null;

    expect(await run()).toEqual({ error: "Not signed in." });
    expect(insertedCharges).toEqual([]);
  });
});
