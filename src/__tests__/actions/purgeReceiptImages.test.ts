import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Rows the RPC hands back, and the calls the route makes as a result. 0026
// returns created_by alongside the pointer so the job can bind one to the
// other before it deletes anything.
type DueRow = { id: string; created_by: string | null; image_url: string | null };

const db: {
  due: DueRow[];
  selectError: { message: string } | null;
  removeError: { message: string } | null;
} = { due: [], selectError: null, removeError: null };

const spies = {
  rpc: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  updatedIds: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => {
  // `.update({...}).in("id", [...]).select("id")` is the only table write the
  // route makes, so the builder only has to model that chain.
  function updateBuilder(patch: Record<string, unknown>) {
    let ids: string[] = [];
    const builder = {
      in(_col: string, values: string[]) {
        ids = values;
        return builder;
      },
      async select() {
        spies.update(patch);
        spies.updatedIds(ids);
        return { data: ids.map((id) => ({ id })), error: null };
      },
    };
    return builder;
  }

  return {
    getSupabaseServiceClient: async () => ({
      rpc: async (name: string, args: Record<string, unknown>) => {
        spies.rpc(name, args);
        if (db.selectError) return { data: null, error: db.selectError };
        return { data: db.due, error: null };
      },
      from: () => ({ update: updateBuilder }),
      storage: {
        from: (bucket: string) => ({
          remove: async (paths: string[]) => {
            spies.remove(bucket, paths);
            return { data: null, error: db.removeError };
          },
        }),
      },
    }),
  };
});

const { GET, POST } = await import("@/app/api/cron/purge-receipt-images/route");

const SECRET = "cron-secret-value";
const BUCKET_URL = "https://p.supabase.co/storage/v1/object/sign/receipt-images";

function url(receiptId: string, user = "u1"): string {
  return `${BUCKET_URL}/${user}/${receiptId}.jpg?token=abc`;
}

// A due row as the RPC returns it: owner u1, pointing at its own object.
function due(id: string, image_url: string | null = url(id), created_by: string | null = "u1"): DueRow {
  return { id, created_by, image_url };
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://open.tab/api/cron/purge-receipt-images", { headers });
}

const authed = () => request({ authorization: `Bearer ${SECRET}` });

beforeEach(() => {
  db.due = [];
  db.selectError = null;
  db.removeError = null;
  process.env.CRON_SECRET = SECRET;
  delete process.env.RECEIPT_IMAGE_RETENTION_DAYS;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CRON_SECRET;
  delete process.env.RECEIPT_IMAGE_RETENTION_DAYS;
});

describe("the endpoint is not open to the internet", () => {
  it("refuses a request with no authorization header", async () => {
    const res = await GET(request());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(spies.rpc).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret", async () => {
    const res = await GET(request({ authorization: `Bearer ${SECRET}x` }));

    expect(res.status).toBe(401);
    expect(spies.rpc).not.toHaveBeenCalled();
  });

  it("refuses a secret of the right length but the wrong value", async () => {
    const wrong = "x".repeat(SECRET.length);
    const res = await GET(request({ authorization: `Bearer ${wrong}` }));

    expect(res.status).toBe(401);
    expect(spies.rpc).not.toHaveBeenCalled();
  });

  it("refuses the raw secret without the Bearer scheme", async () => {
    const res = await GET(request({ authorization: SECRET }));

    expect(res.status).toBe(401);
    expect(spies.rpc).not.toHaveBeenCalled();
  });

  // Fails CLOSED. An unconfigured secret means this route is unprotected, and
  // an unprotected endpoint that deletes user data is worse than a retention
  // job that has not run yet.
  it("refuses to run at all when no secret is configured", async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(authed());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_configured" });
    expect(spies.rpc).not.toHaveBeenCalled();
  });

  it("accepts the right secret on both verbs", async () => {
    expect((await GET(authed())).status).toBe(200);
    expect((await POST(authed())).status).toBe(200);
  });
});

describe("N days after parse", () => {
  it("asks the database for rows older than fourteen days by default", async () => {
    const before = Date.now();
    await GET(authed());
    const after = Date.now();

    expect(spies.rpc).toHaveBeenCalledWith(
      "receipt_images_due_for_purge",
      expect.objectContaining({ p_before: expect.any(String) })
    );
    const cutoff = Date.parse(spies.rpc.mock.calls[0][1].p_before);
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;
    expect(cutoff).toBeGreaterThanOrEqual(before - fourteenDays - 5000);
    expect(cutoff).toBeLessThanOrEqual(after - fourteenDays);
  });

  it("honours RECEIPT_IMAGE_RETENTION_DAYS", async () => {
    process.env.RECEIPT_IMAGE_RETENTION_DAYS = "30";

    const res = await GET(authed());

    const cutoff = Date.parse(spies.rpc.mock.calls[0][1].p_before);
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(thirtyDays - 5000);
    expect((await res.json()).retentionDays).toBe(30);
  });

  it("falls back to fourteen on a nonsense override rather than skipping the purge", async () => {
    process.env.RECEIPT_IMAGE_RETENTION_DAYS = "not-a-number";

    const res = await GET(authed());

    expect((await res.json()).retentionDays).toBe(14);
    expect(spies.rpc).toHaveBeenCalled();
  });
});

describe("the deletion itself", () => {
  it("removes the object and then clears the pointer", async () => {
    db.due = [due("r1")];

    const res = await GET(authed());

    expect(spies.remove).toHaveBeenCalledWith("receipt-images", ["u1/r1.jpg"]);
    expect(spies.update).toHaveBeenCalledWith({ image_url: null });
    expect(spies.updatedIds).toHaveBeenCalledWith(["r1"]);
    expect(await res.json()).toMatchObject({ ok: true, removed: 1, cleared: 1, skipped: 0 });
  });

  it("removes every due object", async () => {
    db.due = ["r1", "r2", "r3"].map((id) => due(id));

    const res = await GET(authed());

    expect(spies.remove).toHaveBeenCalledWith("receipt-images", [
      "u1/r1.jpg",
      "u1/r2.jpg",
      "u1/r3.jpg",
    ]);
    expect((await res.json()).removed).toBe(3);
  });

  // Object first, row second. The other order leaves an image in the bucket
  // with nothing left pointing at it if the removal fails.
  it("leaves the pointer alone when the object could not be removed", async () => {
    db.due = [due("r1")];
    db.removeError = { message: "storage unavailable" };

    const res = await GET(authed());

    expect(spies.remove).toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ removed: 0, cleared: 0 });
  });

  it("skips a row whose image_url names no storage object, and says so", async () => {
    db.due = [due("r1", "not a url at all"), due("r2")];

    const res = await GET(authed());

    expect(spies.remove).toHaveBeenCalledWith("receipt-images", ["u1/r2.jpg"]);
    expect(await res.json()).toMatchObject({ due: 2, attempted: 1, removed: 1, skipped: 1 });
  });

  it("does nothing at all when nothing is due", async () => {
    const res = await GET(authed());

    expect(spies.remove).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ ok: true, due: 0, removed: 0 });
  });

  it("caps one run and reports the backlog rather than running to a timeout", async () => {
    db.due = Array.from({ length: 620 }, (_, i) => due(`r${i}`));

    const res = await GET(authed());

    const body = await res.json();
    expect(body.due).toBe(620);
    expect(body.attempted).toBe(500);
    expect(body.removed).toBe(500);
    expect(body.remaining).toBe(120);
    // Batched, so one bad path cannot fail the whole run.
    expect(spies.remove.mock.calls.length).toBe(5);
    expect(spies.remove.mock.calls[0][1]).toHaveLength(100);
  });

  it("reports a failed selection instead of pretending it purged", async () => {
    db.selectError = { message: "function does not exist" };

    const res = await GET(authed());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "select_failed" });
    expect(spies.remove).not.toHaveBeenCalled();
  });
});

// The job runs with the service key, so storage RLS is not in its path and
// nothing but the code below decides which object gets deleted. image_url is
// writable by the row's owner, which makes every one of these a string an
// attacker chooses.
describe("a receipt cannot point the purge job at somebody else's photograph", () => {
  it("refuses a pointer into another user's folder", async () => {
    // u2 owns r2 and has written the path of u1's object into it. When r2 ages
    // out, u1's photograph must survive.
    db.due = [due("r2", url("r1", "u1"), "u2")];

    const res = await GET(authed());

    expect(spies.remove).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ due: 1, attempted: 0, removed: 0, skipped: 1 });
  });

  // The other half: the attacker's own folder, but a name carrying the
  // victim's receipt id — which is the id the storage read policy resolves by.
  it("refuses a pointer at another receipt's object inside its own folder", async () => {
    db.due = [due("r2", `${BUCKET_URL}/u2/r1.jpg?token=abc`, "u2")];

    const res = await GET(authed());

    expect(spies.remove).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ attempted: 0, removed: 0, skipped: 1 });
  });

  it("deletes only the bound rows when a decoy sits in the same batch", async () => {
    db.due = [due("r1"), due("r2", url("r1", "u1"), "u2"), due("r3")];

    const res = await GET(authed());

    expect(spies.remove).toHaveBeenCalledWith("receipt-images", ["u1/r1.jpg", "u1/r3.jpg"]);
    expect(spies.updatedIds).toHaveBeenCalledWith(["r1", "r3"]);
    expect(await res.json()).toMatchObject({ due: 3, attempted: 2, removed: 2, skipped: 1 });
  });

  // A row the RPC returns without an owner cannot be bound to anything, so it
  // is skipped rather than deleted on the strength of the pointer alone.
  it("refuses a row with no owner to bind against", async () => {
    db.due = [due("r1", url("r1"), null)];

    const res = await GET(authed());

    expect(spies.remove).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ skipped: 1 });
  });
});
