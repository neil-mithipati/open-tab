import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
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
    expect(calls.gte).toHaveBeenCalledWith("joined_at", HOUR_AGO);
  });

  // The cap governs share-link traffic; people the owner types in himself are
  // not the flood it guards against. This says nothing about owner saves any
  // more — 0021 preserves the flag through one, and the owner-save behaviour
  // is covered below, on outcomes rather than on which filters were called.
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

// ===========================================================================
// An owner save must not lock out new joiners.
//
// This is the case the suite used to miss. The old test asserted that the
// limiter called .eq("joined_via_share", true), and that assertion would have
// stayed green while the behaviour it stood for was undone. The limiter only
// worked because 0016's save_receipt_state erased that flag on every save.
// That erasure had to end — it was also hiding real claimers from the owner's
// own view of the tab — and ending it hands the lockout straight back to any
// limiter still counting a timestamp the save rewrites. Query shape cannot see
// that. Outcomes can.
//
// There is no database in this suite, so the owner save is modelled here and
// the model is checked against the SQL it stands in for at the bottom of this
// file. That is weaker than running the RPC — it cannot catch a Postgres-level
// surprise — but it does catch the regression this task exists to prevent.
// ===========================================================================

const RECEIPT = "r-dinner";

interface ParticipantRow {
  id: string;
  receipt_id: string;
  venmo_username: string;
  display_name: string;
  is_owner: boolean;
  joined_via_share: boolean;
  created_at: string;
  joined_at: string | null;
}

function minutesBefore(base: Date, minutes: number): string {
  return new Date(base.getTime() - minutes * 60 * 1000).toISOString();
}

// Someone who came in through the share link, `minutes` ago.
function joiner(username: string, minutes: number): ParticipantRow {
  const at = minutesBefore(NOW, minutes);
  return {
    id: `p-${username}`,
    receipt_id: RECEIPT,
    venmo_username: username,
    display_name: username,
    is_owner: false,
    joined_via_share: true,
    created_at: at,
    joined_at: at,
  };
}

// A client that answers the count from rows rather than from a number the test
// picked, applying the limiter's own filters to them — including the fact that
// null is not >= anything, which is how Postgres drops a row whose joined_at
// predates 0021.
function countingClient(rows: ParticipantRow[]) {
  const filters: Array<(row: ParticipantRow) => boolean> = [];
  const cell = (row: ParticipantRow, column: string) =>
    (row as unknown as Record<string, unknown>)[column];

  type Builder = {
    select: (...args: unknown[]) => Builder;
    eq: (column: string, value: unknown) => Builder;
    gte: (column: string, value: string) => Builder;
    then: (resolve: (value: { count: number; error: null }) => void) => void;
  };

  const builder = {} as Builder;
  builder.select = () => builder;
  builder.eq = (column, value) => {
    filters.push((row) => cell(row, column) === value);
    return builder;
  };
  builder.gte = (column, value) => {
    filters.push((row) => {
      const at = cell(row, column);
      if (at === null || at === undefined) return false;
      return new Date(String(at)).getTime() >= new Date(value).getTime();
    });
    return builder;
  };
  builder.then = (resolve) =>
    resolve({
      count: rows.filter((row) => filters.every((match) => match(row))).length,
      error: null,
    });

  return {
    from: () => builder,
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

// What 0021's save_receipt_state does to receipt_participants: every row for
// the receipt is deleted and re-inserted with a freshly minted id and a fresh
// created_at, while joined_via_share and joined_at are carried across, matched
// on lower(venmo_username) — the key 0016's unique index uses. A username the
// payload introduces is new: it did not join via the link, and it joins now.
function ownerSave(
  existing: ParticipantRow[],
  payload: { venmo_username: string; is_owner?: boolean }[],
  savedAt: Date
): ParticipantRow[] {
  const prior = new Map(
    existing.map((row) => [row.venmo_username.toLowerCase(), row])
  );
  const saved = savedAt.toISOString();

  return payload.map((entry, i) => {
    const was = prior.get(entry.venmo_username.toLowerCase());
    return {
      id: `p-resaved-${i}`,
      receipt_id: RECEIPT,
      venmo_username: entry.venmo_username,
      display_name: was?.display_name ?? entry.venmo_username,
      is_owner: entry.is_owner ?? false,
      joined_via_share: was?.joined_via_share ?? false,
      joined_at: was ? (was.joined_at ?? was.created_at) : saved,
      created_at: saved,
    };
  });
}

describe("an owner save and the claim-join limiter", () => {
  // Twenty people joined over the afternoon, all more than an hour ago.
  const twenty = Array.from({ length: CLAIM_JOIN_LIMIT_PER_HOUR }, (_, i) =>
    joiner(`friend${i}`, 90 + i * 5)
  );
  const resave = twenty.map((row) => ({ venmo_username: row.venmo_username }));

  it("does not count joins that happened before the hour", async () => {
    expect(
      await isClaimJoinRateLimited(countingClient(twenty), RECEIPT, NOW)
    ).toBe(false);
  });

  // The one that matters. Owner edits a line item on a 20-person dinner; the
  // 21st friend must still be able to join. Fails if the limiter counts a
  // timestamp the save rewrites.
  it("does not lock out the next joiner after the owner saves an edit", async () => {
    const afterSave = ownerSave(twenty, resave, NOW);

    expect(afterSave).toHaveLength(CLAIM_JOIN_LIMIT_PER_HOUR);
    expect(
      await isClaimJoinRateLimited(countingClient(afterSave), RECEIPT, NOW)
    ).toBe(false);
  });

  // ...and the cap is still a cap. Without this, a limiter that had simply
  // gone inert would pass the test above.
  it("still trips on twenty real joins inside the hour, save or no save", async () => {
    const flood = Array.from({ length: CLAIM_JOIN_LIMIT_PER_HOUR }, (_, i) =>
      joiner(`spam${i}`, 10)
    );

    expect(
      await isClaimJoinRateLimited(countingClient(flood), RECEIPT, NOW)
    ).toBe(true);

    const afterSave = ownerSave(
      flood,
      flood.map((row) => ({ venmo_username: row.venmo_username })),
      NOW
    );
    expect(
      await isClaimJoinRateLimited(countingClient(afterSave), RECEIPT, NOW)
    ).toBe(true);
  });

  it("treats a participant the save introduces as joining now, not as a share join", async () => {
    const nineteen = twenty.slice(0, CLAIM_JOIN_LIMIT_PER_HOUR - 1);
    const afterSave = ownerSave(
      nineteen,
      [
        ...nineteen.map((row) => ({ venmo_username: row.venmo_username })),
        { venmo_username: "typed-in-by-owner" },
      ],
      NOW
    );

    const added = afterSave.at(-1) as ParticipantRow;
    expect(added.joined_at).toBe(NOW.toISOString());
    // Typed in by the owner, not joined through the link, so it is outside
    // what this cap governs either way.
    expect(added.joined_via_share).toBe(false);
  });

  // A participant who joined before 0021 shipped has a null joined_at. Null
  // matches no >= comparison, so the limiter under-counts them rather than
  // locking the link — and the save fills the value in from created_at.
  it("under-counts rows that predate the migration instead of locking the link", async () => {
    const legacy = twenty.map((row) => ({ ...row, joined_at: null }));

    expect(
      await isClaimJoinRateLimited(countingClient(legacy), RECEIPT, NOW)
    ).toBe(false);

    const afterSave = ownerSave(legacy, resave, NOW);
    expect(afterSave[0].joined_at).toBe(legacy[0].created_at);
    expect(
      await isClaimJoinRateLimited(countingClient(afterSave), RECEIPT, NOW)
    ).toBe(false);
  });
});

describe("an owner save and the owner's own view of the tab", () => {
  it("keeps the share-join flag on people already on the receipt", () => {
    const before = [joiner("Alice", 30), joiner("bob", 20)];
    const afterSave = ownerSave(
      before,
      // The browser sends back what it holds, and case drifts between phones;
      // the RPC matches on lower(venmo_username), as its unique index does.
      [{ venmo_username: "alice" }, { venmo_username: "BOB" }],
      NOW
    );

    expect(afterSave.map((row) => row.joined_via_share)).toEqual([true, true]);
  });

  // ClaimOwnerView.tsx builds the owner's claimer list with exactly this
  // filter. Before 0021 it came back empty after any save, so the people who
  // had actually claimed items vanished from the owner's screen.
  it("still lists every claimer after the owner edits an item", () => {
    const before = [
      joiner("alice", 30),
      joiner("bob", 20),
      {
        ...joiner("owner", 60),
        is_owner: true,
        joined_via_share: false,
      },
    ];
    const afterSave = ownerSave(
      before,
      [
        { venmo_username: "alice" },
        { venmo_username: "bob" },
        { venmo_username: "owner", is_owner: true },
      ],
      NOW
    );

    const claimers = afterSave.filter((p) => p.joined_via_share);
    expect(claimers.map((p) => p.venmo_username)).toEqual(["alice", "bob"]);
  });
});

// ===========================================================================
// The model above is only worth anything if it matches the migration it
// stands in for, so the SQL is read here and checked for what the model
// assumes and what the task requires. Same approach as the RLS tests in
// src/__tests__/db: no database, so assert the shape of the statement.
// ===========================================================================

const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "0021_save_receipt_state_preserve_join_flag.sql"
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

const preamble = sql.slice(0, sql.indexOf("create or replace function"));

describe("migration 0021", () => {
  it("re-inserts participants with the flag and the join time listed", () => {
    expect(sql).toContain(
      "insert into receipt_participants (id, receipt_id, user_id, venmo_username, display_name, is_owner, joined_via_share, joined_at) select r.id, p_receipt_id, r.user_id, r.venmo_username, r.display_name, r.is_owner, r.joined_via_share, r.joined_at"
    );
  });

  it("reads the prior values before the delete that destroys them", () => {
    const capture = sql.indexOf("into v_prior");
    const del = sql.indexOf(
      "delete from receipt_participants where receipt_id = p_receipt_id"
    );

    expect(capture).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(capture);
  });

  it("matches prior rows on the key 0016's unique index uses", () => {
    expect(sql).toMatch(/jsonb_object_agg\( ?lower\(rp\.venmo_username\)/);
    expect(sql).toMatch(/v_prior -> lower\(p\.venmo_username\)/);
    // Rows from before this migration are filled in from created_at, not
    // now(), so a save cannot make an old participant look like a new joiner.
    expect(sql).toMatch(/coalesce\(rp\.joined_at, rp\.created_at\)/);
  });

  it("leaves the delete-and-re-insert atomicity alone", () => {
    expect(sql).toContain("delete from charges where receipt_id = p_receipt_id");
    expect(sql).toContain(
      "delete from receipt_participants where receipt_id = p_receipt_id"
    );
    expect(sql).toContain(
      "delete from receipt_items where receipt_id = p_receipt_id"
    );
    // Transaction control inside the function would end the one guarantee the
    // RPC exists to give.
    expect(sql).not.toContain("commit");
    expect(sql).not.toContain("rollback");
    expect(sql).not.toContain("begin transaction");
  });

  // 0021 replaces the whole function, so the gate 0016 put in front of it has
  // to survive the replacement. security definer means the body runs with the
  // function owner's rights, and this check is the only thing between a
  // signed-in caller and someone else's receipt.
  it("keeps the ownership gate on a security definer function", () => {
    expect(sql).toContain(
      "language plpgsql security definer set search_path = public"
    );
    expect(sql).toContain("if auth.uid() is null then");
    expect(sql).toContain(
      "select created_by into v_owner from receipts where id = p_receipt_id"
    );
    expect(sql).toContain("if v_owner is null or v_owner <> auth.uid() then");
    expect(sql).toContain(
      "revoke execute on function public.save_receipt_state(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public"
    );
  });

  it("is additive: adds a column without writing to any existing row", () => {
    expect(preamble).toContain(
      "alter table public.receipt_participants add column if not exists joined_at timestamptz;"
    );
    // A default in the add would backfill now() into every existing row, and
    // a 20-person receipt would then read as 20 joins this hour.
    expect(preamble).toContain("alter column joined_at set default now()");
    expect(preamble).not.toMatch(/(^|;\s*)(update|drop|truncate|delete)\b/);
  });
});
