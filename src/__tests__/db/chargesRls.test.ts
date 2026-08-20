import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Migration 0019 gives `charges` the `with check` it never had. There is no
// database in this suite, so these tests read the SQL and assert the shape of
// the policy and of what the writers put through it. That is weaker than an
// INSERT against a live server — it cannot catch a Postgres-level surprise —
// but it does catch the two ways this fix gets undone by a later edit: the
// ownership predicate disappearing from the check, and the read path being
// narrowed along with the write path.

const migrations = path.join(process.cwd(), "supabase", "migrations");

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

// Split on semicolons that are not inside parentheses. Only used on files with
// no dollar-quoted function body.
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

// The text between the parens that follow `using` / `with check`, matched by
// balancing rather than by regex so a nested call does not end it early.
function clause(statement: string, keyword: "using" | "with check"): string | null {
  const at = statement.indexOf(`${keyword} (`);
  if (at < 0) return null;
  const start = statement.indexOf("(", at);
  let depth = 0;
  for (let i = start; i < statement.length; i += 1) {
    if (statement[i] === "(") depth += 1;
    if (statement[i] === ")") {
      depth -= 1;
      if (depth === 0) return statement.slice(start + 1, i).replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

function creatorPolicy(file: string): string {
  const found = statements(read(file)).find(
    (s) => s.startsWith("create policy") && s.includes('"charges_all_creator"')
  );
  if (!found) throw new Error(`no charges_all_creator policy in ${file}`);
  return found;
}

const shipped = creatorPolicy("0008_rls_policies.sql");
const fixed = creatorPolicy("0019_charges_with_check.sql");

// `create or replace` means a function is whatever the last migration to define
// it says, and save_receipt_state has been redefined four times since 0016
// (0021, 0022, 0023, 0024). Naming a file here would leave this checking a
// definition no database runs, which is what it was doing until 0024. The
// newest definition is found instead, so the next migration to touch the
// function is checked the day it lands rather than the day someone notices.
function newestDefining(fn: string): string {
  const found = readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => flatten(read(f)).includes(`create or replace function public.${fn}(`))
    .pop();
  if (!found) throw new Error(`no migration defines ${fn}`);
  return found;
}

describe("charges insert policy", () => {
  // The defect: 0008 supplied no `with check`, so Postgres reused the `using`
  // expression as the INSERT check. That predicate only asserts the row
  // carries the caller's own id — it says nothing about which receipt it lands
  // on, so a signed-in user could plant a charge on anyone's tab.
  it("was missing before 0019", () => {
    expect(clause(shipped, "with check")).toBeNull();
    expect(clause(shipped, "using")).toBe("auth.uid() = from_user_id");
  });

  it("requires the row's receipt to be one the caller owns", () => {
    const check = clause(fixed, "with check");

    expect(check).not.toBeNull();
    // The same question 0016 asks before it writes anything, through the
    // security definer helper 0009 added so the lookup does not re-enter
    // `receipts`' own policies.
    expect(check).toContain("public.receipt_creator_id(receipt_id) = auth.uid()");
  });

  // Dropping this half would let a receipt's owner file a charge under someone
  // else's id — accepted by 0008, and it should stay rejected.
  it("still requires the row to carry the caller's own id", () => {
    expect(clause(fixed, "with check")).toContain("auth.uid() = from_user_id");
  });

  it("narrows nothing that was already allowed", () => {
    const check = clause(fixed, "with check")!;

    // The check is the old predicate AND one more condition, so every row the
    // old check accepted for its own receipt is still accepted.
    expect(check.replace(/\s+/g, " ")).toBe(
      "auth.uid() = from_user_id and public.receipt_creator_id(receipt_id) = auth.uid()"
    );
  });
});

describe("charges read path", () => {
  // The policy is `for all`, so its `using` clause governs SELECT as well.
  // Tightening the insert check must not touch it.
  it("keeps the using clause 0008 shipped, character for character", () => {
    expect(clause(fixed, "using")).toBe(clause(shipped, "using"));
  });

  it("leaves the participant read policy alone", () => {
    expect(flatten(read("0019_charges_with_check.sql"))).not.toContain(
      "charges_select_participant"
    );
  });
});

describe("0019 is additive", () => {
  const sql = flatten(read("0019_charges_with_check.sql"));

  it("touches no data and no table structure", () => {
    for (const forbidden of [
      "delete from",
      "update ",
      "insert into",
      "truncate",
      "alter table",
      "drop table",
      "drop column",
      "drop function",
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it("changes exactly one policy", () => {
    const changed = statements(read("0019_charges_with_check.sql"));

    expect(changed).toHaveLength(2);
    expect(changed[0]).toBe(
      'drop policy if exists "charges_all_creator" on public.charges'
    );
    expect(changed[1].startsWith('create policy "charges_all_creator"')).toBe(true);
  });
});

// Writer 1 of 2. The RPC is `security definer`, so it runs as the function's
// owner — which owns `charges` — and RLS is not applied inside it at all; its
// own `v_owner` check is the gate, and the new policy copies that predicate.
// What matters here is that the rows it writes would be accepted anyway, so
// the RPC keeps working whichever way it is invoked.
describe("save_receipt_state still writes rows the policy accepts", () => {
  const rpc = flatten(read("0016_participant_unique_and_save_rpc.sql"));
  // The definition a deployed database actually runs, which is the one whose
  // charges insert has to keep satisfying 0019's policy.
  const live = flatten(read(newestDefining("save_receipt_state")));

  it("refuses a caller who does not own the receipt", () => {
    expect(rpc).toContain("select created_by into v_owner from receipts where id = p_receipt_id");
    expect(rpc).toContain("if v_owner is null or v_owner <> auth.uid() then");
  });

  it("stamps the receipt it was given and the owner it looked up", () => {
    expect(live).toMatch(
      /insert into charges \(receipt_id, from_user_id, to_participant_id, amount, venmo_link, paid_at\) select p_receipt_id, v_owner,/
    );
  });

  it("runs as definer, so the policy is a floor under it rather than its gate", () => {
    expect(rpc).toContain("language plpgsql security definer");
  });
});
