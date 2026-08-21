import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// WHAT THIS FILE IS, AND WHAT IT IS NOT.
//
// It is a set of assertions about the TEXT of two files: migration 0026 and
// supabase/storage-policies.sql. It reads them off disk and matches strings.
// There is no database in this suite (see chargesRls.test.ts, which makes the
// same trade), nothing here connects to one, and no statement in either file
// is ever executed by it. So nothing in this file is evidence that the bucket
// is private, that an anonymous read is refused, or that a non-participant
// cannot select an object. A green run here means the files still SAY what
// they said, not that postgres DOES what they say.
//
// Runtime proof of the policies has to come from a real server: apply 0026,
// apply the storage policies through the dashboard (see docs/deployment.md),
// and run the selects. The value of the static half is narrower and still
// worth having — it catches the specific later edits that quietly undo the
// fix. A bucket flipped back to public, an `anon` grant added to a policy,
// the participant branch dropped from the read policy so only owners can see
// a check, the receipt-ownership half dropped from the write policy, or a
// purge predicate narrowed to parsed_at alone so a receipt escapes retention
// by having failed to parse.
//
// OT-143 split the original all-in-one 0026 in two: `0026` keeps only the
// `public.` objects, because `storage.buckets` and `storage.objects` are
// owned by `supabase_storage_admin` on a hosted project and `supabase db
// push` cannot touch them. The bucket privacy row and the three storage
// policies moved to `supabase/storage-policies.sql`. This file asserts both
// halves, plus that the moved statements are actually gone from 0026 — that
// absence is the whole point of the split.

const root = process.cwd();
const MIGRATION_FILE = "0026_receipt_image_storage_lockdown.sql";
const POLICIES_FILE = "storage-policies.sql";

function read(dir: string, file: string): string {
  return readFileSync(path.join(root, dir, file), "utf8");
}

// `--` line comments only; no file here puts one inside a string literal.
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function flatten(sql: string): string {
  return stripComments(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

// Split on semicolons outside parentheses. Neither file's function bodies
// contain semicolons, so this does not need to understand dollar quoting.
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

const migrationSql = flatten(read("supabase/migrations", MIGRATION_FILE));
const migrationStmts = statements(read("supabase/migrations", MIGRATION_FILE));

const policiesSql = flatten(read("supabase", POLICIES_FILE));
const policiesStmts = statements(read("supabase", POLICIES_FILE));

function policy(name: string): string {
  const found = policiesStmts.find(
    (s) => s.startsWith("create policy") && s.includes(`"${name}"`)
  );
  if (!found) throw new Error(`no ${name} policy in ${POLICIES_FILE}`);
  return found;
}

describe("0026 takes the next free migration slot", () => {
  it("is the highest-numbered migration", () => {
    const files = readdirSync(path.join(root, "supabase", "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    expect(files.at(-1)).toBe(MIGRATION_FILE);
    expect(files.filter((f) => f.startsWith("0026_"))).toHaveLength(1);
  });
});

describe("0026 no longer carries the storage half", () => {
  // The whole point of OT-143: db push cannot touch storage.objects or
  // storage.buckets, so nothing that requires those tables' owner may sit in
  // a migration db push executes.
  it("does not enable row level security on storage.objects", () => {
    expect(migrationSql).not.toContain(
      "alter table storage.objects enable row level security"
    );
  });

  it("creates no policy on storage.objects", () => {
    expect(migrationSql).not.toContain("create policy");
  });

  it("does not touch storage.buckets", () => {
    expect(migrationSql).not.toContain("storage.buckets");
  });
});

describe("storage-policies.sql declares the bucket private", () => {
  it("declares public = false when it creates the bucket", () => {
    expect(policiesSql).toContain(
      "insert into storage.buckets (id, name, public) values ('receipt-images', 'receipt-images', false)"
    );
  });

  // The important half. Every real deployment already has this bucket, so the
  // insert is a no-op there and the conflict branch is the only thing that runs.
  it("forces public = false on a bucket that already exists", () => {
    expect(policiesSql).toContain("on conflict (id) do update set public = false");
  });

  it("never sets public true", () => {
    expect(policiesSql).not.toMatch(/public\s*=\s*true/);
    expect(policiesSql).not.toContain("'receipt-images', true");
  });
});

describe("storage-policies.sql declares its storage.objects policies", () => {
  it("declares row level security on", () => {
    expect(policiesSql).toContain(
      "alter table storage.objects enable row level security"
    );
  });

  // The anonymous-read control is an ABSENCE — no policy admits `anon`, so RLS
  // denies it by default. An absence is exactly the kind of control a later
  // edit restores without meaning to, which is why it is asserted rather than
  // trusted.
  it("declares no policy for anon or for public", () => {
    for (const p of policiesStmts.filter((s) => s.startsWith("create policy"))) {
      expect(p).toContain("to authenticated");
      expect(p).not.toContain("to anon");
      expect(p).not.toContain("to public");
      expect(p).not.toContain("to service_role");
    }
  });

  it("declares every policy scoped to the receipt-images bucket", () => {
    const policies = policiesStmts.filter((s) => s.startsWith("create policy"));
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) {
      expect(p).toContain("bucket_id = 'receipt-images'");
    }
  });

  describe("the read policy text", () => {
    const read_ = policy("receipt_images_select_owner_or_participant");

    it("names the receipt's owner", () => {
      expect(read_).toContain(
        "public.receipt_creator_id(public.receipt_image_receipt_id(name)) = auth.uid()"
      );
    });

    // Dropping this line would leave the app looking fine to whoever paid and
    // broken for everyone they split with.
    it("names the receipt's participants too", () => {
      expect(read_).toContain(
        "public.is_receipt_participant(public.receipt_image_receipt_id(name))"
      );
    });

    // A prefix test would deny every participant, since the folder is the
    // uploader's id and a participant is not the uploader.
    it("does not mention the storage path prefix", () => {
      expect(read_).not.toContain("storage.foldername");
    });
  });

  describe("the write policy text", () => {
    const insert = policy("receipt_images_insert_own");

    it("names the caller's own folder", () => {
      expect(insert).toContain("(storage.foldername(name))[1] = auth.uid()::text");
    });

    // Without this, a user could park an object under their own prefix but
    // named with a victim's receipt id — which the read policy resolves BY
    // receipt id, so the victim's participants would be shown it.
    it("also names the receipt the object is for", () => {
      expect(insert).toContain(
        "public.receipt_creator_id(public.receipt_image_receipt_id(name)) = auth.uid()"
      );
    });

    it("is a with check, not a using clause", () => {
      expect(insert).toContain("for insert to authenticated with check (");
      expect(insert).not.toContain(" using (");
    });
  });

  describe("the delete policy text", () => {
    const del = policy("receipt_images_delete_own");

    it("names both halves of the owner test", () => {
      expect(del).toContain("for delete to authenticated");
      expect(del).toContain("(storage.foldername(name))[1] = auth.uid()::text");
      expect(del).toContain(
        "public.receipt_creator_id(public.receipt_image_receipt_id(name)) = auth.uid()"
      );
    });
  });

  it("declares no update policy, so stored bytes cannot be swapped", () => {
    expect(policiesSql).not.toContain("for update");
  });
});

describe("receipt_image_receipt_id, as written", () => {
  // A policy that raises takes the whole statement with it, so one oddly named
  // object would break reads for every other object in the same query. The
  // regex guard is what makes the cast total.
  it("guards the cast with a uuid pattern instead of casting blind", () => {
    const fn = migrationStmts.find((s) =>
      s.includes("create or replace function public.receipt_image_receipt_id")
    )!;

    expect(fn).toContain("case");
    expect(fn).toContain("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    expect(fn).toContain("::uuid");
  });

  it("does not need definer rights, because it reads no table", () => {
    const fn = migrationStmts.find((s) =>
      s.includes("create or replace function public.receipt_image_receipt_id")
    )!;

    expect(fn).toContain("language sql immutable");
    expect(fn).not.toContain("security definer");
  });
});

describe("the retention selection, as written", () => {
  const fn = migrationStmts.find((s) =>
    s.includes("create function public.receipt_images_due_for_purge")
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

  // image_url is writable by the row's owner, so the purge job may not remove
  // whatever it names — it re-derives `<created_by>/<id>.<ext>` through
  // boundStoragePath and skips anything else. That binding needs the owner,
  // and this is where the owner comes from.
  it("returns the owner the job binds the stored pointer to", () => {
    expect(fn).toContain("returns table (id uuid, created_by uuid, image_url text)");
    expect(fn).toContain("select r.id, r.created_by, r.image_url");
  });
});

describe("0026 is additive, as written", () => {
  it("touches no data and no table structure", () => {
    for (const forbidden of [
      "delete from",
      "truncate",
      "alter table public.",
      "drop table",
      "drop column",
      "drop index",
    ]) {
      expect(migrationSql).not.toContain(forbidden);
    }
  });

  // The only drop in 0026 is the function it immediately recreates on the
  // next statement, which is what makes re-running the file safe. It exists
  // because a create-or-replace cannot change a function's OUT columns, and
  // the retention function grew one.
  it("removes nothing it does not immediately recreate", () => {
    const functions = migrationStmts
      .filter((s) => s.startsWith("drop function"))
      .map((s) => s.replace("drop function if exists ", "").split("(")[0]);
    expect(functions).toEqual(["public.receipt_images_due_for_purge"]);
    for (const fn of functions) {
      expect(migrationStmts.some((s) => s.startsWith(`create function ${fn}(`))).toBe(
        true
      );
    }
  });

  // Everything removed is removed conditionally, so a first run against a
  // project that has none of these objects yet does not fail on the way in.
  it("guards every removal with if exists", () => {
    for (const s of migrationStmts.filter((x) => x.startsWith("drop "))) {
      expect(s).toContain("if exists");
    }
  });

  it("writes to no table — the only write in the pair is the bucket row in storage-policies.sql", () => {
    const writes = migrationStmts.filter(
      (s) => s.startsWith("insert into") || s.startsWith("update ")
    );
    expect(writes).toHaveLength(0);
  });

  it("creates its index concurrently-safely and idempotently", () => {
    expect(migrationSql).toContain(
      "create index if not exists idx_receipts_image_retention"
    );
  });
});

describe("storage-policies.sql removes nothing it does not immediately recreate", () => {
  it("every dropped policy is recreated", () => {
    const dropped = policiesStmts
      .filter((s) => s.startsWith("drop policy if exists"))
      .map((s) => s.match(/"([^"]+)"/)![1]);
    const created = policiesStmts
      .filter((s) => s.startsWith("create policy"))
      .map((s) => s.match(/"([^"]+)"/)![1]);

    expect(dropped.length).toBeGreaterThan(0);
    for (const name of dropped) expect(created).toContain(name);
  });

  it("guards every removal with if exists", () => {
    for (const s of policiesStmts.filter((x) => x.startsWith("drop "))) {
      expect(s).toContain("if exists");
    }
  });

  it("writes to exactly one table, and that table is the bucket registry", () => {
    const writes = policiesStmts.filter(
      (s) => s.startsWith("insert into") || s.startsWith("update ")
    );

    expect(writes).toHaveLength(1);
    expect(writes[0].startsWith("insert into storage.buckets")).toBe(true);
  });
});
