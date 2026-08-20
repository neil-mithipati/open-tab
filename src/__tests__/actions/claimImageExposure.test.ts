import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The claim link is the one path in this app that serves receipt data to a
// browser with no session. It runs on the service client, which bypasses RLS by
// design, so the storage policies added in 0026 are not a backstop here — every
// column that reaches an anonymous claimer is a column this file chose to hand
// over.
//
// Two questions, and these tests answer both:
//
//   EXPOSURE     — can a claim link surface the photograph, or anything that
//                  leads to it?
//   ENUMERATION  — can a token for one receipt be aimed at another receipt's
//                  image, or at another receipt at all?
//
// Receipt B below belongs to a different owner and carries its own photograph.
// Every attempt that follows uses B's token against A's rows, or A's token
// against B's, which is the shape of both questions.

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("@/lib/rateLimit", () => ({
  isClaimJoinRateLimited: async () => false,
  CLAIM_JOIN_LIMIT_PER_HOUR: 20,
}));

type Row = Record<string, unknown>;

const IMAGE_A = "https://p.supabase.co/storage/v1/object/sign/receipt-images/ownerA/rA.jpg?token=zz";
const IMAGE_B = "https://p.supabase.co/storage/v1/object/sign/receipt-images/ownerB/rB.jpg?token=yy";

const db: Record<string, Row[]> = {};
const selects: { table: string; columns: string | undefined }[] = [];

function reset() {
  selects.length = 0;
  db.receipts = [
    {
      id: "rA",
      share_token: "token-A",
      status: "shared",
      created_by: "ownerA",
      merchant_name: "Cafe A",
      date_of_receipt: "2026-08-01",
      subtotal: 10,
      tax: 1,
      tip: 2,
      total: 13,
      // The whole point: the row a claim token resolves to DOES carry a photo.
      image_url: IMAGE_A,
      parsed_at: "2026-08-01T00:00:00.000Z",
    },
    {
      id: "rB",
      share_token: "token-B",
      status: "shared",
      created_by: "ownerB",
      merchant_name: "Bar B",
      date_of_receipt: "2026-08-02",
      subtotal: 20,
      tax: 2,
      tip: 4,
      total: 26,
      image_url: IMAGE_B,
      parsed_at: "2026-08-02T00:00:00.000Z",
    },
  ];
  db.profiles = [
    { id: "ownerA", display_name: "Ana", venmo_username: "ana" },
    { id: "ownerB", display_name: "Ben", venmo_username: "ben" },
  ];
  db.receipt_items = [
    { id: "iA", receipt_id: "rA", name: "Toast", price: 5, quantity: 1, sort_order: 0, item_assignments: [] },
    { id: "iB", receipt_id: "rB", name: "Beer", price: 7, quantity: 1, sort_order: 0, item_assignments: [] },
  ];
  db.receipt_participants = [
    { id: "pA", receipt_id: "rA", user_id: null, display_name: "Ana", venmo_username: "ana", is_owner: true, joined_via_share: false, claim_done_at: null },
    { id: "pB", receipt_id: "rB", user_id: null, display_name: "Ben", venmo_username: "ben", is_owner: true, joined_via_share: false, claim_done_at: null },
  ];
  db.charges = [];
  db.item_assignments = [];
}

// A filter-collecting builder over the row maps above. It models eq/ilike
// filters, the terminal shapes claim.ts uses (single, maybeSingle, awaiting the
// builder itself), and counts — which is enough for every read on the public
// half of that file.
vi.mock("@/lib/supabase/server", () => {
  function table(name: string) {
    const rowsOf = () => (db[name] ??= []);

    function query() {
      const filters: [string, unknown][] = [];
      let head = false;

      const matched = () =>
        rowsOf().filter((r) => filters.every(([c, v]) => r[c] === v));

      const b: Record<string, unknown> = {
        select(columns?: string, opts?: { head?: boolean }) {
          selects.push({ table: name, columns });
          head = Boolean(opts?.head);
          return b;
        },
        eq(c: string, v: unknown) {
          filters.push([c, v]);
          return b;
        },
        ilike(c: string, v: string) {
          filters.push([c, v.replace(/\\/g, "")]);
          return b;
        },
        order: () => b,
        single: async () => ({ data: matched()[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
        then(resolve: (v: unknown) => void) {
          resolve({
            data: head ? null : matched(),
            count: matched().length,
            error: null,
          });
        },
      };
      return b;
    }

    return {
      select: (columns?: string, opts?: { head?: boolean }) =>
        (query().select as (c?: string, o?: { head?: boolean }) => unknown)(columns, opts),
      insert: (values: Row) => {
        const row = { id: `new-${rowsOf().length}`, ...values };
        rowsOf().push(row);
        return {
          select: () => ({ single: async () => ({ data: row, error: null }) }),
        };
      },
      update: (patch: Row) => {
        const filters: [string, unknown][] = [];
        const b: Record<string, unknown> = {
          eq(c: string, v: unknown) {
            filters.push([c, v]);
            return b;
          },
          then(resolve: (v: unknown) => void) {
            const hit = rowsOf().filter((r) =>
              filters.every(([c, v]) => r[c] === v)
            );
            hit.forEach((r) => Object.assign(r, patch));
            resolve({ data: hit, error: null });
          },
        };
        return b;
      },
      delete: () => {
        const filters: [string, unknown][] = [];
        const b: Record<string, unknown> = {
          eq(c: string, v: unknown) {
            filters.push([c, v]);
            return b;
          },
          then(resolve: (v: unknown) => void) {
            db[name] = rowsOf().filter(
              (r) => !filters.every(([c, v]) => r[c] === v)
            );
            resolve({ data: null, error: null });
          },
        };
        return b;
      },
    };
  }

  return {
    getSupabaseServiceClient: async () => ({ from: table }),
    getSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: table,
    }),
  };
});

const { getSharedReceipt, toggleClaim, setClaimDone, joinReceipt } = await import(
  "@/app/actions/claim"
);

beforeEach(reset);

describe("exposure: a claim link cannot surface the photograph", () => {
  it("returns no image field, for a receipt that has one", async () => {
    const shared = await getSharedReceipt("token-A");

    expect(shared).not.toBeNull();
    // Everything the claimer legitimately needs is still there.
    expect(shared!.merchant_name).toBe("Cafe A");
    expect(shared!.total).toBe(13);
    // And nothing that leads to the photo is.
    expect(Object.keys(shared!)).not.toContain("image_url");
    expect(JSON.stringify(shared)).not.toContain(IMAGE_A);
    expect(JSON.stringify(shared)).not.toContain("receipt-images");
    expect(JSON.stringify(shared)).not.toContain("storage");
  });

  // The mechanism, not just the result: the query names its columns, so a
  // column added to `receipts` later cannot arrive here by default.
  it("asks the receipts table for a named column list that omits image_url", async () => {
    await getSharedReceipt("token-A");

    const receiptSelects = selects.filter((s) => s.table === "receipts");
    expect(receiptSelects.length).toBeGreaterThan(0);
    for (const s of receiptSelects) {
      expect(s.columns).toBeDefined();
      expect(s.columns).not.toContain("*");
      expect(s.columns).not.toContain("image_url");
    }
  });

  it("leaks no photo through any other table it reads", async () => {
    await getSharedReceipt("token-A");

    for (const s of selects) {
      expect(`${s.table}: ${s.columns}`).not.toContain("image_url");
    }
  });

  it("returns null for a token nobody issued", async () => {
    expect(await getSharedReceipt("token-that-does-not-exist")).toBeNull();
    expect(await getSharedReceipt("")).toBeNull();
  });
});

describe("enumeration: one receipt's token cannot reach another's", () => {
  it("resolves each token to its own receipt and nothing else", async () => {
    const a = await getSharedReceipt("token-A");
    const b = await getSharedReceipt("token-B");

    expect(a!.id).toBe("rA");
    expect(b!.id).toBe("rB");
    expect(a!.items.map((i) => i.id)).toEqual(["iA"]);
    expect(b!.items.map((i) => i.id)).toEqual(["iB"]);
    expect(a!.participants.map((p) => p.id)).toEqual(["pA"]);
    expect(b!.participants.map((p) => p.id)).toEqual(["pB"]);
  });

  // The attack the task names: hold a valid token for a receipt you were
  // invited to, and aim it at rows belonging to a receipt you were not.
  it("refuses B's token pointed at A's participant and item", async () => {
    const result = await toggleClaim("token-B", "pA", "iA");

    expect(result).toEqual({ error: "Invalid claim." });
    expect(db.item_assignments).toHaveLength(0);
  });

  it("refuses B's token pointed at A's item with B's own participant", async () => {
    const result = await toggleClaim("token-B", "pB", "iA");

    expect(result).toEqual({ error: "Invalid claim." });
    expect(db.item_assignments).toHaveLength(0);
  });

  it("refuses to mark another receipt's participant done", async () => {
    await setClaimDone("token-B", "pA", true);

    expect(db.receipt_participants.find((p) => p.id === "pA")!.claim_done_at).toBeNull();
  });

  it("joins the receipt the token names, not one the caller picks", async () => {
    const joined = await joinReceipt("token-B", "carol");

    expect("participantId" in joined).toBe(true);
    const row = db.receipt_participants.find(
      (p) => p.venmo_username === "carol"
    )!;
    expect(row.receipt_id).toBe("rB");
  });

  it("still lets a legitimate claim through, so the flow is not just broken", async () => {
    const result = await toggleClaim("token-A", "pA", "iA");

    expect(result).toEqual({ claimed: true });
  });
});

// The runtime tests above prove today's behaviour. This one guards the shape:
// the public half of claim.ts must not grow a storage call or a caller-supplied
// receipt id, either of which would make the tests above stop being sufficient.
describe("the public half of claim.ts reaches no storage at all", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src", "app", "actions", "claim.ts"),
    "utf8"
  );
  // Comments stripped first. The header of that file discusses the bucket at
  // length, on purpose — this test is about what the code does, not what the
  // prose above it is allowed to name.
  const code = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  // Split on the first declaration of the authenticated half rather than on
  // the banner above it, which the strip has just removed.
  const parts = code.split("type OwnedReceipt");
  const publicHalf = parts[0];

  it("is actually looking at the public half and not the whole file", () => {
    expect(parts).toHaveLength(2);
    expect(publicHalf).toContain("export async function getSharedReceipt");
    expect(publicHalf).toContain("export async function toggleClaim");
    expect(publicHalf).not.toContain("export async function shareReceipt");
  });

  it("never mentions the bucket, storage or a signed URL", () => {
    for (const forbidden of [
      "storage",
      "receipt-images",
      "createSignedUrl",
      "getPublicUrl",
      "extractStoragePath",
    ]) {
      expect(`${forbidden}: ${publicHalf.includes(forbidden)}`).toBe(
        `${forbidden}: false`
      );
    }
  });

  it("never selects image_url, and never selects a whole receipts row", () => {
    expect(publicHalf).not.toContain("image_url");
    expect(publicHalf).not.toMatch(/from\("receipts"\)\s*\.select\("\*"\)/);
  });

  // Every public action's first argument is the token. A receipt id parameter
  // would be a way to name a receipt without holding its token.
  it("takes no receipt id from the caller", () => {
    for (const match of publicHalf.matchAll(/export async function (\w+)\(([^)]*)\)/g)) {
      expect(`${match[1]}: ${match[2].replace(/\s+/g, " ").trim()}`).toMatch(
        /^\w+: token: string/
      );
      expect(match[2]).not.toContain("receiptId");
    }
  });
});
