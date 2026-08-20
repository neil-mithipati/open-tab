import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Migration 0026 puts the receipt-images bucket and its policies into the
// schema, where until now they existed only in a dashboard console. There is no
// database in this suite (see chargesRls.test.ts, which makes the same trade),
// so these tests read the SQL and assert the shape of what it declares.
//
// That is weaker than a SELECT against a live server and it is not what proved
// the policies correct — the policies were run against a real postgres before
// this file was written, and the observed output is recorded in the task. What
// these tests are for is the other half: catching the specific later edits that
// would quietly undo the fix. A bucket flipped back to public, an `anon` grant
// added to a policy, the participant branch dropped from the read policy so
// only owners can see a check, the receipt-ownership half dropped from the
// write policy, or a purge predicate narrowed to parsed_at alone so a receipt
// escapes retention by having failed to parse.

const migrations = path.join(process.cwd(), "supabase", "migrations");
const FILE = "0026_receipt_image_storage_lockdown.sql";

function read(file: string): string {
  return readFileSync(path.join(migrations, file), "utf8");
}

// `--` line comments only; no migration here puts one inside a string literal.
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function flatten(sql: string): string {
  return stripComments(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

// Split on semicolons outside parentheses. 0026's two function bodies contain
// no semicolons, so this does not need to understand dollar quoting.
function statements(sql: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of stripComments(sql)) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === ";" && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out
    .map((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
}

const sql = flatten(read(FILE));
const stmts = statements(read(FILE));

function policy(name: string): string {
  const found = stmts.find(
    (s) => s.startsWith("create policy") && s.includes(`"${name}"`)
  );
  if (!found) throw new Error(`no ${name} policy in ${FILE}`);
  return found;
}

describe("0026 takes the next free migration slot", () => {
  it("is the highest-numbered migration", () => {
    const files = readdirSync(migrations)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    expect(files.at(-1)).toBe(FILE);
    expect(files.filter((f) => f.startsWith("0026_"))).toHaveLength(1);
  });
});

describe("the bucket is private", () => {
  it("declares public = false when it creates the bucket", () => {
    expect(sql).toContain(
      "insert into storage.buckets (id, name, public) values ('receipt-images', 'receipt-images', false)"
    );
  });

  // The important half. Every real deployment already has this bucket, so the
  // insert is a no-op there and the conflict branch is the only thing that runs.
  it("forces public = false on a bucket that already exists", () => {
    expect(sql).toContain("on conflict (id) do update set public = false");
  });

  it("never sets public true", () => {
    expect(sql).not.toMatch(/public\s*=\s*true/);
    expect(sql).not.toContain("'receipt-images', true");
  });
});

describe("storage.objects policies", () => {
  it("keeps row level security on", () => {
    expect(sql).toContain("alter table storage.objects enable row level security");
  });

  // The anonymous-read control is an ABSENCE — no policy admits `anon`, so RLS
  // denies it by default. An absence is exactly the kind of control a later
  // edit restores without meaning to, which is why it is asserted rather than
  // trusted.
  it("grants no policy to anon or to public", () => {
    for (const p of stmts.filter((s) => s.startsWith("create policy"))) {
      expect(p).toContain("to authenticated");
      expect(p).not.toContain("to anon");
      expect(p).not.toContain("to public");
      expect(p).not.toContain("to service_role");
    }
  });

  it("scopes every policy to the receipt-images bucket", () => {
    const policies = stmts.filter((s) => s.startsWith("create policy"));
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) {
      expect(p).toContain("bucket_id = 'receipt-images'");
    }
  });

  describe("read", () => {
    const read_ = policy("receipt_images_select_owner_or_participant");

    it("lets the receipt's owner read it", () => {
      expect(read_).toContain(
        "public.receipt_creator_id(public.receipt_image_receipt_id(name)) = auth.uid()"
      );
    });

    // Dropping this line would leave the app looking fine to whoever paid and
    // broken for everyone they split with.
    it("lets the receipt's participants read it", () => {
      expect(read_).toContain(
        "public.is_receipt_participant(public.receipt_image_receipt_id(name))"
      );
    });

    // A prefix test would deny every participant, since the folder is the
    // uploader's id and a participant is not the uploader.
    it("does not gate reads on the storage path prefix", () => {
      expect(read_).not.toContain("storage.foldername");
    });
  });

  describe("write", () => {
    const insert = policy("receipt_images_insert_own");

    it("pins the object to the caller's own folder", () => {
      expect(insert).toContain("(storage.foldername(name))[1] = auth.uid()::text");
    });

    // Without this, a user could park an object under their own prefix but
    // named with a victim's receipt id — which the read policy resolves BY
    // receipt id, so the victim's participants would be shown it.
    it("also requires the receipt named in the object to be the caller's", () => {
      expect(insert).toContain(
        "public.receipt_creator_id(public.receipt_image_receipt_id(name)) = auth.uid()"
      );
    });

    it("is a with check, not a using clause", () => {
      expect(insert).toContain("for insert to authenticated with check (");
      expect(insert).not.toContain(" using (");
    });
  });

  describe("delete", () => {
    const del = policy("receipt_images_delete_own");

    it("is owner only, on both tests", () => {
      expect(del).toContain("for delete to authenticated");
      expect(del).toContain("(storage.foldername(name))[1] = auth.uid()::text");
      expect(del).toContain(
        "public.receipt_creator_id(public.receipt_image_receipt_id(name)) = auth.uid()"
      );
    });
  });

  it("declares no update policy, so stored bytes cannot be swapped", () => {
    expect(sql).not.toContain("for update");
  });
});

describe("receipt_image_receipt_id", () => {
  // A policy that raises takes the whole statement with it, so one oddly named
  // object would break reads for every other object in the same query. The
  // regex guard is what makes the cast total.
  it("guards the cast with a uuid pattern instead of casting blind", () => {
    const fn = stmts.find((s) =>
      s.includes("create or replace function public.receipt_image_receipt_id")
    )!;

    expect(fn).toContain("case");
    expect(fn).toContain("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    expect(fn).toContain("::uuid");
  });

  it("does not need definer rights, because it reads no table", () => {
    const fn = stmts.find((s) =>
      s.includes("create or replace function public.receipt_image_receipt_id")
    )!;

    expect(fn).toContain("language sql immutable");
    expect(fn).not.toContain("security definer");
  });
});

describe("retention selection", () => {
  const fn = stmts.find((s) =>
    s.includes("create or replace function public.receipt_images_due_for_purge")
  )!;

  it("takes the cutoff as an argument, so N is configured in one place", () => {
    expect(fn).toContain("receipt_images_due_for_purge(p_before timestamptz)");
    // No interval literal baked into the SQL — that would be a second N.
    expect(fn).not.toContain("interval");
  });

  // 0025 sets parsed_at back to null when it releases a claim after a transient
  // provider failure. Ageing on parsed_at alone would let such a receipt keep
  // its photograph forever.
  it("ages on the later of parsed_at and last_parse_attempt_at", () => {
    expect(fn).toContain("greatest(r.parsed_at, r.last_parse_attempt_at) < p_before");
  });

  // An upload abandoned between the storage write and the parse call carries
  // neither timestamp and is exactly as sensitive as a parsed one.
  it("also ages a receipt that was never parsed at all", () => {
    expect(fn).toContain("r.parsed_at is null");
    expect(fn).toContain("r.last_parse_attempt_at is null");
    expect(fn).toContain("r.created_at < p_before");
  });

  // Without this the job reselects everything it has already purged, forever.
  it("skips rows whose image is already gone", () => {
    expect(fn).toContain("r.image_url is not null");
  });
});

describe("0026 is additive", () => {
  it("touches no data and no table structure", () => {
    for (const forbidden of [
      "delete from",
      "truncate",
      "alter table public.",
      "drop table",
      "drop column",
      "drop function",
      "drop index",
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  // The only writes are the bucket row and the only drops are of policies this
  // same file recreates on the next statement, which is what makes re-running
  // it safe.
  it("drops nothing it does not immediately recreate", () => {
    const dropped = stmts
      .filter((s) => s.startsWith("drop policy if exists"))
      .map((s) => s.match(/"([^"]+)"/)![1]);
    const created = stmts
      .filter((s) => s.startsWith("create policy"))
      .map((s) => s.match(/"([^"]+)"/)![1]);

    expect(dropped.length).toBeGreaterThan(0);
    for (const name of dropped) expect(created).toContain(name);
  });

  it("writes to exactly one table, and that table is the bucket registry", () => {
    const writes = stmts.filter(
      (s) => s.startsWith("insert into") || s.startsWith("update ")
    );

    expect(writes).toHaveLength(1);
    expect(writes[0].startsWith("insert into storage.buckets")).toBe(true);
  });

  it("creates its index concurrently-safely and idempotently", () => {
    expect(sql).toContain("create index if not exists idx_receipts_image_retention");
  });
});
