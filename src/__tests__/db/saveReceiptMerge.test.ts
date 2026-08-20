import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

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

import { saveReceiptState } from "@/app/actions/saveReceipt";

// ===========================================================================
// An owner save must not delete people it never saw.
//
// The owner's browser holds a snapshot of the participant list, taken when the
// editor rendered. Anyone who joins through the share link after that moment is
// missing from it, and 0016..0021 applied that list by deleting every
// participant and re-inserting the payload — so the joiner, their claims and
// their charges went with it. 0022 makes the delete skip people the payload
// cannot know about and then refuses the save outright, rolling the whole call
// back, rather than writing a list that old.
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
  items: { client_id: string; name: string; price: number }[];
  assignments: { item_client_id: string; participant_client_id: string }[];
  charges: { participant_client_id: string; amount: number }[];
  status?: Status;
}

const SAVED_AT = "2026-08-19T20:00:00.000Z";
const key = (username: string) => username.toLowerCase();

// What 0022's save_receipt_state does, statement by statement. Returns the
// state the call leaves behind: on a refusal that is the state it started in,
// because the raise aborts the transaction the whole function runs in.
//
// `commitsMidFlight` models the second, narrower window — a join that commits
// while this call is running, after the delete's snapshot was taken and before
// the check. Under READ COMMITTED that row is invisible to the delete (so the
// delete cannot take it) and visible to the check, which is a later statement
// and so a later snapshot. It is also why the check sits after the swap rather
// than before it.
function applySave(
  db: Db,
  payload: Payload,
  savedAt: string = SAVED_AT,
  commitsMidFlight?: ParticipantRow
): { refused: boolean; db: Db } {
  // v_claiming: the receipt has been out for claiming since this client could
  // have taken its snapshot, so an absent participant may be one it never saw.
  const claiming = db.status !== "open";
  // v_known: the usernames the payload names, keyed as the unique index keys
  // the table.
  const known = new Set(payload.participants.map((p) => key(p.venmo_username)));
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

  // The charge delete, then the participant delete, then the item delete —
  // each skipping the people this payload cannot know about.
  const kept = db.participants.filter(unseen);
  const keptIds = new Set(kept.map((p) => p.id));
  const charges = db.charges.filter((c) => keptIds.has(c.to_participant_id));
  // Every item row goes, and item_assignments cascade from the item side, so
  // no assignment survives the swap — not even a kept participant's.
  const assignments: AssignmentRow[] = [];

  const items = payload.items.map((it, i) => ({
    id: `item-new-${i}`,
    name: it.name,
    price: it.price,
  }));
  const itemIds = new Map(payload.items.map((it, i) => [it.client_id, `item-new-${i}`]));

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
  const participantIds = new Map(
    payload.participants.map((p, i) => [p.client_id, `p-new-${i}`])
  );

  // Whatever the check is about to look at: the rows the delete left, the rows
  // just inserted, and anyone whose join committed while we worked.
  const participants = commitsMidFlight
    ? [...kept, ...inserted, commitsMidFlight]
    : [...kept, ...inserted];

  // Anyone left the payload does not name joined since the snapshot. Nothing
  // is applied: the raise rolls the call back to where it started — which
  // still leaves the mid-flight joiner, since that was somebody else's commit.
  if (participants.some(unseen)) {
    return {
      refused: true,
      db: commitsMidFlight
        ? { ...db, participants: [...db.participants, commitsMidFlight] }
        : db,
    };
  }

  for (const a of payload.assignments) {
    const itemId = itemIds.get(a.item_client_id);
    const participantId = participantIds.get(a.participant_client_id);
    if (!itemId || !participantId) continue;
    assignments.push({ receipt_item_id: itemId, participant_id: participantId });
  }
  for (const c of payload.charges) {
    const participantId = participantIds.get(c.participant_client_id);
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
// Owner shared the tab, alice claimed the toast, then carol opened the link
// and claimed the fries — after the owner's editor had already rendered.

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
      { receipt_item_id: "item-fries", participant_id: "p-carol" },
    ],
    charges: [{ to_participant_id: "p-carol", amount: 7.25 }],
    ...over,
  };
}

// What the owner's browser holds: the list as it was before carol arrived,
// with the toast reprised at a corrected price.
function staleSnapshot(over: Partial<Payload> = {}): Payload {
  return {
    participants: [
      { client_id: "p-p-owner", venmo_username: "neil", is_owner: true },
      { client_id: "p-p-alice", venmo_username: "alice" },
    ],
    items: [
      { client_id: "item-item-toast", name: "Toast", price: 10.5 },
      { client_id: "item-item-fries", name: "Fries", price: 6 },
    ],
    assignments: [
      { item_client_id: "item-item-toast", participant_client_id: "p-p-alice" },
    ],
    charges: [],
    status: "closed",
    ...over,
  };
}

describe("a save that predates someone's join", () => {
  // The whole task. Before 0022 this save deleted carol, her claim on the
  // fries and her charge, and reported success. The assertions lead on what is
  // left of carol rather than on the refusal flag, so a change that refuses for
  // the wrong reason — or keeps her row but drops what she claimed — still
  // fails here.
  it("keeps the claimer, their claim and their charge", () => {
    const before = dinner();
    const { refused, db } = applySave(before, staleSnapshot());

    expect(db.participants.map((p) => p.venmo_username)).toContain("Carol");
    expect(db.assignments).toContainEqual({
      receipt_item_id: "item-fries",
      participant_id: "p-carol",
    });
    expect(db.charges).toEqual([{ to_participant_id: "p-carol", amount: 7.25 }]);
    expect(refused).toBe(true);
  });

  // The narrow window. Carol's join commits while the save is mid-flight, so
  // the delete never saw her row — and the check, a later statement and so a
  // later snapshot, is the only thing between her and a save built from a list
  // that does not name her.
  it("keeps a claimer whose join commits while the save is running", () => {
    const before = dinner({
      participants: [owner, alice],
      assignments: [{ receipt_item_id: "item-toast", participant_id: "p-alice" }],
      charges: [],
    });
    const { refused, db } = applySave(before, staleSnapshot(), SAVED_AT, carol);

    expect(db.participants.map((p) => p.venmo_username)).toContain("Carol");
    expect(refused).toBe(true);
    // Her join was somebody else's commit, so the rollback leaves it: carol is
    // on the tab and nothing of the owner's save is.
    expect(db.items).toEqual(before.items);
    expect(db.status).toBe("shared");
  });

  // A refusal is only worth anything if it takes the rest of the save with it.
  // A half-applied save is what 0105 and 0113 made impossible and 0022 does not
  // renegotiate.
  it("applies nothing else either — no items, no status, no charges", () => {
    const before = dinner();
    const { db } = applySave(before, staleSnapshot());

    expect(db.items).toEqual(before.items);
    expect(db.status).toBe("shared");
    expect(db).toEqual(before);
  });

  it("goes through once the owner reloads and the payload names them", () => {
    const fresh = staleSnapshot({
      participants: [
        { client_id: "p-p-owner", venmo_username: "neil", is_owner: true },
        { client_id: "p-p-alice", venmo_username: "alice" },
        { client_id: "p-p-carol", venmo_username: "carol" },
      ],
      assignments: [
        { item_client_id: "item-item-toast", participant_client_id: "p-p-alice" },
        { item_client_id: "item-item-fries", participant_client_id: "p-p-carol" },
      ],
    });
    const { refused, db } = applySave(dinner(), fresh);

    expect(refused).toBe(false);
    expect(db.participants.map((p) => p.venmo_username.toLowerCase())).toEqual([
      "neil",
      "alice",
      "carol",
    ]);
    // Matched on lower(venmo_username), so "Carol" in the table and "carol" in
    // the payload are the same person, and she keeps her provenance.
    const saved = db.participants.find((p) => key(p.venmo_username) === "carol");
    expect(saved?.joined_via_share).toBe(true);
    expect(saved?.joined_at).toBe(carol.joined_at);
    expect(db.assignments).toHaveLength(2);
  });

  it("does not refuse when nobody has joined since", () => {
    const quiet = dinner({
      participants: [owner, alice],
      assignments: [{ receipt_item_id: "item-toast", participant_id: "p-alice" }],
      charges: [],
    });
    const { refused, db } = applySave(quiet, staleSnapshot());

    expect(refused).toBe(false);
    expect(db.items.map((i) => i.price)).toEqual([10.5, 6]);
    expect(db.status).toBe("closed");
  });
});

describe("the owner's own edits still apply", () => {
  it("writes edited items, added participants and the receipt columns", () => {
    const quiet = dinner({
      participants: [owner, alice],
      assignments: [],
      charges: [],
    });
    const payload = staleSnapshot({
      participants: [
        { client_id: "p-p-owner", venmo_username: "neil", is_owner: true },
        { client_id: "p-p-alice", venmo_username: "alice" },
        { client_id: "new-1", venmo_username: "dave" },
      ],
      assignments: [
        { item_client_id: "item-item-toast", participant_client_id: "new-1" },
      ],
      charges: [{ participant_client_id: "new-1", amount: 5.25 }],
    });

    const { refused, db } = applySave(quiet, payload);

    expect(refused).toBe(false);
    expect(db.items).toEqual([
      { id: "item-new-0", name: "Toast", price: 10.5 },
      { id: "item-new-1", name: "Fries", price: 6 },
    ]);
    expect(db.participants.map((p) => p.venmo_username)).toEqual([
      "neil",
      "alice",
      "dave",
    ]);
    // Typed in by the owner, so not a share join, and they join now.
    const dave = db.participants.find((p) => p.venmo_username === "dave");
    expect(dave?.joined_via_share).toBe(false);
    expect(dave?.joined_at).toBe(SAVED_AT);
    expect(db.assignments).toEqual([
      { receipt_item_id: "item-new-0", participant_id: "p-new-2" },
    ]);
    expect(db.charges).toEqual([{ to_participant_id: "p-new-2", amount: 5.25 }]);
  });

  // The fix is not "stop deleting". Someone the owner took off the tab has to
  // come off it.
  it("removes a participant the owner removed, while claiming is open", () => {
    const quiet = dinner({
      participants: [
        owner,
        {
          ...alice,
          venmo_username: "dave",
          id: "p-dave",
          // Typed in by the owner, not a share-link joiner.
          joined_via_share: false,
        },
      ],
      assignments: [],
      charges: [],
    });
    const payload = staleSnapshot({
      participants: [
        { client_id: "p-p-owner", venmo_username: "neil", is_owner: true },
      ],
      assignments: [],
    });

    const { refused, db } = applySave(quiet, payload);

    expect(refused).toBe(false);
    expect(db.participants.map((p) => p.venmo_username)).toEqual(["neil"]);
  });

  // "Reopen editing" puts the receipt back to open, which is also the only
  // state joinReceipt refuses to join — so an absent claimer there is one the
  // owner deliberately took off, and they go.
  it("removes a share-link claimer the owner removed after reopening", () => {
    const reopened = dinner({ status: "open", charges: [] });
    const payload = staleSnapshot({
      participants: [
        { client_id: "p-p-owner", venmo_username: "neil", is_owner: true },
        { client_id: "p-p-alice", venmo_username: "alice" },
      ],
      status: "open",
    });

    const { refused, db } = applySave(reopened, payload);

    expect(refused).toBe(false);
    expect(db.participants.map((p) => p.venmo_username)).toEqual([
      "neil",
      "alice",
    ]);
    // And alice, who is still on the tab, keeps what 0021 gave her.
    const kept = db.participants.find((p) => p.venmo_username === "alice");
    expect(kept?.joined_via_share).toBe(true);
    expect(kept?.joined_at).toBe(alice.joined_at);
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
    "0022_save_receipt_state_merge_participants.sql"
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

describe("migration 0022", () => {
  it("reads the status before the update that can move it on", () => {
    expect(sql).toContain(
      "select created_by, status into v_owner, v_status from receipts where id = p_receipt_id"
    );
    expect(sql).toContain("v_claiming := v_status is distinct from 'open'");
    expect(sql.indexOf("v_claiming := v_status")).toBeLessThan(
      sql.indexOf("update receipts r set")
    );
  });

  it("keys the payload's usernames the way the unique index keys the table", () => {
    expect(sql).toMatch(
      /jsonb_object_agg\(lower\(p\.venmo_username\), true\)[\s\S]*into v_known/
    );
  });

  it("leaves participants the payload cannot know about where they are", () => {
    expect(sql).toContain(
      "delete from receipt_participants rp where rp.receipt_id = p_receipt_id and not ( v_claiming and rp.joined_via_share and not (v_known ? lower(rp.venmo_username)) )"
    );
  });

  it("leaves their charges alone too", () => {
    expect(sql).toContain(
      "delete from charges c where c.receipt_id = p_receipt_id and not exists ( select 1 from receipt_participants rp where rp.id = c.to_participant_id and v_claiming and rp.joined_via_share and not (v_known ? lower(rp.venmo_username)) )"
    );
  });

  it("refuses the save after the swap, so a join landing mid-flight is caught", () => {
    const del = sql.indexOf("delete from receipt_participants rp");
    const insert = sql.indexOf("insert into receipt_participants");
    const raise = sql.indexOf(
      "raise exception 'save_receipt_state: a participant joined since this client loaded the receipt'"
    );

    expect(del).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(del);
    expect(raise).toBeGreaterThan(insert);
    // The code the server action turns into "someone just joined, reload".
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
// The client half of the same refusal: the owner has to be told to reload,
// not told to try again — trying again sends the same stale list.
// ===========================================================================

const input = {
  receiptId: "r1",
  items: [],
  participants: [],
  assignments: {},
  charges: [],
  receipt: {},
};

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } } });
  revalidatePath.mockReset();
  updateTag.mockReset();
});

describe("saveReceiptState on a refused save", () => {
  it("tells the owner to reload when someone joined since the page loaded", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "PT409",
        message:
          "save_receipt_state: a participant joined since this client loaded the receipt",
      },
    });

    expect(await saveReceiptState(input)).toEqual({
      error: "Someone just joined this tab. Reload to see them.",
    });
    expect(updateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("still reports any other failure as a failed save", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "not signed in" },
    });

    expect(await saveReceiptState(input)).toEqual({
      error: "Couldn't save. Try again.",
    });
  });
});
