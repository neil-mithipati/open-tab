import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const rpc = vi.fn();
const getUser = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser }, rpc }),
}));

import { saveReceiptState } from "@/app/actions/saveReceipt";

// ===========================================================================
// An owner save must not destroy a claim that landed after its snapshot.
//
// 0022 closed the window where the claimer is missing from the owner's payload:
// that save is refused with PT409 and rolled back. This is the other window,
// the one a PT409 walks the owner straight into — she reloads, the payload now
// names carol, and the save destroys the fries carol claimed in the meantime
// while reporting success. It happened because every receipt_items row was
// deleted and re-minted with a new id and item_assignments cascades from the
// item side, and because the participant swap re-mints ids too and charges
// cascade from that side.
//
// 0023 gives an item the id the payload already knows, carries share-link
// claims across the swap, and re-points a charge the payload does not restate
// at the participant's new row.
//
// There is no database in this suite, so save_receipt_state is modelled here
// and the model is checked against the SQL it stands in for at the bottom of
// this file. That is weaker than running the RPC — it cannot catch a Postgres
// level surprise — but it does catch the regression this task exists to
// prevent.
// ===========================================================================

type Status = "open" | "shared" | "closed";

interface ParticipantRow {
  id: string;
  venmo_username: string;
  is_owner: boolean;
  joined_via_share: boolean;
  joined_at: string | null;
  created_at: string;
}

interface ItemRow {
  id: string;
  name: string;
  price: number;
}

interface AssignmentRow {
  receipt_item_id: string;
  participant_id: string;
}

interface ChargeRow {
  to_participant_id: string;
  amount: number;
}

interface Db {
  status: Status;
  participants: ParticipantRow[];
  items: ItemRow[];
  assignments: AssignmentRow[];
  charges: ChargeRow[];
}

interface Payload {
  participants: {
    client_id: string;
    venmo_username: string;
    is_owner?: boolean;
  }[];
  /** `id` present only for an item the client read out of the database. */
  items: { client_id: string; id?: string; name: string; price: number }[];
  assignments: { item_client_id: string; participant_client_id: string }[];
  charges: { participant_client_id: string; amount: number }[];
  status?: Status;
}

const SAVED_AT = "2026-08-19T21:00:00.000Z";
const key = (username: string) => username.toLowerCase();

// What 0023's save_receipt_state does, statement by statement. Returns the
// state the call leaves behind: on a refusal that is the state it started in,
// because the raise aborts the transaction the whole function runs in.
//
// `commitsMidFlight` models the narrow window 0022 covers — a join that commits
// while this call is running, after the delete's snapshot was taken and before
// the check.
function applySave(
  db: Db,
  payload: Payload,
  savedAt: string = SAVED_AT,
  commitsMidFlight?: ParticipantRow
): { refused: boolean; db: Db } {
  // v_claiming: the receipt has been out for claiming since this client could
  // have taken its snapshot, so an absent participant may be one it never saw
  // and an absent claim may be one made since.
  const claiming = db.status !== "open";
  // v_known / v_charged: what the payload names, keyed as the unique index keys
  // the table.
  const known = new Set(payload.participants.map((p) => key(p.venmo_username)));
  const usernameOf = (clientId: string) =>
    payload.participants.find((p) => p.client_id === clientId)?.venmo_username;
  const charged = new Set(
    payload.charges
      .map((c) => usernameOf(c.participant_client_id))
      .filter((u): u is string => Boolean(u))
      .map(key)
  );
  // v_prior: provenance the delete is about to destroy (0021).
  const prior = new Map(
    db.participants.map((p) => [
      key(p.venmo_username),
      {
        joined_via_share: p.joined_via_share,
        joined_at: p.joined_at ?? p.created_at,
      },
    ])
  );

  const unseen = (p: ParticipantRow) =>
    claiming && p.joined_via_share && !known.has(key(p.venmo_username));
  const rowById = new Map(db.participants.map((p) => [p.id, p]));

  // v_claims: everything claimed through the share link, read before the
  // deletes take it, keyed by the item's id and the claimer's username.
  const claims = claiming
    ? db.assignments.flatMap((a) => {
        const who = rowById.get(a.participant_id);
        if (!who?.joined_via_share) return [];
        return [{ item_id: a.receipt_item_id, username: key(who.venmo_username) }];
      })
    : [];

  // v_carried_charges: the charges this payload says nothing about, excluding
  // the rows the delete below leaves alone.
  const carried = claiming
    ? db.charges.flatMap((c) => {
        const who = rowById.get(c.to_participant_id);
        if (!who || unseen(who)) return [];
        if (charged.has(key(who.venmo_username))) return [];
        return [{ username: key(who.venmo_username), amount: c.amount }];
      })
    : [];

  // v_live_items / v_items: an item that names a row on this receipt keeps that
  // row's id; anything else is minted fresh, and a repeated id only counts once.
  const live = new Set(db.items.map((i) => i.id));
  const taken = new Set<string>();
  const items = payload.items.map((it, i) => {
    const keeps = it.id !== undefined && live.has(it.id) && !taken.has(it.id);
    if (keeps) taken.add(it.id as string);
    return {
      id: keeps ? (it.id as string) : `item-new-${i}`,
      name: it.name,
      price: it.price,
    };
  });
  const itemIds = new Map(
    payload.items.map((it, i) => [it.client_id, items[i].id])
  );

  // The charge delete, then the participant delete, then the item delete —
  // each skipping the people this payload cannot know about. Every assignment
  // goes: item_assignments cascades from both sides.
  const kept = db.participants.filter(unseen);
  const keptIds = new Set(kept.map((p) => p.id));
  const charges = db.charges.filter((c) => keptIds.has(c.to_participant_id));
  const assignments: AssignmentRow[] = [];

  const inserted = payload.participants.map((p, i) => {
    const was = prior.get(key(p.venmo_username));
    return {
      id: `p-new-${i}`,
      venmo_username: p.venmo_username,
      is_owner: p.is_owner ?? false,
      joined_via_share: was?.joined_via_share ?? false,
      joined_at: was?.joined_at ?? savedAt,
      created_at: savedAt,
    };
  });
  const participants = commitsMidFlight
    ? [...kept, ...inserted, commitsMidFlight]
    : [...kept, ...inserted];

  // 0022's refusal, unchanged: anyone left the payload does not name joined
  // since the snapshot, so nothing is applied.
  if (participants.some(unseen)) {
    return {
      refused: true,
      db: commitsMidFlight
        ? { ...db, participants: [...db.participants, commitsMidFlight] }
        : db,
    };
  }

  const participantIds = new Map(
    payload.participants.map((p, i) => [p.client_id, `p-new-${i}`])
  );

  for (const a of payload.assignments) {
    const itemId = itemIds.get(a.item_client_id);
    const participantId = participantIds.get(a.participant_client_id);
    if (!itemId || !participantId) continue;
    assignments.push({ receipt_item_id: itemId, participant_id: participantId });
  }

  // The claims back, onto the ids that survived. An item the owner deleted is
  // not there to point at, so the claim on it goes too.
  const liveNow = new Set(items.map((i) => i.id));
  const idByUsername = new Map(
    participants.map((p) => [key(p.venmo_username), p.id])
  );
  for (const c of claims) {
    const participantId = idByUsername.get(c.username);
    if (!participantId || !liveNow.has(c.item_id)) continue;
    if (
      assignments.some(
        (a) => a.receipt_item_id === c.item_id && a.participant_id === participantId
      )
    ) {
      continue;
    }
    assignments.push({ receipt_item_id: c.item_id, participant_id: participantId });
  }

  for (const c of payload.charges) {
    const participantId = participantIds.get(c.participant_client_id);
    if (!participantId) continue;
    charges.push({ to_participant_id: participantId, amount: c.amount });
  }
  for (const c of carried) {
    const participantId = idByUsername.get(c.username);
    if (!participantId) continue;
    charges.push({ to_participant_id: participantId, amount: c.amount });
  }

  return {
    refused: false,
    db: {
      status: payload.status ?? db.status,
      participants,
      items,
      assignments,
      charges,
    },
  };
}

// ── the dinner ─────────────────────────────────────────────────────────────
// The owner shared the tab and alice claimed the toast. Carol joined late, the
// owner's first save was refused with PT409, she reloaded — and while she was
// fixing the toast's price carol claimed the fries.

const owner: ParticipantRow = {
  id: "p-owner",
  venmo_username: "neil",
  is_owner: true,
  joined_via_share: false,
  joined_at: "2026-08-19T18:00:00.000Z",
  created_at: "2026-08-19T18:00:00.000Z",
};

const alice: ParticipantRow = {
  id: "p-alice",
  venmo_username: "alice",
  is_owner: false,
  joined_via_share: true,
  joined_at: "2026-08-19T19:30:00.000Z",
  created_at: "2026-08-19T19:30:00.000Z",
};

const carol: ParticipantRow = {
  id: "p-carol",
  venmo_username: "Carol",
  is_owner: false,
  joined_via_share: true,
  joined_at: "2026-08-19T19:59:00.000Z",
  created_at: "2026-08-19T19:59:00.000Z",
};

function dinner(over: Partial<Db> = {}): Db {
  return {
    status: "shared",
    participants: [owner, alice, carol],
    items: [
      { id: "item-toast", name: "Toast", price: 9.5 },
      { id: "item-fries", name: "Fries", price: 6 },
    ],
    assignments: [
      { receipt_item_id: "item-toast", participant_id: "p-alice" },
      // Claimed after the owner's page reloaded, so no payload names it.
      { receipt_item_id: "item-fries", participant_id: "p-carol" },
    ],
    charges: [{ to_participant_id: "p-carol", amount: 7.25 }],
    ...over,
  };
}

// What the owner's browser holds after the reload: everyone, including carol,
// with the toast reprised at a corrected price — and the ids it read the two
// items from.
function reloaded(over: Partial<Payload> = {}): Payload {
  return {
    participants: [
      { client_id: "p-p-owner", venmo_username: "neil", is_owner: true },
      { client_id: "p-p-alice", venmo_username: "alice" },
      { client_id: "p-p-carol", venmo_username: "carol" },
    ],
    items: [
      { client_id: "item-item-toast", id: "item-toast", name: "Toast", price: 10.5 },
      { client_id: "item-item-fries", id: "item-fries", name: "Fries", price: 6 },
    ],
    assignments: [
      { item_client_id: "item-item-toast", participant_client_id: "p-p-alice" },
    ],
    charges: [],
    ...over,
  };
}

describe("a save that predates someone's claim", () => {
  // The whole task. On 0022 this save succeeded and left carol's row alive
  // with her claim on the fries and her charge both gone.
  it("keeps the late claim and the charge of someone the payload does name", () => {
    const { refused, db } = applySave(dinner(), reloaded());

    expect(refused).toBe(false);
    const carolId = db.participants.find((p) => key(p.venmo_username) === "carol")!.id;
    expect(db.assignments).toContainEqual({
      receipt_item_id: "item-fries",
      participant_id: carolId,
    });
    expect(db.charges).toEqual([{ to_participant_id: carolId, amount: 7.25 }]);
    // And the owner's own edit still landed.
    expect(db.items.map((i) => i.price)).toEqual([10.5, 6]);
  });

  // The mechanism. Without a stable item id there is nothing for the claim to
  // be restored onto, which is why this is asserted separately from the claim.
  it("keeps the id of every item the payload was read from", () => {
    const { db } = applySave(dinner(), reloaded());

    expect(db.items.map((i) => i.id)).toEqual(["item-toast", "item-fries"]);
  });

  it("mints an id for an item the owner has just typed in", () => {
    const payload = reloaded({
      items: [
        { client_id: "item-item-toast", id: "item-toast", name: "Toast", price: 10.5 },
        { client_id: "item-item-fries", id: "item-fries", name: "Fries", price: 6 },
        { client_id: "new-item", name: "Coffee", price: 4 },
      ],
    });
    const { db } = applySave(dinner(), payload);

    expect(db.items.map((i) => i.id)).toEqual([
      "item-toast",
      "item-fries",
      "item-new-2",
    ]);
  });

  // An id the payload has no business naming — a row on another tab, or one
  // already deleted — is not honoured.
  it("mints a fresh id for an item id that is not on this receipt", () => {
    const payload = reloaded({
      items: [
        { client_id: "item-item-toast", id: "item-somewhere-else", name: "Toast", price: 10.5 },
      ],
    });
    const { db } = applySave(dinner(), payload);

    expect(db.items).toEqual([{ id: "item-new-0", name: "Toast", price: 10.5 }]);
  });

  // The charge is only carried when the payload says nothing about that person;
  // an owner who recomputes must not end up with two.
  it("replaces a charge the payload restates rather than doubling it", () => {
    const payload = reloaded({
      charges: [{ participant_client_id: "p-p-carol", amount: 9.1 }],
    });
    const { db } = applySave(dinner(), payload);

    expect(db.charges).toHaveLength(1);
    expect(db.charges[0].amount).toBe(9.1);
  });

  it("carries nothing across while the receipt is still open", () => {
    // Nothing can have been claimed behind an open receipt's back, so the
    // payload is authoritative and the owner can take a claim off the tab.
    const reopened = dinner({ status: "open" });
    const { refused, db } = applySave(reopened, reloaded({ status: "open" }));

    expect(refused).toBe(false);
    expect(db.assignments).toEqual([
      { receipt_item_id: "item-toast", participant_id: "p-new-1" },
    ]);
    expect(db.charges).toEqual([]);
  });
});

describe("what the owner deliberately removes still goes", () => {
  it("deletes an item the owner deleted, and the claim on it with it", () => {
    const payload = reloaded({
      items: [
        { client_id: "item-item-toast", id: "item-toast", name: "Toast", price: 10.5 },
      ],
    });
    const { db } = applySave(dinner(), payload);

    expect(db.items.map((i) => i.name)).toEqual(["Toast"]);
    expect(
      db.assignments.some((a) => a.receipt_item_id === "item-fries")
    ).toBe(false);
  });

  it("removes a participant the owner removed while the receipt is open", () => {
    const reopened = dinner({
      status: "open",
      participants: [
        owner,
        { ...alice, venmo_username: "dave", id: "p-dave", joined_via_share: false },
      ],
      assignments: [],
      charges: [],
    });
    const payload = reloaded({
      participants: [{ client_id: "p-p-owner", venmo_username: "neil", is_owner: true }],
      assignments: [],
      status: "open",
    });

    const { refused, db } = applySave(reopened, payload);

    expect(refused).toBe(false);
    expect(db.participants.map((p) => p.venmo_username)).toEqual(["neil"]);
  });
});

describe("0022's refusal is still armed", () => {
  // The other window. Carol is on the tab and the payload does not name her,
  // so the save is refused and rolled back whole — items included, which is
  // what the item ids being stable must not quietly undo.
  it("refuses a save whose payload does not name a share-link joiner", () => {
    const before = dinner();
    const stale = reloaded({
      participants: [
        { client_id: "p-p-owner", venmo_username: "neil", is_owner: true },
        { client_id: "p-p-alice", venmo_username: "alice" },
      ],
      status: "closed",
    });

    const { refused, db } = applySave(before, stale);

    expect(refused).toBe(true);
    expect(db).toEqual(before);
  });

  it("refuses when the join commits while the save is running", () => {
    const before = dinner({
      participants: [owner, alice],
      assignments: [{ receipt_item_id: "item-toast", participant_id: "p-alice" }],
      charges: [],
    });
    const stale = reloaded({
      participants: [
        { client_id: "p-p-owner", venmo_username: "neil", is_owner: true },
        { client_id: "p-p-alice", venmo_username: "alice" },
      ],
    });

    const { refused, db } = applySave(before, stale, SAVED_AT, carol);

    expect(refused).toBe(true);
    expect(db.participants.map((p) => p.venmo_username)).toContain("Carol");
    expect(db.items).toEqual(before.items);
  });
});

describe("0021's provenance still survives a save", () => {
  it("keeps joined_via_share and joined_at for everyone the payload names", () => {
    const { db } = applySave(dinner(), reloaded());

    const saved = db.participants.find((p) => key(p.venmo_username) === "carol");
    expect(saved?.joined_via_share).toBe(true);
    expect(saved?.joined_at).toBe(carol.joined_at);
    const me = db.participants.find((p) => p.venmo_username === "neil");
    expect(me?.joined_via_share).toBe(false);
    expect(me?.joined_at).toBe(owner.joined_at);
  });

  it("treats a participant the payload introduces as new", () => {
    const payload = reloaded({
      participants: [
        ...reloaded().participants,
        { client_id: "new-1", venmo_username: "dave" },
      ],
    });
    const { db } = applySave(dinner(), payload);

    const dave = db.participants.find((p) => p.venmo_username === "dave");
    expect(dave?.joined_via_share).toBe(false);
    expect(dave?.joined_at).toBe(SAVED_AT);
  });
});

// ===========================================================================
// The model above is only worth anything if it matches the migration it stands
// in for, so the SQL is read here and checked for what the model assumes and
// what the task requires. Same approach as the other tests in this directory:
// no database, so assert the shape of the statement.
// ===========================================================================

const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "0023_save_receipt_state_keep_late_claims.sql"
  ),
  "utf8"
);

// `--` line comments only; nothing in this file puts one inside a literal.
const sql = migration
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

describe("migration 0023", () => {
  it("re-uses an item id the payload names, when it is a row on this receipt", () => {
    expect(sql).toMatch(
      /jsonb_object_agg\(ri\.id::text, true\)[\s\S]*into v_live_items from receipt_items ri where ri\.receipt_id = p_receipt_id/
    );
    expect(sql).toContain(
      "when i.id is not null and v_live_items ? i.id::text and row_number() over ( partition by i.id order by coalesce(i.sort_order, 0), i.client_id ) = 1 then i.id else gen_random_uuid() end as id"
    );
    // The payload has to be able to say it at all.
    expect(sql).toContain("as i(client_id text, id uuid, name text, price numeric");
  });

  it("reads the claims before the delete and puts them back after the insert", () => {
    const read = sql.indexOf("into v_claims");
    const del = sql.indexOf("delete from receipt_items where receipt_id = p_receipt_id");
    const restore = sql.indexOf(
      "insert into item_assignments (receipt_item_id, participant_id, quantity_assigned)"
    );

    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(del);
    expect(restore).toBeGreaterThan(del);
    // Only claims made through the share link, and only while the receipt is
    // out for claiming — otherwise an owner un-assigning would be overruled.
    expect(sql).toContain(
      "where ri.receipt_id = p_receipt_id and v_claiming and rp.joined_via_share"
    );
    // Keyed by the item's id and the claimer's username, because her row id
    // does not survive the participant swap.
    expect(sql).toContain("'item_id', ia.receipt_item_id, 'username', lower(rp.venmo_username)");
  });

  it("drops a restored claim whose item the owner deleted", () => {
    expect(sql).toContain(
      "where exists ( select 1 from receipt_items ri where ri.id = k.item_id and ri.receipt_id = p_receipt_id )"
    );
    expect(sql).toContain("on conflict (receipt_item_id, participant_id) do nothing");
  });

  it("carries only the charges the payload does not restate", () => {
    expect(sql).toMatch(
      /jsonb_object_agg\(lower\(p\.venmo_username\), true\)[\s\S]*into v_charged/
    );
    expect(sql).toContain(
      "where c.receipt_id = p_receipt_id and v_claiming and not (v_charged ? lower(rp.venmo_username)) and not (rp.joined_via_share and not (v_known ? lower(rp.venmo_username)))"
    );
    const carry = sql.indexOf("from jsonb_to_recordset(v_carried_charges)");
    expect(carry).toBeGreaterThan(sql.indexOf("insert into receipt_participants"));
  });

  it("leaves 0022's refusal path exactly where it was", () => {
    expect(sql).toContain("v_claiming := v_status is distinct from 'open'");
    expect(sql).toContain(
      "delete from receipt_participants rp where rp.receipt_id = p_receipt_id and not ( v_claiming and rp.joined_via_share and not (v_known ? lower(rp.venmo_username)) )"
    );
    const insert = sql.indexOf("insert into receipt_participants");
    const raise = sql.indexOf(
      "raise exception 'save_receipt_state: a participant joined since this client loaded the receipt'"
    );
    expect(raise).toBeGreaterThan(insert);
    expect(migration).toContain("errcode = 'PT409'");
  });

  it("leaves the delete-and-re-insert atomicity alone", () => {
    expect(sql).toContain("delete from receipt_items where receipt_id = p_receipt_id");
    // Transaction control inside the function would end the one guarantee the
    // RPC exists to give: the refusal has to roll the call back by raising.
    expect(sql).not.toContain("commit");
    expect(sql).not.toContain("rollback");
    expect(sql).not.toContain("begin transaction");
  });

  it("carries 0021's provenance columns through unchanged", () => {
    expect(sql).toContain(
      "insert into receipt_participants (id, receipt_id, user_id, venmo_username, display_name, is_owner, joined_via_share, joined_at) select r.id, p_receipt_id, r.user_id, r.venmo_username, r.display_name, r.is_owner, r.joined_via_share, r.joined_at"
    );
    expect(sql).toMatch(/coalesce\(rp\.joined_at, rp\.created_at\)/);
    expect(sql.indexOf("into v_prior")).toBeLessThan(
      sql.indexOf("delete from receipt_participants rp")
    );
  });

  it("keeps the ownership gate on a security definer function", () => {
    expect(sql).toContain(
      "language plpgsql security definer set search_path = public"
    );
    expect(sql).toContain("if auth.uid() is null then");
    expect(sql).toContain("if v_owner is null or v_owner <> auth.uid() then");
    expect(sql).toContain(
      "revoke execute on function public.save_receipt_state(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public"
    );
    expect(sql).toContain("to authenticated, service_role");
  });

  it("is additive: replaces a function body and touches nothing else", () => {
    expect(sql.slice(0, sql.indexOf("create or replace function")).trim()).toBe("");
    expect(sql).not.toContain("alter table");
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("drop column");
    expect(sql).not.toContain("truncate");
  });
});

// ===========================================================================
// The client half: an item's row id only reaches the function if the action
// sends it, and it must never send one the function cannot read.
// ===========================================================================

const base = {
  receiptId: "r1",
  items: [] as { clientId: string; dbId?: string | null; name: string; price: number; quantity: number }[],
  participants: [],
  assignments: {},
  charges: [],
  receipt: {},
};

const ID_A = "3f1a2b4c-5d6e-4f80-9a1b-2c3d4e5f6071";
const ID_B = "4f1a2b4c-5d6e-4f80-9a1b-2c3d4e5f6072";

const payload = () => rpc.mock.calls[0][1] as { p_items: Record<string, unknown>[] };

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } } });
});

describe("saveReceiptState sends the item's row id", () => {
  it("passes the db id through as the item's id", async () => {
    await saveReceiptState({
      ...base,
      items: [{ clientId: "i1", dbId: ID_A, name: "Toast", price: 9.5, quantity: 1 }],
    });

    expect(payload().p_items).toEqual([
      { client_id: "i1", id: ID_A, name: "Toast", price: 9.5, quantity: 1, sort_order: 0 },
    ]);
  });

  it("omits the key entirely for an item that has no row yet", async () => {
    await saveReceiptState({
      ...base,
      items: [{ clientId: "i1", name: "Toast", price: 9.5, quantity: 1 }],
    });

    expect(payload().p_items[0]).not.toHaveProperty("id");
  });

  it("drops an id that is not a uuid rather than failing the whole save", async () => {
    await saveReceiptState({
      ...base,
      items: [{ clientId: "i1", dbId: "not-a-uuid", name: "Toast", price: 9.5, quantity: 1 }],
    });

    expect(payload().p_items[0]).not.toHaveProperty("id");
  });

  it("keeps a repeated id for the first item only", async () => {
    await saveReceiptState({
      ...base,
      items: [
        { clientId: "i1", dbId: ID_A, name: "Toast", price: 9.5, quantity: 1 },
        { clientId: "i2", dbId: ID_A, name: "Toast", price: 9.5, quantity: 1 },
        { clientId: "i3", dbId: ID_B, name: "Fries", price: 6, quantity: 1 },
      ],
    });

    expect(payload().p_items.map((it) => it.id)).toEqual([ID_A, undefined, ID_B]);
  });
});
