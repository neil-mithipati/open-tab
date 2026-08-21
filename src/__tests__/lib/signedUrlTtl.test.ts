import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  RECEIPT_IMAGE_CACHE_EXPIRE_SECONDS,
  RECEIPT_IMAGE_FETCH_TTL_SECONDS,
  RECEIPT_IMAGE_URL_TTL_SECONDS,
  imageUrlCacheFitsInsideTtl,
} from "@/lib/storage";

// Two things are asserted here and they are different in kind.
//
// The first is arithmetic: a URL handed out of the server cache at the last
// moment of its window must still have real validity left. That is what stops
// "short TTL" turning into broken images, and it is the reason the TTL and the
// cache window are not independent numbers.
//
// The second is a sweep of the source tree. A TTL constant is only worth
// anything if every call site uses it, so this walks src/ and refuses any
// createSignedUrl with a hardcoded lifetime, and any getPublicUrl at all. That
// catches the failure mode a unit test cannot: not a wrong number, but a new
// code path that never asked.

const SRC = path.join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // The suite's own mocks contain both call names as strings.
      if (entry === "__tests__") continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = sourceFiles(SRC).map((f) => ({
  path: path.relative(process.cwd(), f),
  text: readFileSync(f, "utf8"),
}));

describe("the TTL and the cache window fit together", () => {
  it("holds the invariant the two constants exist to express", () => {
    expect(imageUrlCacheFitsInsideTtl()).toBe(true);
  });

  it("leaves at least ten minutes on the oldest URL the cache can serve", () => {
    expect(
      RECEIPT_IMAGE_URL_TTL_SECONDS - RECEIPT_IMAGE_CACHE_EXPIRE_SECONDS
    ).toBeGreaterThanOrEqual(600);
  });

  // The invariant is a real predicate, not a function that returns true. If it
  // ever stops failing on an obviously bad pairing it has stopped protecting
  // anything.
  it("fails when the window is widened past the TTL", () => {
    expect(imageUrlCacheFitsInsideTtl(900, 901)).toBe(false);
    expect(imageUrlCacheFitsInsideTtl(900, 400)).toBe(false);
    expect(imageUrlCacheFitsInsideTtl(60, 300)).toBe(false);
  });
});

describe("the TTLs are short", () => {
  // The value before this task was 7200 on the server read path and 3600 on the
  // client. Both numbers are the exposure window on a leaked URL.
  it("signs display URLs for no more than fifteen minutes", () => {
    expect(RECEIPT_IMAGE_URL_TTL_SECONDS).toBeLessThanOrEqual(900);
    expect(RECEIPT_IMAGE_URL_TTL_SECONDS).toBeGreaterThan(0);
  });

  it("signs the server-to-server parse fetch for no more than a minute", () => {
    expect(RECEIPT_IMAGE_FETCH_TTL_SECONDS).toBeLessThanOrEqual(60);
    expect(RECEIPT_IMAGE_FETCH_TTL_SECONDS).toBeGreaterThan(0);
  });
});

describe("every image read in src/ goes through a short-TTL signed URL", () => {
  it("finds the call sites it is supposed to be checking", () => {
    const callers = files.filter((f) => f.text.includes("createSignedUrl("));
    expect(callers.length).toBeGreaterThanOrEqual(3);
  });

  it("never asks the storage API for a public URL", () => {
    for (const f of files) {
      expect(`${f.path}: ${f.text.includes("getPublicUrl")}`).toBe(`${f.path}: false`);
    }
  });

  it("never signs for a hardcoded number of seconds", () => {
    const literals: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(/createSignedUrl\(([^)]*)\)/g)) {
        const args = m[1];
        // Second argument is the lifetime.
        const ttl = args.split(",")[1]?.trim();
        if (ttl && /^\d/.test(ttl)) literals.push(`${f.path}: ${ttl}`);
      }
    }
    expect(literals).toEqual([]);
  });

  it("signs only with one of the two exported constants", () => {
    const allowed = new Set([
      "RECEIPT_IMAGE_URL_TTL_SECONDS",
      "RECEIPT_IMAGE_FETCH_TTL_SECONDS",
    ]);
    const offenders: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(/createSignedUrl\(([^)]*)\)/g)) {
        const ttl = m[1].split(",")[1]?.trim();
        if (!ttl || !allowed.has(ttl)) offenders.push(`${f.path}: ${ttl ?? "no ttl"}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // The cached read path is the one place a fresh signature is deliberately
  // reused, so its window has to be the constant rather than a number someone
  // typed next to it.
  it("bounds the cached read path with the cache constant", () => {
    const queries = files.find((f) => f.path.endsWith("src/lib/queries.ts"))!;
    expect(queries.text).toContain("expire: RECEIPT_IMAGE_CACHE_EXPIRE_SECONDS");
    expect(queries.text).toContain(
      "createSignedUrl(storagePath, RECEIPT_IMAGE_URL_TTL_SECONDS)"
    );
  });
});
