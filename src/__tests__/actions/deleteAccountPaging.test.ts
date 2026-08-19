import { describe, it, expect, vi, beforeEach } from "vitest";

// The charge scan in deleteAccount pages. A page shorter than the one it asked
// for is not proof that it reached the end: PostgREST can be configured with a
// `db-max-rows` below the page size, and then *every* page comes back short.
// The old loop treated the first short page as the last one, so with a cap in
// place it would read one page, miss every misfiled row behind it, and then
// delete them — rows that live on somebody else's tab.
//
// This file models that server: pages are capped well below what the action
// asks for, and the row that must be found sits past the cap.

type ChargeRecord = {
  id: string;
  receipt_id: string;
  from_user_id: string;
  owner: string;
};

let chargesTable: ChargeRecord[] = [];
// Rows the server will return per request, whatever range was asked for.
let dbMaxRows = 3;
// Whether the server reports a total alongside the page.
let sendsCount = true;
let selectCalls = 0;

function storageChain() {
  return {
    list: async () => ({ data: [], error: null }),
    remove: async () => ({ error: null }),
  };
}

function tableChain(table: string) {
  const chain: Record<string, unknown> = {};
  let verb = "";
  let payload: Record<string, unknown> | undefined;
  const filters: { column: string; value: unknown }[] = [];
  let range: { from: number; to: number } | null = null;

  chain.select = () => {
    verb = "select";
    return chain;
  };
  chain.update = (p: Record<string, unknown>) => {
    verb = "update";
    payload = p;
    return chain;
  };
  chain.delete = () => {
    verb = "delete";
    return chain;
  };
  chain.order = () => chain;
  chain.range = (from: number, to: number) => {
    range = { from, to };
    return chain;
  };
  chain.eq = (column: string, value: unknown) => {
    filters.push({ column, value });
    return chain;
  };
  chain.then = (
    resolve: (v: { data?: unknown; count?: number; error: unknown }) => void
  ) => {
    if (table !== "charges") return resolve({ error: null });

    const matches = (row: ChargeRecord) =>
      filters.every(
        (f) => (row as unknown as Record<string, unknown>)[f.column] === f.value
      );
    const rows = chargesTable.filter(matches).sort((a, b) => a.id.localeCompare(b.id));

    if (verb === "select") {
      selectCalls += 1;
      const asked = range ? rows.slice(range.from, range.to + 1) : rows;
      // The cap the loop must not mistake for the end of the table.
      const page = asked.slice(0, dbMaxRows);
      return resolve({
        data: page.map((r) => ({
          receipt_id: r.receipt_id,
          receipts: { created_by: r.owner },
        })),
        // `count: "exact"` counts every matching row, not just the page.
        count: sendsCount ? rows.length : undefined,
        error: null,
      });
    }
    if (verb === "update" && payload) {
      for (const row of rows) Object.assign(row, payload);
    }
    if (verb === "delete") {
      chargesTable = chargesTable.filter((row) => !matches(row));
    }
    return resolve({ error: null });
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "me" } } }),
      signOut: async () => ({ error: null }),
    },
  }),
  getSupabaseServiceClient: async () => ({
    storage: { from: () => storageChain() },
    from: (table: string) => tableChain(table),
    auth: { admin: { deleteUser: async () => ({ error: null }) } },
  }),
}));

async function run() {
  const { deleteAccount } = await import("@/app/actions/deleteAccount");
  return deleteAccount();
}

beforeEach(() => {
  dbMaxRows = 3;
  sendsCount = true;
  selectCalls = 0;
  chargesTable = [
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      receipt_id: "r-mine",
      from_user_id: "me",
      owner: "me",
    })),
    { id: "c9", receipt_id: "r-alice", from_user_id: "me", owner: "alice" },
  ];
});

describe("deleteAccount — a server that caps every page", () => {
  it("keeps reading past a capped page instead of calling it the last one", async () => {
    expect(await run()).toEqual({ redirectTo: "/" });

    // 7 matching rows, 3 per page: three reads, not one.
    expect(selectCalls).toBe(3);
  });

  it("re-points the misfiled row that sits behind the cap", async () => {
    await run();

    expect(chargesTable).toEqual([
      { id: "c9", receipt_id: "r-alice", from_user_id: "alice", owner: "alice" },
    ]);
  });

  it("still terminates when the server sends no count at all", async () => {
    sendsCount = false;
    dbMaxRows = 500;

    expect(await run()).toEqual({ redirectTo: "/" });
    expect(selectCalls).toBe(1);
    expect(chargesTable).toEqual([
      { id: "c9", receipt_id: "r-alice", from_user_id: "alice", owner: "alice" },
    ]);
  });
});
