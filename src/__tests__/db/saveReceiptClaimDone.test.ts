import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ===========================================================================
// An owner save must not erase a claimer's "done".
//
// claim_done_at (0011) is null while a friend is still picking items and set
// the moment she taps Done. save_receipt_state deletes every participant row
// and re-inserts it, and up to 0023 the insert did not list the column — so it
// came back null and the owner's view put a finished claimer back in the
// still-claiming list. Same shape as the bug 0021 fixed for joined_via_share
// and joined_at: the swap drops a column that records the claimer's own
// actions rather than anything the owner's payload states.
//
// 0024 carries it across, keyed on lower(venmo_username) as 0021 does. There
// is no database in this suite, so the swap is modelled here and the model is
// checked against the SQL it stands in for at the bottom of this file. That is
// weaker than running the RPC — this one was also run against real Postgres
// under PGlite while it was written — but it is what keeps a later edit from
// quietly dropping the column again.
// ===========================================================================

type Status = "open" | "shared" | "closed";

interface ParticipantRow {
  id: string;
  venmo_username: string;
  is_owner: boolean;
  joined_via_share: boolean;
  joined_at: string | null;
  created_at: string;
  /** Null means still claiming. Only the claimer's own toggle writes it. */
  claim_done_at: string | null;
}

interface Db {
  status: Status;
  participants: ParticipantRow[];
}

/**
 * What the owner's browser sends. There is deliberately no claim_done_at here:
 * saveReceipt.ts has no field for it, which is why the save can express no
 * intent about it and the stored value is simply carried.
 */
interface Payload {
  participants: { client_id: string; venmo_username: string; is_owner?: boolean }[];
}

const SAVED_AT = "2026-08-19T21:00:00.000Z";
const key = (username: string) => username.toLowerCase();

// The participant half of 0024's save_receipt_state, statement by statement:
// read the prior rows, delete, re-insert from the payload with the prior
// values written back.
function applySave(db: Db, payload: Payload, savedAt: string = SAVED_AT): Db {
  // v_prior: what the delete is about to destroy that the payload cannot
  // replace, keyed the way 0016's unique index keys the table.
  const prior = new Map(
    db.participants.map((p) => [
      key(p.venmo_username),
      {
        joined_via_share: p.joined_via_share,
        joined_at: p.joined_at ?? p.created_at,
        claim_done_at: p.claim_done_at,
      },
    ])
  );

  // v_participants, then the delete and the re-insert. A username v_prior does
  // not know is new: it did not join through the share link, it joins now, and
  // it has not tapped Done — so claim_done_at is null rather than savedAt.
  return {
    ...db,
    participants: payload.participants.map((p, i) => {
      const was = prior.get(key(p.venmo_username));
      return {
        id: `p-new-${i}`,
        venmo_username: p.venmo_username,
        is_owner: p.is_owner ?? false,
        joined_via_share: was?.joined_via_share ?? false,
        joined_at: was?.joined_at ?? savedAt,
        created_at: savedAt,
        claim_done_at: was?.claim_done_at ?? null,
      };
    }),
  };
}

// ── the dinner ─────────────────────────────────────────────────────────────
// The owner shared the tab. Alice picked her items and tapped Done at 20:15.
// Bob is still choosing. The owner then fixes the toast's price and saves.

const DONE_AT = "2026-08-19T20:15:00.000Z";

const owner: ParticipantRow = {
  id: "p-owner",
  venmo_username: "neil",
  is_owner: true,
  joined_via_share: false,
  joined_at: "2026-08-19T18:00:00.000Z",
  created_at: "2026-08-19T18:00:00.000Z",
  claim_done_at: null,
};

const alice: ParticipantRow = {
  id: "p-alice",
  venmo_username: "Alice",
  is_owner: false,
  joined_via_share: true,
  joined_at: "2026-08-19T19:30:00.000Z",
  created_at: "2026-08-19T19:30:00.000Z",
  claim_done_at: null,
};

const bob: ParticipantRow = {
  id: "p-bob",
  venmo_username: "bob",
  is_owner: false,
  joined_via_share: true,
  joined_at: "2026-08-19T19:40:00.000Z",
  created_at: "2026-08-19T19:40:00.000Z",
  claim_done_at: null,
};

function dinner(over: Partial<Db> = {}): Db {
  return { status: "shared", participants: [owner, alice, bob], ...over };
}

// What the owner's browser holds: everyone, and nothing about who is finished.
function ownerPayload(over: Partial<Payload> = {}): Payload {
  return {
    participants: [
      { client_id: "p-p-owner", venmo_username: "neil", is_owner: true },
      { client_id: "p-p-alice", venmo_username: "alice" },
      { client_id: "p-p-bob", venmo_username: "bob" },
    ],
    ...over,
  };
}

// setClaimDone: the claimer's own toggle, the only writer of this column.
function tapDone(db: Db, username: string, at: string | null): Db {
  return {
    ...db,
    participants: db.participants.map((p) =>
      key(p.venmo_username) === key(username) ? { ...p, claim_done_at: at } : p
    ),
  };
}

const find = (db: Db, username: string) =>
  db.participants.find((p) => key(p.venmo_username) === key(username));

describe("a save that lands after someone tapped done", () => {
  // The whole task. The owner's page loaded while alice was still choosing, so
  // nothing in what it sends knows she has finished; up to 0023 the save put
  // her back in the still-claiming list.
  it("leaves a finished claimer reading as done", () => {
    const loaded = dinner();
    const payload = ownerPayload();
    const claimed = tapDone(loaded, "alice", DONE_AT);

    const after = applySave(claimed, payload);

    expect(find(after, "alice")?.claim_done_at).toBe(DONE_AT);
  });

  it("still reads as done after the owner saves twice", () => {
    const claimed = tapDone(dinner(), "alice", DONE_AT);

    const after = applySave(applySave(claimed, ownerPayload()), ownerPayload());

    expect(find(after, "alice")?.claim_done_at).toBe(DONE_AT);
  });

  it("does not invent a done stamp for someone still claiming", () => {
    const after = applySave(tapDone(dinner(), "alice", DONE_AT), ownerPayload());

    expect(find(after, "bob")?.claim_done_at).toBeNull();
    expect(find(after, "neil")?.claim_done_at).toBeNull();
  });

  it("does not invent one for a participant the payload introduces", () => {
    const payload = ownerPayload({
      participants: [
        ...ownerPayload().participants,
        { client_id: "new-1", venmo_username: "dave" },
      ],
    });

    const after = applySave(dinner(), payload);

    expect(find(after, "dave")?.claim_done_at).toBeNull();
  });

  it("lets the claimer un-done herself afterwards", () => {
    const saved = applySave(tapDone(dinner(), "alice", DONE_AT), ownerPayload());

    const after = applySave(tapDone(saved, "alice", null), ownerPayload());

    expect(find(after, "alice")?.claim_done_at).toBeNull();
  });

  it("carries it for a username the owner typed in a different case", () => {
    // The stored row is "Alice" and this payload says "ALICE". 0016's unique
    // index is on lower(venmo_username) and the carry is keyed the same way,
    // so both sides have to be lowered or a finished claimer reads as new.
    const payload = ownerPayload({
      participants: [
        { client_id: "p-p-owner", venmo_username: "neil", is_owner: true },
        { client_id: "p-p-alice", venmo_username: "ALICE" },
        { client_id: "p-p-bob", venmo_username: "bob" },
      ],
    });

    const after = applySave(tapDone(dinner(), "alice", DONE_AT), payload);

    expect(find(after, "alice")?.claim_done_at).toBe(DONE_AT);
  });

  it("carries it while the receipt is open as well", () => {
    // The carry is not gated on status: the payload states nothing about this
    // column in any status, so there is never anything to diff against.
    const reopened = tapDone(dinner({ status: "open" }), "alice", DONE_AT);

    const after = applySave(reopened, ownerPayload());

    expect(find(after, "alice")?.claim_done_at).toBe(DONE_AT);
  });

  it("still removes a participant the owner removed", () => {
    const payload = ownerPayload({
      participants: [{ client_id: "p-p-owner", venmo_username: "neil", is_owner: true }],
    });

    const after = applySave(tapDone(dinner(), "alice", DONE_AT), payload);

    expect(after.participants.map((p) => p.venmo_username)).toEqual(["neil"]);
  });

  it("keeps 0021's provenance alongside it", () => {
    const after = applySave(tapDone(dinner(), "alice", DONE_AT), ownerPayload());

    expect(find(after, "alice")?.joined_via_share).toBe(true);
    expect(find(after, "alice")?.joined_at).toBe(alice.joined_at);
  });
});

// ===========================================================================
// The model is only worth anything if it matches the migration it stands in
// for, so the SQL is read here. Same approach as the other tests in this
// directory.
// ===========================================================================

const migrations = path.join(process.cwd(), "supabase", "migrations");

// `--` line comments only; nothing in these files puts one inside a literal.
function flatten(file: string): string {
  const sql = readFileSync(path.join(migrations, file), "utf8")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return sql;
}

const FILE = "0024_save_receipt_state_keep_claim_done.sql";
const raw = readFileSync(path.join(migrations, FILE), "utf8");
const sql = flatten(FILE);
const body = (s: string) => s.slice(s.indexOf("create or replace function"));

describe("migration 0024", () => {
  it("reads claim_done_at before the delete and writes it back on the insert", () => {
    expect(sql).toContain("'claim_done_at', rp.claim_done_at");
    expect(sql).toContain(
      "insert into receipt_participants (id, receipt_id, user_id, venmo_username, display_name, is_owner, joined_via_share, joined_at, claim_done_at) select r.id, p_receipt_id, r.user_id, r.venmo_username, r.display_name, r.is_owner, r.joined_via_share, r.joined_at, r.claim_done_at"
    );
    expect(sql).toContain(
      "is_owner boolean, joined_via_share boolean, joined_at timestamptz, claim_done_at timestamptz)"
    );
    expect(sql.indexOf("into v_prior")).toBeLessThan(
      sql.indexOf("delete from receipt_participants rp")
    );
    expect(sql.indexOf("delete from receipt_participants rp")).toBeLessThan(
      sql.indexOf("insert into receipt_participants")
    );
  });

  // The trap OT-124 found on joined_at, in its more dangerous direction: a
  // now() anywhere near this column marks people as finished who are not.
  it("never defaults the column to now(), in DDL or in the carry", () => {
    expect(sql).toContain(
      "'claim_done_at', (v_prior -> lower(p.venmo_username) ->> 'claim_done_at')::timestamptz"
    );
    // Catches the coalesce form — `coalesce(…'claim_done_at'…, now())` — and
    // the DDL form. The reverse direction is not asserted: joined_at's own
    // coalesce to now() legitimately sits a few characters above this key.
    expect(sql).not.toMatch(/claim_done_at[^;]{0,80}now\(\)/);
    expect(sql).not.toContain("default now()");
  });

  it("writes no existing row: no ddl, no update, no backfill", () => {
    expect(body(sql)).toBe(sql);
    expect(sql).not.toContain("alter table");
    expect(sql).not.toContain("add column");
    expect(sql).not.toContain("set default");
    expect(sql).not.toContain("drop column");
    expect(sql).not.toContain("truncate");
  });

  it("leaves the delete-and-re-insert atomicity alone", () => {
    expect(sql).toContain("delete from receipt_items where receipt_id = p_receipt_id");
    // Transaction control inside the function would end the one guarantee the
    // RPC exists to give: the refusal has to roll the call back by raising.
    expect(sql).not.toContain("commit");
    expect(sql).not.toContain("rollback");
    expect(sql).not.toContain("begin transaction");
    expect(sql).toContain("language plpgsql security definer set search_path = public");
    expect(sql).toContain("if v_owner is null or v_owner <> auth.uid() then");
  });

  // The strongest thing this file can assert without a database: 0024 is 0023
  // plus exactly five claim_done_at additions and nothing else. That is what
  // keeps 0022's PT409 refusal and 0023's item id re-use, claim restore and
  // carried charges intact — they are the same text, character for character.
  it("changes nothing in 0023 except the five claim_done_at additions", () => {
    const additions: [string, string][] = [
      [", 'claim_done_at', rp.claim_done_at", ""],
      [
        ", 'claim_done_at', (v_prior -> lower(p.venmo_username) ->> 'claim_done_at')::timestamptz",
        "",
      ],
      ["joined_via_share, joined_at, claim_done_at)", "joined_via_share, joined_at)"],
      [
        "r.joined_via_share, r.joined_at, r.claim_done_at",
        "r.joined_via_share, r.joined_at",
      ],
      ["joined_at timestamptz, claim_done_at timestamptz)", "joined_at timestamptz)"],
    ];

    let stripped = body(sql);
    for (const [added, was] of additions) {
      expect(stripped.split(added)).toHaveLength(2);
      stripped = stripped.replace(added, was);
    }

    expect(stripped).toBe(body(flatten("0023_save_receipt_state_keep_late_claims.sql")));
  });

  it("keeps 0022's refusal code readable as an http 409", () => {
    expect(raw).toContain("errcode = 'PT409'");
  });
});
