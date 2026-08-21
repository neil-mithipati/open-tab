import { describe, it, expect } from "vitest";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  canonicalizeExpression,
  diffBuckets,
  diffMigrations,
  diffPolicies,
  extractQueryRows,
  formatReport,
  migrationVersion,
  normalizeLiveBuckets,
  normalizeLivePolicies,
  parseDeclaredBuckets,
  parseDeclaredPolicies,
  parsePgTextArray,
  redactSecrets,
  repoMigrationVersions,
  type DeclaredPolicy,
} from "../../../scripts/check-schema-drift";

// WHAT THIS FILE PROVES, AND WHAT IT DOES NOT.
//
// There is no database in this suite. Nothing here connects to a Supabase
// project, and a green run is NOT evidence that production matches the repo —
// only `npm run check:drift` against a linked project can say that.
//
// What is testable without a database is the half that is easy to get wrong:
// turning a policy back into a comparable shape. The live rows below are the
// ones OT-143 observed on 2026-08-20 after the manual dashboard apply, with the
// `qual`/`with_check` text written the way postgres deparses it — extra
// parentheses, `::text` casts postgres adds to literals, and no `public.`
// qualifier, because `public` is on the search path so postgres drops it.
//
// Those three differences are exactly why a string compare of the declared text
// against the live text can never work, and why every one of them is normalised
// away below.

const ROOT = process.cwd();
const POLICIES_SQL = readFileSync(path.join(ROOT, "supabase", "storage-policies.sql"), "utf8");

// --- live fixtures, as postgres reports them -------------------------------

const LIVE_READ_QUAL =
  "((bucket_id = 'receipt-images'::text) AND ((receipt_creator_id(receipt_image_receipt_id(name)) = auth.uid()) OR is_receipt_participant(receipt_image_receipt_id(name))))";

const LIVE_OWNER_EXPR =
  "((bucket_id = 'receipt-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text) AND (receipt_creator_id(receipt_image_receipt_id(name)) = auth.uid()))";

function liveRow(
  policyname: string,
  cmd: string,
  qual: string | null,
  withCheck: string | null,
  roles = "{authenticated}"
): Record<string, unknown> {
  return {
    policyname,
    cmd,
    permissive: "PERMISSIVE",
    roles,
    qual,
    with_check: withCheck,
  };
}

// The four rows the dashboard actually produced. Note the suffixes, and note
// that there are four of them for three declared policies.
const LIVE_ROWS_AS_OBSERVED = [
  liveRow("receipt_images_delete_own 13hfyy5_0", "DELETE", LIVE_OWNER_EXPR, null),
  liveRow("receipt_images_delete_own 13hfyy5_1", "SELECT", LIVE_OWNER_EXPR, null),
  liveRow("receipt_images_insert_own 13hfyy5_0", "INSERT", null, LIVE_OWNER_EXPR),
  liveRow("receipt_images_select_owner_or_participant 13hfyy5_0", "SELECT", LIVE_READ_QUAL, null),
];

// The same apply done correctly: the delete policy has only DELETE ticked.
const LIVE_ROWS_CORRECT = LIVE_ROWS_AS_OBSERVED.filter(
  (row) => row.policyname !== "receipt_images_delete_own 13hfyy5_1"
);

const declaredPolicies = parseDeclaredPolicies(POLICIES_SQL).filter((p) => p.table === "storage.objects");

function declared(name: string): DeclaredPolicy {
  const found = declaredPolicies.find((p) => p.name === name);
  if (!found) throw new Error(`no declared policy named ${name}`);
  return found;
}

describe("secrets never reach stdout", () => {
  it("redacts a supabase access token", () => {
    expect(redactSecrets("using sbp_0123456789abcdef0123456789abcdef01234567 now")).toBe(
      "using [redacted] now"
    );
  });

  it("redacts a service-role JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.s1gn4tur3v4lu3";
    expect(redactSecrets(`key=${jwt}`)).not.toContain("eyJ");
  });

  it("redacts the password out of a connection string", () => {
    expect(redactSecrets("postgresql://postgres:hunter2@db.abc.supabase.co:5432/postgres")).toBe(
      "postgresql://postgres:[redacted]@db.abc.supabase.co:5432/postgres"
    );
  });

  it("redacts password= and token= pairs whatever the value looks like", () => {
    expect(redactSecrets("PGPASSWORD=correct-horse")).toBe("PGPASSWORD=[redacted]");
    expect(redactSecrets("access_token: abc123def")).toBe("access_token: [redacted]");
  });

  it("leaves ordinary output alone", () => {
    const clean = "migrations: OK (26 in the repo, 26 recorded live)";
    expect(redactSecrets(clean)).toBe(clean);
  });

  // The report is the only thing this script prints on the happy path, so the
  // redaction has to be applied there, not just available.
  it("runs the whole report through redaction", () => {
    const report = formatReport([
      {
        title: "storage policies",
        summary: "1 declared",
        items: [{ headline: "token=sbp_0123456789abcdef0123456789abcdef01234567" }],
      },
    ]);
    expect(report).not.toContain("sbp_");
    expect(report).toContain("[redacted]");
  });
});

describe("expressions normalise across the postgres round trip", () => {
  // This is the whole trick. If these three fail, the check is a name check
  // wearing a disguise.
  it("matches the read policy through added parens, added casts and the dropped public. qualifier", () => {
    expect(canonicalizeExpression(LIVE_READ_QUAL)).toBe(declared("receipt_images_select_owner_or_participant").using);
  });

  it("matches the write policy, including the array subscript and the ::text cast", () => {
    expect(canonicalizeExpression(LIVE_OWNER_EXPR)).toBe(declared("receipt_images_insert_own").withCheck);
  });

  it("matches the delete policy", () => {
    expect(canonicalizeExpression(LIVE_OWNER_EXPR)).toBe(declared("receipt_images_delete_own").using);
  });

  it("ignores a harmless reordering of AND/OR operands", () => {
    expect(canonicalizeExpression("a = 1 and b = 2")).toBe(canonicalizeExpression("b = 2 and a = 1"));
    expect(canonicalizeExpression("x = 'q' or y = 'r'")).toBe(canonicalizeExpression("y = 'r' or x = 'q'"));
  });

  it("ignores which side of an equality each operand sits on", () => {
    expect(canonicalizeExpression("auth.uid() = created_by")).toBe(
      canonicalizeExpression("created_by = auth.uid()")
    );
  });

  // The other half: things that MUST still differ. A normaliser that collapses
  // everything passes every test above and detects nothing.
  it("does not collapse a different bucket name", () => {
    expect(canonicalizeExpression("bucket_id = 'receipt-images'")).not.toBe(
      canonicalizeExpression("bucket_id = 'avatars'")
    );
  });

  it("does not collapse a dropped clause", () => {
    const full = canonicalizeExpression(LIVE_READ_QUAL);
    const participantBranchRemoved = canonicalizeExpression(
      "((bucket_id = 'receipt-images'::text) AND (receipt_creator_id(receipt_image_receipt_id(name)) = auth.uid()))"
    );
    expect(full).not.toBe(participantBranchRemoved);
  });

  it("does not collapse a function from another schema onto the public one", () => {
    expect(canonicalizeExpression("public.is_receipt_participant(x)")).toBe(
      canonicalizeExpression("is_receipt_participant(x)")
    );
    expect(canonicalizeExpression("evil.is_receipt_participant(x)")).not.toBe(
      canonicalizeExpression("is_receipt_participant(x)")
    );
  });

  it("does not collapse a regrouped boolean", () => {
    expect(canonicalizeExpression("(a or b) and c")).not.toBe(canonicalizeExpression("a or (b and c)"));
  });

  it("treats an absent expression as absent, not as empty", () => {
    expect(canonicalizeExpression(null)).toBeNull();
    expect(canonicalizeExpression("   ")).toBeNull();
  });

  // A parse failure must never look like a match. It throws, and the caller
  // turns that into exit 2.
  it("throws rather than guessing at an expression it cannot parse", () => {
    expect(() => canonicalizeExpression("bucket_id = ")).toThrow();
    expect(() => canonicalizeExpression("bucket_id = 'x' and")).toThrow();
  });
});

describe("supabase/storage-policies.sql parses into what it says it declares", () => {
  it("declares exactly the three storage.objects policies", () => {
    expect(declaredPolicies.map((p) => p.name).sort()).toEqual([
      "receipt_images_delete_own",
      "receipt_images_insert_own",
      "receipt_images_select_owner_or_participant",
    ]);
  });

  it("reads the command and the roles off each one", () => {
    expect(declared("receipt_images_select_owner_or_participant").command).toBe("SELECT");
    expect(declared("receipt_images_insert_own").command).toBe("INSERT");
    expect(declared("receipt_images_delete_own").command).toBe("DELETE");
    for (const policy of declaredPolicies) expect(policy.roles).toEqual(["authenticated"]);
  });

  it("keeps USING and WITH CHECK apart", () => {
    const insert = declared("receipt_images_insert_own");
    expect(insert.using).toBeNull();
    expect(insert.withCheck).not.toBeNull();

    const read = declared("receipt_images_select_owner_or_participant");
    expect(read.using).not.toBeNull();
    expect(read.withCheck).toBeNull();
  });
});

describe("policies are matched by expression, never by name", () => {
  it("passes a correct apply even though every live name carries a dashboard suffix", () => {
    const live = normalizeLivePolicies(LIVE_ROWS_CORRECT);
    // Not one live name equals a declared name — a name-based check would fail
    // all three here.
    for (const policy of live) {
      expect(declaredPolicies.map((d) => d.name)).not.toContain(policy.name);
    }
    expect(diffPolicies(declaredPolicies, live)).toEqual([]);
  });

  // The `_1` case from OT-143: ticking SELECT alongside DELETE in the UI makes
  // the dashboard create a second, separate policy. Nothing is misnamed and
  // every declared policy is present — only the count is wrong.
  it("reports the extra SELECT row the dashboard splits off a two-operation tick", () => {
    const drift = diffPolicies(declaredPolicies, normalizeLivePolicies(LIVE_ROWS_AS_OBSERVED));

    expect(drift).toHaveLength(1);
    expect(drift[0].headline).toContain("receipt_images_delete_own 13hfyy5_1");
    expect(drift[0].headline).toContain("not declared");
  });

  it("reports a declared policy that is missing live", () => {
    const live = normalizeLivePolicies(
      LIVE_ROWS_CORRECT.filter((row) => row.cmd !== "INSERT")
    );
    const drift = diffPolicies(declaredPolicies, live);

    expect(drift).toHaveLength(1);
    expect(drift[0].headline).toContain("receipt_images_insert_own");
  });

  it("reports a policy whose expression was edited live", () => {
    const weakened = LIVE_ROWS_CORRECT.map((row) =>
      row.cmd === "SELECT"
        ? { ...row, qual: "(bucket_id = 'receipt-images'::text)" }
        : row
    );
    const drift = diffPolicies(declaredPolicies, normalizeLivePolicies(weakened));

    expect(drift).toHaveLength(2);
    expect(drift.some((d) => d.headline.includes("no live policy matches"))).toBe(true);
    expect(drift.some((d) => d.headline.includes("not declared"))).toBe(true);
  });

  // The anonymous-read control in storage-policies.sql is an absence: no policy
  // admits `anon`. A role widened in the dashboard changes no expression at all.
  it("reports a role widened to anon even though the expression is untouched", () => {
    const widened = LIVE_ROWS_CORRECT.map((row) =>
      row.cmd === "SELECT" ? { ...row, roles: "{anon,authenticated}" } : row
    );
    const drift = diffPolicies(declaredPolicies, normalizeLivePolicies(widened));
    expect(drift.length).toBeGreaterThan(0);
  });

  it("reports an UPDATE policy nobody declared", () => {
    const withUpdate = [
      ...LIVE_ROWS_CORRECT,
      liveRow("receipt_images_update 13hfyy5_0", "UPDATE", LIVE_OWNER_EXPR, LIVE_OWNER_EXPR),
    ];
    const drift = diffPolicies(declaredPolicies, normalizeLivePolicies(withUpdate));

    expect(drift).toHaveLength(1);
    expect(drift[0].headline).toContain("receipt_images_update");
  });

  it("reads postgres role arrays in either shape", () => {
    expect(parsePgTextArray("{authenticated}")).toEqual(["authenticated"]);
    expect(parsePgTextArray("{anon,authenticated}")).toEqual(["anon", "authenticated"]);
    expect(parsePgTextArray(["authenticated"])).toEqual(["authenticated"]);
    expect(parsePgTextArray('{"weird role",anon}')).toEqual(["anon", "weird role"]);
  });
});

describe("migrations are compared in both directions", () => {
  it("takes the version off a filename", () => {
    expect(migrationVersion("0026_receipt_image_storage_lockdown.sql")).toBe("0026");
    expect(migrationVersion("20260820120000_thing.sql")).toBe("20260820120000");
    expect(repoMigrationVersions(["0002_b.sql", "0001_a.sql", "README.md"])).toEqual(["0001", "0002"]);
  });

  it("finds nothing when they agree", () => {
    expect(diffMigrations(["0001", "0002"], ["0001", "0002"])).toEqual([]);
  });

  it("reports a repo migration that was never applied", () => {
    const drift = diffMigrations(["0001", "0002"], ["0001"]);
    expect(drift).toHaveLength(1);
    expect(drift[0].headline).toContain("not applied");
    expect(drift[0].detail?.join(" ")).toContain("0002");
  });

  it("reports a recorded migration with no file in the repo", () => {
    const drift = diffMigrations(["0001"], ["0001", "0099"]);
    expect(drift).toHaveLength(1);
    expect(drift[0].headline).toContain("no file in the repo");
    expect(drift[0].detail?.join(" ")).toContain("0099");
  });

  it("reports both directions at once", () => {
    expect(diffMigrations(["0001", "0002"], ["0001", "0099"])).toHaveLength(2);
  });

  // The OT-142 shape: schema_migrations existed and was completely empty while
  // the repo held 26 files. Every one of them is drift.
  it("reports every migration when the live history is empty", () => {
    const repo = Array.from({ length: 26 }, (_, i) => String(i + 1).padStart(4, "0"));
    const drift = diffMigrations(repo, []);
    expect(drift).toHaveLength(1);
    expect(drift[0].headline).toContain("26 migration(s)");
  });
});

describe("the bucket privacy toggle", () => {
  it("reads the declared bucket out of storage-policies.sql", () => {
    expect(parseDeclaredBuckets(POLICIES_SQL)).toEqual([{ id: "receipt-images", isPublic: false }]);
  });

  it("finds nothing when the live bucket is private", () => {
    const live = normalizeLiveBuckets([{ id: "receipt-images", public: false }]);
    expect(diffBuckets(parseDeclaredBuckets(POLICIES_SQL), live)).toEqual([]);
  });

  it("reports a bucket flipped back to public", () => {
    const live = normalizeLiveBuckets([{ id: "receipt-images", public: true }]);
    const drift = diffBuckets(parseDeclaredBuckets(POLICIES_SQL), live);
    expect(drift).toHaveLength(1);
    expect(drift[0].headline).toContain("public=true");
  });

  it("reports a declared bucket that does not exist live", () => {
    const drift = diffBuckets(parseDeclaredBuckets(POLICIES_SQL), []);
    expect(drift).toHaveLength(1);
    expect(drift[0].headline).toContain("does not exist live");
  });

  it("says nothing about a live bucket the repo does not declare", () => {
    const live = normalizeLiveBuckets([
      { id: "receipt-images", public: false },
      { id: "avatars", public: true },
    ]);
    expect(diffBuckets(parseDeclaredBuckets(POLICIES_SQL), live)).toEqual([]);
  });
});

describe("reading the supabase CLI's answer", () => {
  it("takes a bare array of rows", () => {
    expect(extractQueryRows('[{"version":"0001"}]')).toEqual({ ok: true, rows: [{ version: "0001" }] });
  });

  it("takes an envelope that wraps the rows", () => {
    expect(extractQueryRows('{"_tag":"Success","result":[{"version":"0001"}]}')).toEqual({
      ok: true,
      rows: [{ version: "0001" }],
    });
  });

  it("takes NDJSON, one row per line", () => {
    expect(extractQueryRows('{"version":"0001"}\n{"version":"0002"}')).toEqual({
      ok: true,
      rows: [{ version: "0001" }, { version: "0002" }],
    });
  });

  it("ignores the CLI's plain progress lines", () => {
    expect(extractQueryRows('Connecting to remote database...\n[{"version":"0001"}]')).toEqual({
      ok: true,
      rows: [{ version: "0001" }],
    });
  });

  it("takes an empty result set as an empty result set", () => {
    expect(extractQueryRows("[]")).toEqual({ ok: true, rows: [] });
  });

  // The OT-145 constraint that matters most: a check that cannot see the
  // database must never look like a check that saw no drift.
  it("fails on the not-linked envelope instead of returning no rows", () => {
    const result = extractQueryRows(
      '{"_tag":"Error","error":{"code":"LegacyProjectNotLinkedError","message":"Cannot find project ref. Have you run supabase link?"}}'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("LegacyProjectNotLinkedError");
      expect(result.reason).toContain("supabase link");
    }
  });

  it("prefers the error envelope even when other JSON is present", () => {
    const result = extractQueryRows(
      'Connecting...\n[]\n{"_tag":"Error","error":{"code":"Boom","message":"query failed"}}'
    );
    expect(result.ok).toBe(false);
  });

  it("fails rather than passing when it cannot find a result set at all", () => {
    const result = extractQueryRows("Connecting to remote database...\nsomething went sideways");
    expect(result.ok).toBe(false);
  });
});

describe("the report distinguishes the three outcomes", () => {
  it("says NO DRIFT only when every section is empty", () => {
    const report = formatReport([{ title: "migrations", summary: "26 vs 26", items: [] }]);
    expect(report).toContain("migrations: OK");
    expect(report).toContain("RESULT: NO DRIFT");
  });

  it("counts every problem when there is drift", () => {
    const report = formatReport([
      { title: "migrations", summary: "26 vs 12", items: [{ headline: "a", detail: ["why"] }] },
      { title: "storage policies", summary: "3 vs 4", items: [{ headline: "b" }] },
    ]);
    expect(report).toContain("migrations: DRIFT");
    expect(report).toContain("RESULT: DRIFT FOUND — 2 problem(s)");
    expect(report).toContain("why");
  });
});

// ---------------------------------------------------------------------------
// end to end, against a stub CLI
// ---------------------------------------------------------------------------
//
// Everything above tests functions. These tests run the actual script as a
// subprocess with SUPABASE_BIN pointed at a stub that answers each query from a
// fixture, which is the only way to pin the exit CODES — and the exit codes are
// the contract: 0 no drift, 1 drift, 2 could not check. A check that returned 0
// when it could not reach the database would be worse than no check, so that
// case is asserted rather than assumed.
//
// The stub is a real database's answers, not a real database. It proves the
// wiring, not the schema.

const SCRIPT = path.join(ROOT, "scripts", "check-schema-drift.ts");
const REPO_MIGRATION_VERSIONS = repoMigrationVersions(readdirSync(path.join(ROOT, "supabase", "migrations")));

type Fixture = [needle: string, payload: unknown];

function stubCli(fixtures: Fixture[]): { bin: string; env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(path.join(tmpdir(), "drift-stub-"));
  const fixturesPath = path.join(dir, "fixtures.json");
  writeFileSync(fixturesPath, JSON.stringify(fixtures));

  const impl = path.join(dir, "stub.cjs");
  writeFileSync(
    impl,
    [
      'const fs = require("fs");',
      "const fixtures = JSON.parse(fs.readFileSync(process.env.DRIFT_STUB_FIXTURES, 'utf8'));",
      'const sql = process.argv.slice(2).join(" ");',
      "for (const [needle, payload] of fixtures) {",
      "  if (sql.includes(needle)) {",
      '    process.stdout.write("Connecting to remote database...\\n" + JSON.stringify(payload) + "\\n");',
      "    process.exit(0);",
      "  }",
      "}",
      'process.stdout.write(JSON.stringify({ _tag: "Error", error: { code: "NoFixture", message: "no stub answer for that query" } }) + "\\n");',
      "process.exit(1);",
      "",
    ].join("\n")
  );

  const bin = path.join(dir, "supabase-stub");
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${impl}" "$@"\n`);
  chmodSync(bin, 0o755);

  return { bin, env: { ...process.env, SUPABASE_BIN: bin, DRIFT_STUB_FIXTURES: fixturesPath } };
}

function runScript(env: NodeJS.ProcessEnv, args: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env,
    cwd: ROOT,
    timeout: 60_000,
  });
}

function fixturesFor(migrations: string[], policyRows: Record<string, unknown>[], bucketPublic = false): Fixture[] {
  return [
    ["to_regclass", [{ tracked: true }]],
    ["schema_migrations", migrations.map((version) => ({ version }))],
    ["pg_policies", policyRows],
    ["storage.buckets", [{ id: "receipt-images", public: bucketPublic }]],
  ];
}

describe("the script's exit codes", () => {
  it("exits 0 and says NO DRIFT when the stub agrees with the repo", () => {
    const { env } = stubCli(fixturesFor(REPO_MIGRATION_VERSIONS, LIVE_ROWS_CORRECT));
    const run = runScript(env);

    expect(run.stdout).toContain("RESULT: NO DRIFT");
    expect(run.status).toBe(0);
  });

  it("exits 1 and names the drift when a migration is missing and a policy is extra", () => {
    const { env } = stubCli(
      fixturesFor(REPO_MIGRATION_VERSIONS.slice(0, -1), LIVE_ROWS_AS_OBSERVED)
    );
    const run = runScript(env);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("RESULT: DRIFT FOUND");
    expect(run.stdout).toContain("not applied to the live database");
    expect(run.stdout).toContain("receipt_images_delete_own 13hfyy5_1");
  });

  it("exits 1 when the receipt-images bucket is public live", () => {
    const { env } = stubCli(fixturesFor(REPO_MIGRATION_VERSIONS, LIVE_ROWS_CORRECT, true));
    const run = runScript(env);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("public=true");
  });

  it("exits 1 when the live database has no migration history table at all", () => {
    const { env } = stubCli([
      ["to_regclass", [{ tracked: false }]],
      ["pg_policies", LIVE_ROWS_CORRECT],
      ["storage.buckets", [{ id: "receipt-images", public: false }]],
    ]);
    const run = runScript(env);

    // Not exit 2 — this one IS drift, and the loudest kind: the OT-142 shape,
    // where nothing was ever tracked at all.
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("no supabase_migrations.schema_migrations table");
  });

  it("exits 2 when the CLI is not installed", () => {
    const run = runScript({ ...process.env, SUPABASE_BIN: "/nonexistent/supabase" });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("COULD NOT CHECK");
    expect(run.stderr).toContain("NOT a clean bill of health");
  });

  it("exits 2 when the project is not linked", () => {
    const { env } = stubCli([
      [
        "select",
        {
          _tag: "Error",
          error: {
            code: "LegacyProjectNotLinkedError",
            message: "Cannot find project ref. Have you run supabase link?",
          },
        },
      ],
    ]);
    const run = runScript(env);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("COULD NOT CHECK");
    expect(run.stderr).toContain("supabase link");
    expect(run.stdout).not.toContain("NO DRIFT");
  });

  it("exits 2 when a query fails", () => {
    const { env } = stubCli([
      ["to_regclass", [{ tracked: true }]],
      // Nothing answers the other three, so the stub errors on them.
    ]);
    const run = runScript(env);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("COULD NOT CHECK");
  });

  it("exits 0 for --help without going near a database", () => {
    const run = runScript({ ...process.env, SUPABASE_BIN: "/nonexistent/supabase" }, ["--help"]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("usage:");
  });
});
