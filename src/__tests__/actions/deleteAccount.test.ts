import { describe, it, expect, vi, beforeEach } from "vitest";

// Every service-client call the action makes, in the order it made them. The
// ordering is the thing under test: anonymising participants and clearing
// charges has to happen before the profile delete (both foreign keys have no
// `on delete` action), and the auth user has to go last.
type Call = { op: string; args?: unknown };
let calls: Call[] = [];

type StorageEntry = { id: string | null; name: string };
let storageObjects: StorageEntry[] = [];

// `charges` is modelled as a real table rather than a call log: the fix for
// charges sitting on someone else's receipt is a read, then an update, then a
// scoped delete, and only the rows left standing at the end prove it worked.
// `owner` stands in for the joined `receipts.created_by`.
type ChargeRecord = {
  id: string;
  receipt_id: string;
  from_user_id: string;
  owner: string;
};
let chargesTable: ChargeRecord[] = [];

let sessionUser: { id: string; is_anonymous?: boolean } | null = null;
let storageListError: unknown = null;
let storageRemoveError: unknown = null;
// Keyed by table, or by `table.verb` when one table needs two outcomes.
let tableErrors: Record<string, unknown> = {};
let authDeleteError: unknown = null;

function storageChain() {
  return {
    list: async (prefix: string, opts: { limit: number; offset: number }) => {
      calls.push({ op: "storage.list", args: { prefix, ...opts } });
      if (storageListError) return { data: null, error: storageListError };
      return {
        data: storageObjects.slice(opts.offset, opts.offset + opts.limit),
        error: null,
      };
    },
    remove: async (paths: string[]) => {
      calls.push({ op: "storage.remove", args: paths });
      return { error: storageRemoveError };
    },
  };
}

// PostgREST builders are awaited directly (no terminal .single()), so the chain
// resolves itself once `then` is invoked. The first `.eq()` is where the call
// gets logged; a second one appends the full filter list to the same entry.
function tableChain(table: string) {
  const chain: Record<string, unknown> = {};
  let verb = "";
  let payload: unknown;
  let entry: Call | undefined;
  const filters: { column: string; value: unknown }[] = [];
  let range: { from: number; to: number } | null = null;

  chain.select = () => {
    verb = "select";
    return chain;
  };
  chain.update = (p: unknown) => {
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
    if (entry) {
      (entry.args as Record<string, unknown>).filters = [...filters];
    } else {
      entry = { op: `${table}.${verb}`, args: { column, value, payload } };
      calls.push(entry);
    }
    return chain;
  };
  chain.then = (resolve: (v: { data?: unknown; error: unknown }) => void) => {
    const error = tableErrors[`${table}.${verb}`] ?? tableErrors[table] ?? null;
    if (table !== "charges") return resolve({ error });

    const matches = (row: ChargeRecord) =>
      filters.every(
        (f) => (row as unknown as Record<string, unknown>)[f.column] === f.value
      );

    if (verb === "select") {
      if (error) return resolve({ data: null, error });
      const rows = chargesTable
        .filter(matches)
        .sort((a, b) => a.id.localeCompare(b.id));
      const page = range ? rows.slice(range.from, range.to + 1) : rows;
      // Shaped like `select("receipt_id, receipts!inner(created_by)")`.
      return resolve({
        data: page.map((r) => ({
          receipt_id: r.receipt_id,
          receipts: { created_by: r.owner },
        })),
        error: null,
      });
    }
    if (!error && verb === "update") {
      for (const row of chargesTable.filter(matches)) Object.assign(row, payload);
    }
    if (!error && verb === "delete") {
      chargesTable = chargesTable.filter((row) => !matches(row));
    }
    return resolve({ error });
  };
  return chain;
}

const service = {
  storage: { from: () => storageChain() },
  from: (table: string) => tableChain(table),
  auth: {
    admin: {
      deleteUser: async (id: string) => {
        calls.push({ op: "auth.admin.deleteUser", args: id });
        return { error: authDeleteError };
      },
    },
  },
};

const serverClient = {
  auth: {
    getUser: async () => ({ data: { user: sessionUser } }),
    signOut: async () => {
      calls.push({ op: "signOut" });
      return { error: null };
    },
  },
};

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => serverClient,
  getSupabaseServiceClient: async () => service,
}));

const ops = () => calls.map((c) => c.op);
const find = (op: string) => calls.find((c) => c.op === op);
const indexOf = (op: string) => ops().indexOf(op);

async function run() {
  const { deleteAccount } = await import("@/app/actions/deleteAccount");
  return deleteAccount();
}

beforeEach(() => {
  calls = [];
  storageObjects = [
    { id: "o1", name: "r1.jpg" },
    { id: "o2", name: "r2.jpg" },
  ];
  chargesTable = [
    { id: "c1", receipt_id: "r-mine", from_user_id: "me", owner: "me" },
  ];
  sessionUser = { id: "me" };
  storageListError = null;
  storageRemoveError = null;
  tableErrors = {};
  authDeleteError = null;
});

describe("deleteAccount — session boundary", () => {
  // The one parameter this action must never have is a target user id: a
  // `"use server"` export is reachable by direct POST, so an id argument is an
  // "delete anyone's account" endpoint.
  it("takes no arguments", async () => {
    const { deleteAccount } = await import("@/app/actions/deleteAccount");
    expect(deleteAccount.length).toBe(0);
  });

  // Arity alone is not the guard it looks like: `(userId = "x")` and
  // `(...args)` both report length 0 while still accepting a target. A server
  // action is reachable by direct POST, so the caller can send arguments the
  // signature never declared. Assert the effect instead of the shape.
  it("ignores an argument forced past the signature", async () => {
    sessionUser = { id: "me" };
    const { deleteAccount } = await import("@/app/actions/deleteAccount");
    const forced = deleteAccount as unknown as (
      target: string
    ) => Promise<unknown>;

    const result = await forced("victim");

    expect(result).toEqual({ redirectTo: "/" });
    expect(find("profiles.delete")).toMatchObject({
      args: { column: "id", value: "me" },
    });
    expect(find("auth.admin.deleteUser")).toMatchObject({ args: "me" });
    // Nothing the caller sent reached any query, under any name.
    expect(JSON.stringify(calls)).not.toContain("victim");
  });

  it("refuses without a session and touches nothing", async () => {
    sessionUser = null;

    const result = await run();

    expect(result).toEqual({ error: "Not signed in." });
    expect(calls).toEqual([]);
  });

  it("deletes the session user, never an id from the caller", async () => {
    sessionUser = { id: "me" };

    await run();

    expect(find("profiles.delete")).toMatchObject({
      args: { column: "id", value: "me" },
    });
    expect(find("auth.admin.deleteUser")).toMatchObject({ args: "me" });
  });

  it("works the same for an anonymous guest", async () => {
    sessionUser = { id: "guest-1", is_anonymous: true };

    const result = await run();

    expect(result).toEqual({ redirectTo: "/" });
    expect(find("auth.admin.deleteUser")).toMatchObject({ args: "guest-1" });
  });
});

describe("deleteAccount — ordering", () => {
  it("runs photos, anonymise, charges, profile, auth user, sign out — in that order", async () => {
    const result = await run();

    expect(ops()).toEqual([
      "storage.list",
      "storage.remove",
      "receipt_participants.update",
      "charges.select",
      "charges.delete",
      "profiles.delete",
      "auth.admin.deleteUser",
      "signOut",
    ]);
    expect(result).toEqual({ redirectTo: "/" });
  });

  // If the profile went first, the cascade would take the participant rows on
  // other people's receipts with it — the rows this action exists to preserve.
  it("anonymises participants before the profile delete", async () => {
    await run();

    expect(indexOf("receipt_participants.update")).toBeLessThan(
      indexOf("profiles.delete")
    );
  });

  it("clears the user's charges before the profile delete", async () => {
    await run();

    expect(indexOf("charges.delete")).toBeLessThan(indexOf("profiles.delete"));
  });

  it("deletes the auth user only after the profile row is gone", async () => {
    await run();

    expect(indexOf("profiles.delete")).toBeLessThan(
      indexOf("auth.admin.deleteUser")
    );
  });
});

describe("deleteAccount — anonymisation", () => {
  it("nulls user_id on the user's participant rows instead of deleting them", async () => {
    await run();

    expect(find("receipt_participants.update")).toEqual({
      op: "receipt_participants.update",
      args: { column: "user_id", value: "me", payload: { user_id: null } },
    });
  });

  it("never deletes a receipt_participants row", async () => {
    await run();

    expect(ops()).not.toContain("receipt_participants.delete");
  });

  // display_name and venmo_username are what makes someone else's settled tab
  // still add up. Writing anything but user_id would rewrite their history.
  it("leaves display_name and venmo_username untouched", async () => {
    await run();

    const payload = (find("receipt_participants.update")?.args as {
      payload: Record<string, unknown>;
    }).payload;
    expect(Object.keys(payload)).toEqual(["user_id"]);
  });

  // Scoped to this user's id and nothing wider. What that scope is safe to
  // delete depends on the re-point that runs first — see below.
  it("scopes the charge delete to charges the user issued", async () => {
    await run();

    expect(find("charges.delete")).toMatchObject({
      args: { column: "from_user_id", value: "me" },
    });
  });
});

// Regression. A charge row is meant to carry the receipt owner's id, but an
// older client-side save path stamped the session user, and a non-owner
// participant could reach it. So rows carrying this user's id can be sitting
// on a tab somebody else created, and deleting by `from_user_id` alone would
// take them off that person's tab.
describe("deleteAccount — charges on someone else's tab", () => {
  beforeEach(() => {
    chargesTable = [
      { id: "c1", receipt_id: "r-mine", from_user_id: "me", owner: "me" },
      { id: "c2", receipt_id: "r-alice", from_user_id: "me", owner: "alice" },
      { id: "c3", receipt_id: "r-alice", from_user_id: "me", owner: "alice" },
      { id: "c4", receipt_id: "r-alice", from_user_id: "alice", owner: "alice" },
    ];
  });

  it("leaves every charge row on alice's receipt standing", async () => {
    await run();

    expect(
      chargesTable.filter((r) => r.receipt_id === "r-alice").map((r) => r.id)
    ).toEqual(["c2", "c3", "c4"]);
  });

  it("hands the misfiled rows to the receipt's owner", async () => {
    await run();

    expect(chargesTable).toEqual([
      { id: "c2", receipt_id: "r-alice", from_user_id: "alice", owner: "alice" },
      { id: "c3", receipt_id: "r-alice", from_user_id: "alice", owner: "alice" },
      { id: "c4", receipt_id: "r-alice", from_user_id: "alice", owner: "alice" },
    ]);
  });

  it("re-points before deleting, once per affected receipt", async () => {
    await run();

    expect(ops().filter((o) => o === "charges.update")).toHaveLength(1);
    expect(indexOf("charges.update")).toBeLessThan(indexOf("charges.delete"));
    expect(find("charges.update")).toMatchObject({
      args: {
        payload: { from_user_id: "alice" },
        filters: [
          { column: "from_user_id", value: "me" },
          { column: "receipt_id", value: "r-alice" },
        ],
      },
    });
  });

  it("scans only the charges carrying this user's id", async () => {
    await run();

    expect(find("charges.select")).toMatchObject({
      args: { column: "from_user_id", value: "me" },
    });
  });

  it("stops before deleting anything when the re-point fails", async () => {
    tableErrors = { "charges.update": { message: "boom" } };

    const result = await run();

    expect(result).toEqual({ error: "Couldn't delete your account. Try again." });
    expect(ops()).not.toContain("charges.delete");
    expect(ops()).not.toContain("profiles.delete");
    expect(chargesTable.map((r) => r.id)).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("stops before deleting anything when the scan fails", async () => {
    tableErrors = { "charges.select": { message: "boom" } };

    const result = await run();

    expect(result).toEqual({ error: "Couldn't delete your account. Try again." });
    expect(ops()).not.toContain("charges.delete");
    expect(chargesTable).toHaveLength(4);
  });

  // A truncated scan is the same defect wearing a different hat: a misfiled
  // row nobody read falls through to the delete.
  it("finds a misfiled row past the first page of the scan", async () => {
    chargesTable = [
      ...Array.from({ length: 500 }, (_, i) => ({
        id: `c${String(i).padStart(4, "0")}`,
        receipt_id: "r-mine",
        from_user_id: "me",
        owner: "me",
      })),
      { id: "c9999", receipt_id: "r-alice", from_user_id: "me", owner: "alice" },
    ];

    await run();

    expect(ops().filter((o) => o === "charges.select")).toHaveLength(2);
    expect(chargesTable).toEqual([
      {
        id: "c9999",
        receipt_id: "r-alice",
        from_user_id: "alice",
        owner: "alice",
      },
    ]);
  });
});

describe("deleteAccount — receipt photos", () => {
  it("removes every object under the user's own prefix", async () => {
    await run();

    expect(find("storage.list")).toMatchObject({ args: { prefix: "me" } });
    expect(find("storage.remove")).toMatchObject({
      args: ["me/r1.jpg", "me/r2.jpg"],
    });
  });

  it("pages through a bucket with more objects than one list call returns", async () => {
    storageObjects = Array.from({ length: 103 }, (_, i) => ({
      id: `o${i}`,
      name: `r${i}.jpg`,
    }));

    await run();

    expect(ops().filter((o) => o === "storage.list")).toHaveLength(2);
    expect(find("storage.remove")?.args).toHaveLength(103);
  });

  it("skips the empty-folder placeholder, which has no id", async () => {
    storageObjects = [{ id: null, name: ".emptyFolderPlaceholder" }];

    await run();

    expect(ops()).not.toContain("storage.remove");
    expect(ops()).toContain("profiles.delete");
  });
});

describe("deleteAccount — failure stops the sequence", () => {
  // The only handle on these objects is the `<user id>/` prefix. Delete the
  // rows first and a storage failure orphans photos nobody can find.
  it("touches no rows when the photos cannot be listed", async () => {
    storageListError = { message: "boom" };

    const result = await run();

    expect(result).toEqual({ error: "Couldn't delete your account. Try again." });
    expect(ops()).toEqual(["storage.list"]);
  });

  it("touches no rows when the photos cannot be removed", async () => {
    storageRemoveError = { message: "boom" };

    const result = await run();

    expect(result).toEqual({ error: "Couldn't delete your account. Try again." });
    expect(ops()).toEqual(["storage.list", "storage.remove"]);
  });

  it("does not delete the profile when anonymising fails", async () => {
    tableErrors = { receipt_participants: { message: "boom" } };

    const result = await run();

    expect(result).toEqual({ error: "Couldn't delete your account. Try again." });
    expect(ops()).not.toContain("profiles.delete");
    expect(ops()).not.toContain("auth.admin.deleteUser");
  });

  it("keeps the session when the auth user delete fails, so a retry can finish", async () => {
    authDeleteError = { message: "boom" };

    const result = await run();

    expect(result).toEqual({ error: "Couldn't delete your account. Try again." });
    expect(ops()).not.toContain("signOut");
  });
});
