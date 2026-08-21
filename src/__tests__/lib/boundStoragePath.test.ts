import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { boundStoragePath } from "@/lib/storage";

// `receipts.image_url` is a column its owner can write anything into
// (`receipts_all_creator` is `for all using (auth.uid() = created_by)`), and
// every server-side reader of it signs or deletes with the service key, which
// bypasses RLS by design. So storage policies are not in that path and the only
// thing standing between a hand-written pointer and someone else's photograph
// is boundStoragePath.
//
// Two kinds of test here, and the second is the one that keeps the fix.
//
//   * the helper refuses every shape of foreign path;
//   * a sweep of src/ proving no code outside lib/storage.ts can reach the
//     unbound path at all. The bug this task fixed was not a wrong function —
//     the parse route already had one — it was three call sites and only one of
//     them binding. A unit test cannot see the call site that never asked.

const OWNER = "11111111-1111-1111-1111-111111111111";
const ATTACKER = "22222222-2222-2222-2222-222222222222";
const VICTIM_RECEIPT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ATTACKER_RECEIPT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const SIGN = "https://p.supabase.co/storage/v1/object/sign/receipt-images";

function signed(objectPath: string): string {
  return `${SIGN}/${objectPath}?token=eyJhbGciOiJIUzI1NiJ9.dead`;
}

// The row the attacker controls: their own receipt, with the victim's object
// name typed into it. Both halves of that name are obtainable — the receipt id
// comes back from getSharedReceipt to anyone holding a share link, and the
// owner's user id from find_profile_by_venmo_username, which 0015 grants to
// `authenticated`.
const ATTACK_ROW = {
  id: ATTACKER_RECEIPT,
  created_by: ATTACKER,
  image_url: signed(`${OWNER}/${VICTIM_RECEIPT}.jpg`),
};

describe("boundStoragePath binds a stored pointer to the row that stores it", () => {
  it("returns the path when the object is the receipt's own", () => {
    expect(
      boundStoragePath({
        id: ATTACKER_RECEIPT,
        created_by: ATTACKER,
        image_url: signed(`${ATTACKER}/${ATTACKER_RECEIPT}.jpg`),
      })
    ).toBe(`${ATTACKER}/${ATTACKER_RECEIPT}.jpg`);
  });

  it("accepts the other extensions the uploader can produce", () => {
    for (const ext of ["jpeg", "png", "webp", "heic", "JPG"]) {
      expect(
        boundStoragePath({
          id: ATTACKER_RECEIPT,
          created_by: ATTACKER,
          image_url: signed(`${ATTACKER}/${ATTACKER_RECEIPT}.${ext}`),
        })
      ).toBe(`${ATTACKER}/${ATTACKER_RECEIPT}.${ext}`);
    }
  });

  // The attack this whole function exists for.
  it("refuses another user's folder", () => {
    expect(boundStoragePath(ATTACK_ROW)).toBeNull();
  });

  it("refuses another receipt's object inside the caller's own folder", () => {
    // The read policy in 0026 resolves an object to a receipt by the id in its
    // name, so the folder alone is not enough to decide ownership.
    expect(
      boundStoragePath({
        id: ATTACKER_RECEIPT,
        created_by: ATTACKER,
        image_url: signed(`${ATTACKER}/${VICTIM_RECEIPT}.jpg`),
      })
    ).toBeNull();
  });

  it("refuses the caller's own receipt id under the victim's folder", () => {
    expect(
      boundStoragePath({
        id: ATTACKER_RECEIPT,
        created_by: ATTACKER,
        image_url: signed(`${OWNER}/${ATTACKER_RECEIPT}.jpg`),
      })
    ).toBeNull();
  });

  it("refuses a path that only starts with the right folder", () => {
    for (const bad of [
      `${ATTACKER}x/${ATTACKER_RECEIPT}.jpg`,
      `${ATTACKER}/sub/${ATTACKER_RECEIPT}.jpg`,
      `${OWNER}/${ATTACKER}/${ATTACKER_RECEIPT}.jpg`,
      `${ATTACKER}/${ATTACKER_RECEIPT}.jpg/../../${OWNER}/${VICTIM_RECEIPT}.jpg`,
      `${ATTACKER}/${ATTACKER_RECEIPT}x.jpg`,
      `${ATTACKER}/${ATTACKER_RECEIPT}`,
      `${ATTACKER}/${ATTACKER_RECEIPT}.`,
      `${ATTACKER}/${ATTACKER_RECEIPT}.jpg.enc`,
      `${ATTACKER}/${ATTACKER_RECEIPT}.jp g`,
    ]) {
      expect(`${bad}: ${boundStoragePath({
        id: ATTACKER_RECEIPT,
        created_by: ATTACKER,
        image_url: signed(bad),
      })}`).toBe(`${bad}: null`);
    }
  });

  // A row with no owner cannot be bound to anything, and "cannot be bound"
  // has to mean no image rather than no check.
  it("refuses a row with no owner, and one with no pointer", () => {
    expect(
      boundStoragePath({ id: ATTACKER_RECEIPT, created_by: null, image_url: signed(`${ATTACKER}/${ATTACKER_RECEIPT}.jpg`) })
    ).toBeNull();
    expect(
      boundStoragePath({ id: ATTACKER_RECEIPT, created_by: ATTACKER, image_url: null })
    ).toBeNull();
    expect(
      boundStoragePath({ id: ATTACKER_RECEIPT, created_by: ATTACKER, image_url: "not a url at all" })
    ).toBeNull();
  });

  // The value comes out of the database as text, so nothing stops a stored
  // pointer carrying regex metacharacters. The comparison is segment by
  // segment for exactly this reason — a pattern built by interpolating the
  // column would let one row rewrite the rule.
  it("does not let a crafted id or owner widen what it accepts", () => {
    expect(
      boundStoragePath({
        id: ".*",
        created_by: ".*",
        image_url: signed(`${OWNER}/${VICTIM_RECEIPT}.jpg`),
      })
    ).toBeNull();
    expect(
      boundStoragePath({
        id: `${ATTACKER_RECEIPT}|${VICTIM_RECEIPT}`,
        created_by: ATTACKER,
        image_url: signed(`${ATTACKER}/${VICTIM_RECEIPT}.jpg`),
      })
    ).toBeNull();
  });

  // What the code did before this task, kept here as the counter-example
  // rather than as prose: the same string, the same row, and the victim's
  // object name handed straight back to a caller that then signed it.
  it("is a real change from the unbound extractor it replaced", () => {
    function unbound(url: string | null): string | null {
      if (!url) return null;
      const pathname = new URL(url).pathname;
      const marker = "/receipt-images/";
      const idx = pathname.indexOf(marker);
      return idx === -1 ? null : pathname.slice(idx + marker.length);
    }

    expect(unbound(ATTACK_ROW.image_url)).toBe(`${OWNER}/${VICTIM_RECEIPT}.jpg`);
    expect(boundStoragePath(ATTACK_ROW)).toBeNull();
  });
});

// ─── the sweep ───────────────────────────────────────────────────────────────

const SRC = path.join(process.cwd(), "src");
const HELPER = "src/lib/storage.ts";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // The suite itself names the private function on purpose.
      if (entry === "__tests__") continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// Comments stripped: several files discuss the unbound extractor at length,
// and this test is about what the code reaches for, not what the prose beside
// it is allowed to name.
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

const files = sourceFiles(SRC).map((f) => ({
  path: path.relative(process.cwd(), f).split(path.sep).join("/"),
  code: stripComments(readFileSync(f, "utf8")),
}));

describe("nothing outside the helper can reach an unbound storage path", () => {
  it("finds the files it is supposed to be checking", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.path === HELPER)).toBe(true);
  });

  // The rule, and the reason it is a sweep rather than three assertions: the
  // hole was reopened by call sites that never asked the ownership question,
  // not by a wrong answer to it.
  it("no file but the helper mentions extractStoragePath", () => {
    for (const f of files) {
      if (f.path === HELPER) continue;
      expect(`${f.path}: ${f.code.includes("extractStoragePath")}`).toBe(
        `${f.path}: false`
      );
    }
  });

  it("the helper keeps the unbound extractor private", () => {
    const helper = files.find((f) => f.path === HELPER)!;

    expect(helper.code).toContain("function extractStoragePath");
    expect(helper.code).not.toMatch(/export\s+(async\s+)?function\s+extractStoragePath/);
    expect(helper.code).not.toMatch(/export\s*{[^}]*extractStoragePath/);
    expect(helper.code).toMatch(/export\s+function\s+boundStoragePath/);
  });

  // Every reader of the column, named. If a fourth appears it either binds or
  // it fails here.
  it("every reader of a stored image_url binds it", () => {
    const readers = [
      "src/app/receipts/[id]/page.tsx",
      "src/app/api/receipts/parse/route.ts",
      "src/app/api/cron/purge-receipt-images/route.ts",
    ];
    for (const reader of readers) {
      const f = files.find((x) => x.path === reader)!;
      expect(`${reader}: ${f !== undefined}`).toBe(`${reader}: true`);
      expect(`${reader}: ${f.code.includes("boundStoragePath(")}`).toBe(
        `${reader}: true`
      );
    }
  });

  // getReceiptImageUrl signs with the service client, so its argument is the
  // whole control. It may only ever be a value that came out of the helper.
  it("getReceiptImageUrl is only ever called with a bound path", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.path === "src/lib/queries.ts") continue; // the definition
      for (const m of f.code.matchAll(/getReceiptImageUrl\(([^)]*)\)/g)) {
        const arg = m[1].trim();
        const declared = new RegExp(
          `(const|let)\\s+${arg.replace(/[^\w$]/g, "")}\\s*=\\s*boundStoragePath\\(`
        );
        const direct = arg.startsWith("boundStoragePath(");
        if (!direct && !(/^[\w$]+$/.test(arg) && declared.test(f.code))) {
          offenders.push(`${f.path}: ${arg}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("finds at least one getReceiptImageUrl call site, so the check is live", () => {
    const callers = files.filter(
      (f) => f.path !== "src/lib/queries.ts" && f.code.includes("getReceiptImageUrl(")
    );
    expect(callers.map((c) => c.path)).toContain("src/app/receipts/[id]/page.tsx");
  });

  // The hole this closes: a call site can inline the same marker-and-slice
  // logic as extractStoragePath without ever writing that name, and the rule
  // above would not see it. Naming the marker string catches the copy
  // regardless of what the surrounding code calls itself.
  it("no file but the helper parses the receipt-images marker inline", () => {
    for (const f of files) {
      if (f.path === HELPER) continue;
      expect(`${f.path}: ${f.code.includes("/receipt-images/")}`).toBe(
        `${f.path}: false`
      );
    }
  });
});
