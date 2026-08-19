import { describe, it, expect, vi, beforeEach } from "vitest";

// Every service-client call the action makes, in the order it made them. The
// ordering is the thing under test: anonymising participants and clearing
// charges has to happen before the profile delete (both foreign keys have no
// `on delete` action), and the auth user has to go last.
type Call = { op: string; args?: unknown };
let calls: Call[] = [];

type StorageEntry = { id: string | null; name: string };
let storageObjects: StorageEntry[] = [];

let sessionUser: { id: string; is_anonymous?: boolean } | null = null;
let storageListError: unknown = null;
let storageRemoveError: unknown = null;
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
// resolves itself once `then` is invoked. `.eq()` is where the filter is known,
// so that is where the call gets logged.
function tableChain(table: string) {
  const chain: Record<string, unknown> = {};
  let verb = "";
  let payload: unknown;
  chain.update = (p: unknown) => {
    verb = "update";
    payload = p;
    return chain;
  };
  chain.delete = () => {
    verb = "delete";
    return chain;
  };
  chain.eq = (column: string, value: unknown) => {
    calls.push({ op: `${table}.${verb}`, args: { column, value, payload } });
    return chain;
  };
  chain.then = (resolve: (v: { error: unknown }) => void) =>
    resolve({ error: tableErrors[table] ?? null });
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

  // Charges the user issued live on their own receipts, so scoping by
  // from_user_id never reaches a charge on someone else's tab.
  it("scopes the charge delete to charges the user issued", async () => {
    await run();

    expect(find("charges.delete")).toMatchObject({
      args: { column: "from_user_id", value: "me" },
    });
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
