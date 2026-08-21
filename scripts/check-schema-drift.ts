/**
 * Schema drift check — does the live Supabase project still match this repo?
 *
 * WHY THIS EXISTS
 *
 * Every gate in this repo runs inside a worktree with no database. So the one
 * thing they can never see is the live database, and that is exactly where the
 * expensive failure lived: OT-142 found production running ~14 migrations
 * behind the repo with `supabase_migrations.schema_migrations` completely
 * empty. Merged, reviewed, green code had been reading columns that did not
 * exist. Nothing noticed until a migration happened to fail.
 *
 * This script is the check that would have caught it. It is deliberately NOT a
 * gate (see `.claude/GATES.md` — a required gate that needs a network and a
 * logged-in CLI would fail every task). It is a deploy-time and on-demand
 * check, run by a human or a deploy step against a linked project.
 *
 * WHAT IT COMPARES
 *
 *   1. migrations — every file in `supabase/migrations/` is recorded in
 *      `supabase_migrations.schema_migrations`, and nothing is recorded there
 *      that the repo does not have. Both directions.
 *   2. storage policies — the policies on `storage.objects` match the ones
 *      declared in `supabase/storage-policies.sql`.
 *   3. storage buckets — the `public` flag on each bucket the repo declares.
 *      That flag is a toggle in the dashboard UI, which makes it the single
 *      most drift-prone thing in the storage half.
 *
 * WHY IT COMPARES EXPRESSIONS AND NOT NAMES
 *
 * The storage policies cannot be applied by any automated SQL path on a hosted
 * project (`storage.objects` is owned by `supabase_storage_admin`), so they are
 * clicked into the dashboard by hand — see docs/deployment.md. The dashboard
 * does two things that defeat a name-based check:
 *
 *   * it appends its own suffix to whatever name you type, so a live name
 *     NEVER equals the declared one:
 *
 *         receipt_images_delete_own 13hfyy5_0   | {authenticated} | DELETE
 *         receipt_images_insert_own 13hfyy5_0   | {authenticated} | INSERT
 *
 *   * if more than one operation is ticked in the UI it silently splits one
 *     declared policy into two live rows, which is where a `_1` row comes
 *     from. Nobody named anything wrongly; the COUNT is wrong:
 *
 *         receipt_images_delete_own 13hfyy5_1   | {authenticated} | SELECT
 *
 * So policy names are ignored entirely for matching. A policy's identity here
 * is (command, roles, permissive/restrictive, normalised USING, normalised
 * WITH CHECK). Names are used only to make the report readable.
 *
 * Normalising the expressions is the work. Postgres does not hand back the text
 * that was typed — it hands back its own deparse of the parsed tree, which adds
 * parentheses, adds casts, and drops schema qualifiers that are on the search
 * path:
 *
 *     declared:  bucket_id = 'receipt-images' and public.f(name) = auth.uid()
 *     live:      ((bucket_id = 'receipt-images'::text) AND (f(name) = auth.uid()))
 *
 * Comparing those as strings is hopeless, so both sides are parsed into a small
 * expression tree and rendered to one canonical form. The canonicalisation
 * deliberately ignores: redundant parentheses, casts, a leading `public.`
 * qualifier, keyword case, whitespace, and the ORDER of the operands of AND and
 * OR (all commutative, and a harmless reorder in the dashboard should not read
 * as drift). Everything else — a missing clause, a different function, a
 * different bucket name, a different command, a different role — is drift.
 *
 * EXIT CODES. The distinction matters more than the check:
 *
 *     0  checked, and the live database matches the repo
 *     1  checked, and it does not — drift is listed on stdout
 *     2  COULD NOT CHECK — no credentials, project not linked, query failed,
 *        expression could not be parsed. Never confuse this with 0.
 *
 * SECRETS. Nothing here reads, prints, or writes a credential. The Supabase
 * CLI holds the access token and is the only thing that ever sees it; this
 * script shells out to `supabase db query --linked` and never touches
 * `.env*`, `~/.supabase`, or a connection string. Every byte that comes back
 * from the CLI is passed through `redactSecrets` before it can reach stdout,
 * as a belt-and-braces guard against a future CLI version echoing something it
 * should not.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

const MIGRATIONS_DIR = "supabase/migrations";
const POLICIES_FILE = "supabase/storage-policies.sql";
const POLICY_SCHEMA = "storage";
const POLICY_TABLE = "objects";

/** Thrown for anything that means "the check did not run" — always exit 2. */
export class CouldNotCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CouldNotCheckError";
  }
}

// ---------------------------------------------------------------------------
// redaction
// ---------------------------------------------------------------------------
//
// Applied to everything this script prints that did not come from its own
// source. Over-redaction is fine; under-redaction is the failure that matters.

const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Supabase keys: sbp_… (personal access token), sb_secret_…, sb_publishable_…
  [/\bsb[a-z]*_[A-Za-z0-9_-]{12,}/g, "[redacted]"],
  // JWTs — legacy anon/service_role keys and storage signing tokens
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, "[redacted]"],
  // credentials embedded in a connection string: scheme://user:pass@host
  [/([a-z][a-z0-9+.-]*:\/\/[^:/?#\s]+):[^@\s]+@/gi, "$1:[redacted]@"],
  // key=value / key: value where the key names a secret
  [
    /((?:password|pgpassword|api[_-]?key|apikey|secret|token|authorization)\s*[=:]\s*)"?[^\s"'&,;]+/gi,
    "$1[redacted]",
  ],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// ---------------------------------------------------------------------------
// SQL tokenizer
// ---------------------------------------------------------------------------

type TokenKind = "word" | "qident" | "str" | "num" | "op" | "punc";

export interface Token {
  t: TokenKind;
  v: string;
}

const MULTI_CHAR_OPS = ["::", "<>", "!=", "<=", ">=", "||", "->>", "->", "@>", "<@", "!~~", "!~", "~~", "~"];
const SINGLE_CHAR_OPS = ["=", "<", ">", "+", "-", "*", "/", "%"];
const PUNCTUATION = ["(", ")", "[", "]", ",", ".", ";", ":"];

/** Type words that may legally follow another type word in a cast. */
const TYPE_CONTINUATIONS = new Set([
  "varying",
  "precision",
  "zone",
  "with",
  "without",
  "time",
  "double",
  "character",
]);

export function tokenizeSql(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    // -- line comment
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }

    // /* block comment */ — postgres nests these, so count depth
    if (ch === "/" && sql[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      continue;
    }

    // 'string literal', with '' as the escape
    if (ch === "'") {
      let value = "";
      i += 1;
      for (;;) {
        if (i >= sql.length) throw new CouldNotCheckError("unterminated string literal in SQL");
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += sql[i];
        i += 1;
      }
      out.push({ t: "str", v: value });
      continue;
    }

    // $tag$ dollar quoting $tag$
    if (ch === "$") {
      const open = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
      if (open) {
        const tag = open[0];
        const end = sql.indexOf(tag, i + tag.length);
        if (end === -1) throw new CouldNotCheckError("unterminated dollar-quoted string in SQL");
        out.push({ t: "str", v: sql.slice(i + tag.length, end) });
        i = end + tag.length;
        continue;
      }
    }

    // "quoted identifier", with "" as the escape. Case is significant.
    if (ch === '"') {
      let value = "";
      i += 1;
      for (;;) {
        if (i >= sql.length) throw new CouldNotCheckError("unterminated quoted identifier in SQL");
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += sql[i];
        i += 1;
      }
      out.push({ t: "qident", v: value });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const match = /^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(sql.slice(i))!;
      out.push({ t: "num", v: match[0] });
      i += match[0].length;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(sql.slice(i))!;
      out.push({ t: "word", v: match[0].toLowerCase() });
      i += match[0].length;
      continue;
    }

    const multi = MULTI_CHAR_OPS.find((op) => sql.startsWith(op, i));
    if (multi) {
      out.push({ t: "op", v: multi });
      i += multi.length;
      continue;
    }

    if (SINGLE_CHAR_OPS.includes(ch)) {
      out.push({ t: "op", v: ch });
      i += 1;
      continue;
    }

    if (PUNCTUATION.includes(ch)) {
      out.push({ t: "punc", v: ch });
      i += 1;
      continue;
    }

    throw new CouldNotCheckError(`unexpected character ${JSON.stringify(ch)} in SQL`);
  }

  return out;
}

// ---------------------------------------------------------------------------
// expression AST
// ---------------------------------------------------------------------------

export type ExprNode =
  | { k: "str"; v: string }
  | { k: "num"; v: string }
  | { k: "ref"; v: string }
  | { k: "call"; name: string; args: ExprNode[] }
  | { k: "op"; op: string; args: ExprNode[] }
  | { k: "not"; arg: ExprNode }
  | { k: "neg"; arg: ExprNode }
  | { k: "sub"; target: ExprNode; index: ExprNode[] }
  | { k: "is"; arg: ExprNode; test: string; negated: boolean }
  | { k: "in"; arg: ExprNode; list: ExprNode[]; negated: boolean }
  | { k: "array"; items: ExprNode[] };

// Binding power, loosest first. NOT sits between AND and comparison, as in SQL.
// `->` / `->>` (the JSON operators) sit ABOVE comparison, matching postgres'
// real "any other operator" precedence tier — they bind tighter than `=`, so
// `a = b ->> 'c'` parses as `a = (b ->> 'c')`, not `(a = b) ->> 'c'`. Getting
// this wrong reads as a false DRIFT once a JSON-column policy exists (postgres
// deparses with the parens this parser would otherwise have gotten wrong), so
// the failure mode of a bug here is noisy, not a false all-clear — but it is
// still wrong, and worth having right before it matters.
const PREC_OR = 1;
const PREC_AND = 2;
const PREC_NOT = 3;
const PREC_CMP = 4;
const PREC_JSON = 5;
const PREC_CONCAT = 6;
const PREC_ADD = 7;
const PREC_MUL = 8;

const COMPARISON_OPS = new Set(["=", "<>", "!=", "<", ">", "<=", ">=", "~", "!~", "~~", "!~~", "@>", "<@"]);
const JSON_OPS = new Set(["->", "->>"]);

/** `a = b` means the same as `b = a`; render both to one canonical order. */
const COMMUTATIVE_OPS = new Set(["=", "<>"]);

class ExpressionParser {
  private readonly tokens: Token[];
  private pos: number;

  constructor(tokens: Token[], pos = 0) {
    this.tokens = tokens;
    this.pos = pos;
  }

  get position(): number {
    return this.pos;
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private next(): Token {
    const token = this.tokens[this.pos];
    if (!token) throw new CouldNotCheckError("unexpected end of expression");
    this.pos += 1;
    return token;
  }

  private at(t: TokenKind, v: string): boolean {
    const token = this.peek();
    return token !== undefined && token.t === t && token.v === v;
  }

  private expect(t: TokenKind, v: string): void {
    if (!this.at(t, v)) {
      const found = this.peek();
      throw new CouldNotCheckError(
        `expected ${JSON.stringify(v)} in expression but found ${found ? JSON.stringify(found.v) : "end of input"}`
      );
    }
    this.pos += 1;
  }

  parse(minPrec = 0): ExprNode {
    let left = this.parseUnary();

    for (;;) {
      const token = this.peek();
      if (!token) break;

      if (token.t === "word" && (token.v === "and" || token.v === "or")) {
        const prec = token.v === "and" ? PREC_AND : PREC_OR;
        if (prec < minPrec) break;
        this.pos += 1;
        const right = this.parse(prec + 1);
        left = { k: "op", op: token.v, args: [left, right] };
        continue;
      }

      if (token.t === "word" && token.v === "is") {
        if (PREC_CMP < minPrec) break;
        this.pos += 1;
        left = this.parseIsTail(left);
        continue;
      }

      if (token.t === "word" && (token.v === "in" || token.v === "like" || token.v === "ilike")) {
        if (PREC_CMP < minPrec) break;
        this.pos += 1;
        left = token.v === "in" ? this.parseInTail(left, false) : this.parseLikeTail(left, token.v, false);
        continue;
      }

      // `not in (...)` / `not like ...`
      if (token.t === "word" && token.v === "not") {
        const after = this.peek(1);
        if (after && after.t === "word" && (after.v === "in" || after.v === "like" || after.v === "ilike")) {
          if (PREC_CMP < minPrec) break;
          this.pos += 2;
          left = after.v === "in" ? this.parseInTail(left, true) : this.parseLikeTail(left, after.v, true);
          continue;
        }
        break;
      }

      if (token.t === "op") {
        const prec = binaryPrecedence(token.v);
        if (prec === null || prec < minPrec) break;
        this.pos += 1;
        const right = this.parse(prec + 1);
        left = { k: "op", op: token.v === "!=" ? "<>" : token.v, args: [left, right] };
        continue;
      }

      break;
    }

    return left;
  }

  private parseIsTail(left: ExprNode): ExprNode {
    let negated = false;
    if (this.at("word", "not")) {
      negated = true;
      this.pos += 1;
    }
    if (this.at("word", "distinct")) {
      this.pos += 1;
      this.expect("word", "from");
      const right = this.parse(PREC_CMP + 1);
      return { k: "op", op: negated ? "is-not-distinct-from" : "is-distinct-from", args: [left, right] };
    }
    const test = this.next();
    if (test.t !== "word") throw new CouldNotCheckError("expected null/true/false after IS");
    return { k: "is", arg: left, test: test.v, negated };
  }

  private parseInTail(left: ExprNode, negated: boolean): ExprNode {
    this.expect("punc", "(");
    const list: ExprNode[] = [];
    if (!this.at("punc", ")")) {
      for (;;) {
        list.push(this.parse(0));
        if (this.at("punc", ",")) {
          this.pos += 1;
          continue;
        }
        break;
      }
    }
    this.expect("punc", ")");
    return { k: "in", arg: left, list, negated };
  }

  private parseLikeTail(left: ExprNode, op: string, negated: boolean): ExprNode {
    const right = this.parse(PREC_CMP + 1);
    return { k: "op", op: negated ? `not-${op}` : op, args: [left, right] };
  }

  private parseUnary(): ExprNode {
    if (this.at("word", "not")) {
      this.pos += 1;
      return { k: "not", arg: this.parse(PREC_NOT) };
    }
    if (this.at("op", "-")) {
      this.pos += 1;
      return { k: "neg", arg: this.parse(PREC_MUL + 1) };
    }
    if (this.at("op", "+")) {
      this.pos += 1;
      return this.parseUnary();
    }
    return this.parsePostfix(this.parsePrimary());
  }

  private parsePostfix(node: ExprNode): ExprNode {
    let current = node;
    for (;;) {
      // A cast is dropped: postgres adds `::text` to literals the declared
      // text never mentions, so keeping casts would make every comparison
      // fail for a reason nobody cares about.
      if (this.at("op", "::")) {
        this.pos += 1;
        this.skipTypeName();
        continue;
      }
      if (this.at("punc", "[")) {
        this.pos += 1;
        const index: ExprNode[] = [];
        while (!this.at("punc", "]")) {
          if (this.at("punc", ":") || this.at("punc", ",")) {
            this.pos += 1;
            continue;
          }
          index.push(this.parse(0));
        }
        this.expect("punc", "]");
        current = { k: "sub", target: current, index };
        continue;
      }
      break;
    }
    return current;
  }

  private skipTypeName(): void {
    const first = this.next();
    if (first.t !== "word" && first.t !== "qident") {
      throw new CouldNotCheckError("expected a type name after ::");
    }
    while (this.at("punc", ".")) {
      this.pos += 1;
      this.next();
    }
    while (this.peek()?.t === "word" && TYPE_CONTINUATIONS.has(this.peek()!.v)) {
      this.pos += 1;
    }
    if (this.at("punc", "(")) {
      let depth = 0;
      do {
        const token = this.next();
        if (token.t === "punc" && token.v === "(") depth += 1;
        if (token.t === "punc" && token.v === ")") depth -= 1;
      } while (depth > 0);
    }
    while (this.at("punc", "[")) {
      this.pos += 1;
      this.expect("punc", "]");
    }
  }

  private parsePrimary(): ExprNode {
    const token = this.peek();
    if (!token) throw new CouldNotCheckError("unexpected end of expression");

    if (token.t === "punc" && token.v === "(") {
      this.pos += 1;
      const inner = this.parse(0);
      // A row constructor `(a, b)` never appears in these policies; if one
      // shows up, say so rather than silently reading the first element.
      if (this.at("punc", ",")) {
        throw new CouldNotCheckError("row constructors are not supported by the drift check");
      }
      this.expect("punc", ")");
      return inner;
    }

    if (token.t === "str") {
      this.pos += 1;
      return { k: "str", v: token.v };
    }

    if (token.t === "num") {
      this.pos += 1;
      return { k: "num", v: normalizeNumber(token.v) };
    }

    if (token.t === "op" && token.v === "*") {
      this.pos += 1;
      return { k: "ref", v: "*" };
    }

    if (token.t === "qident" || token.t === "word") {
      if (token.t === "word" && token.v === "array" && this.peek(1)?.v === "[") {
        this.pos += 2;
        const items: ExprNode[] = [];
        if (!this.at("punc", "]")) {
          for (;;) {
            items.push(this.parse(0));
            if (this.at("punc", ",")) {
              this.pos += 1;
              continue;
            }
            break;
          }
        }
        this.expect("punc", "]");
        return { k: "array", items };
      }

      const parts: string[] = [this.next().v];
      while (this.at("punc", ".")) {
        this.pos += 1;
        const part = this.next();
        if (part.t !== "word" && part.t !== "qident" && !(part.t === "op" && part.v === "*")) {
          throw new CouldNotCheckError("expected an identifier after '.'");
        }
        parts.push(part.v);
      }
      const name = parts.join(".");

      if (this.at("punc", "(")) {
        this.pos += 1;
        const args: ExprNode[] = [];
        if (!this.at("punc", ")")) {
          for (;;) {
            args.push(this.parse(0));
            if (this.at("punc", ",")) {
              this.pos += 1;
              continue;
            }
            break;
          }
        }
        this.expect("punc", ")");
        return { k: "call", name, args };
      }

      return { k: "ref", v: name };
    }

    throw new CouldNotCheckError(`unexpected ${JSON.stringify(token.v)} in expression`);
  }
}

function binaryPrecedence(op: string): number | null {
  if (JSON_OPS.has(op)) return PREC_JSON;
  if (COMPARISON_OPS.has(op)) return PREC_CMP;
  if (op === "||") return PREC_CONCAT;
  if (op === "+" || op === "-") return PREC_ADD;
  if (op === "*" || op === "/" || op === "%") return PREC_MUL;
  return null;
}

function normalizeNumber(raw: string): string {
  const value = Number(raw);
  return Number.isFinite(value) ? String(value) : raw;
}

/**
 * `public` is on the search path of a hosted project, so postgres deparses
 * `public.f(x)` back as `f(x)`. Strip the qualifier from both sides so they
 * meet. Any OTHER schema stays — `evil.receipt_creator_id` must not normalise
 * to the same thing as `public.receipt_creator_id`.
 */
function stripPublicSchema(name: string): string {
  return name.startsWith("public.") ? name.slice("public.".length) : name;
}

function flattenSameOp(node: ExprNode, op: string, into: ExprNode[]): void {
  if (node.k === "op" && node.op === op) {
    for (const arg of node.args) flattenSameOp(arg, op, into);
    return;
  }
  into.push(node);
}

/**
 * Render the tree to one canonical string. Two expressions that mean the same
 * thing, modulo the things listed in the file header, render identically.
 */
export function renderCanonical(node: ExprNode): string {
  switch (node.k) {
    case "str":
      return `'${node.v}'`;
    case "num":
      return node.v;
    case "ref":
      return stripPublicSchema(node.v);
    case "call":
      return `${stripPublicSchema(node.name)}(${node.args.map(renderCanonical).join(",")})`;
    case "op": {
      if (node.op === "and" || node.op === "or") {
        const flat: ExprNode[] = [];
        flattenSameOp(node, node.op, flat);
        return `(${node.op} ${flat.map(renderCanonical).sort().join(" ")})`;
      }
      const parts = node.args.map(renderCanonical);
      if (COMMUTATIVE_OPS.has(node.op)) parts.sort();
      return `(${node.op} ${parts.join(" ")})`;
    }
    case "not":
      return `(not ${renderCanonical(node.arg)})`;
    case "neg":
      return `(neg ${renderCanonical(node.arg)})`;
    case "sub":
      return `(sub ${renderCanonical(node.target)} ${node.index.map(renderCanonical).join(",")})`;
    case "is":
      return `(is${node.negated ? "-not" : ""} ${renderCanonical(node.arg)} ${node.test})`;
    case "in":
      return `(in${node.negated ? "-not" : ""} ${renderCanonical(node.arg)} ${node.list
        .map(renderCanonical)
        .sort()
        .join(",")})`;
    case "array":
      return `(array ${node.items.map(renderCanonical).join(",")})`;
  }
}

/**
 * The single entry point the comparison uses. Returns null for an absent
 * expression (an INSERT policy has no USING clause), and THROWS rather than
 * returning a best guess — an expression that cannot be parsed is a
 * "could not check", never a pass.
 */
export function canonicalizeExpression(expr: string | null | undefined): string | null {
  if (expr === null || expr === undefined) return null;
  const trimmed = expr.trim();
  if (trimmed === "") return null;

  const tokens = tokenizeSql(trimmed);
  if (tokens.length === 0) return null;

  const parser = new ExpressionParser(tokens);
  const node = parser.parse(0);
  if (parser.position !== tokens.length) {
    throw new CouldNotCheckError(
      `could not parse the whole expression; stopped at token ${parser.position} of ${tokens.length}`
    );
  }
  return renderCanonical(node);
}

// ---------------------------------------------------------------------------
// the repo side: what supabase/storage-policies.sql declares
// ---------------------------------------------------------------------------

export type PolicyCommand = "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE";

export interface DeclaredPolicy {
  name: string;
  table: string;
  command: PolicyCommand;
  permissive: boolean;
  roles: string[];
  using: string | null;
  withCheck: string | null;
}

export interface DeclaredBucket {
  id: string;
  isPublic: boolean;
}

function splitStatements(tokens: Token[]): Token[][] {
  const out: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.t === "punc" && token.v === ";") {
      if (current.length > 0) out.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  if (current.length > 0) out.push(current);
  return out;
}

function readDottedName(tokens: Token[], start: number): { name: string; next: number } {
  const parts: string[] = [];
  let i = start;
  for (;;) {
    const token = tokens[i];
    if (!token || (token.t !== "word" && token.t !== "qident")) break;
    parts.push(token.v);
    i += 1;
    if (tokens[i]?.t === "punc" && tokens[i]?.v === ".") {
      i += 1;
      continue;
    }
    break;
  }
  if (parts.length === 0) throw new CouldNotCheckError("expected a name");
  return { name: parts.join("."), next: i };
}

/**
 * Read the parenthesised expression that starts at `start` (which must be the
 * opening paren) and return its canonical form plus the index after the close.
 */
function readParenthesizedExpression(tokens: Token[], start: number): { canonical: string; next: number } {
  if (!(tokens[start]?.t === "punc" && tokens[start]?.v === "(")) {
    throw new CouldNotCheckError("expected '(' before a policy expression");
  }
  const parser = new ExpressionParser(tokens, start + 1);
  const node = parser.parse(0);
  let i = parser.position;
  if (!(tokens[i]?.t === "punc" && tokens[i]?.v === ")")) {
    throw new CouldNotCheckError("unbalanced parentheses in a policy expression");
  }
  i += 1;
  return { canonical: renderCanonical(node), next: i };
}

const VALID_COMMANDS: ReadonlySet<string> = new Set(["all", "select", "insert", "update", "delete"]);

/**
 * `create policy <name> on <table> [as permissive|restrictive] for <cmd>
 *  [to <role>[, <role>…]] [using (<expr>)] [with check (<expr>)]`
 */
function parseCreatePolicy(tokens: Token[]): DeclaredPolicy {
  let i = 2; // past `create policy`

  const nameToken = tokens[i];
  if (!nameToken || (nameToken.t !== "word" && nameToken.t !== "qident" && nameToken.t !== "str")) {
    throw new CouldNotCheckError("could not read a policy name");
  }
  const name = nameToken.v;
  i += 1;

  if (!(tokens[i]?.t === "word" && tokens[i]?.v === "on")) {
    throw new CouldNotCheckError(`policy ${name}: expected ON after the policy name`);
  }
  i += 1;

  const table = readDottedName(tokens, i);
  i = table.next;

  let permissive = true;
  if (tokens[i]?.t === "word" && tokens[i]?.v === "as") {
    i += 1;
    const mode = tokens[i];
    if (!mode || mode.t !== "word" || (mode.v !== "permissive" && mode.v !== "restrictive")) {
      throw new CouldNotCheckError(`policy ${name}: expected PERMISSIVE or RESTRICTIVE after AS`);
    }
    permissive = mode.v === "permissive";
    i += 1;
  }

  let command: PolicyCommand = "ALL";
  if (tokens[i]?.t === "word" && tokens[i]?.v === "for") {
    i += 1;
    const cmd = tokens[i];
    if (!cmd || cmd.t !== "word" || !VALID_COMMANDS.has(cmd.v)) {
      throw new CouldNotCheckError(`policy ${name}: expected a command after FOR`);
    }
    command = cmd.v.toUpperCase() as PolicyCommand;
    i += 1;
  }

  // No TO clause means `public`, which is what pg_policies reports too.
  let roles: string[] = ["public"];
  if (tokens[i]?.t === "word" && tokens[i]?.v === "to") {
    i += 1;
    roles = [];
    for (;;) {
      const role = tokens[i];
      if (!role || (role.t !== "word" && role.t !== "qident")) {
        throw new CouldNotCheckError(`policy ${name}: expected a role name after TO`);
      }
      roles.push(role.v);
      i += 1;
      if (tokens[i]?.t === "punc" && tokens[i]?.v === ",") {
        i += 1;
        continue;
      }
      break;
    }
  }

  let using: string | null = null;
  let withCheck: string | null = null;

  while (i < tokens.length) {
    const token = tokens[i];
    if (token.t === "word" && token.v === "using") {
      const read = readParenthesizedExpression(tokens, i + 1);
      using = read.canonical;
      i = read.next;
      continue;
    }
    if (token.t === "word" && token.v === "with" && tokens[i + 1]?.v === "check") {
      const read = readParenthesizedExpression(tokens, i + 2);
      withCheck = read.canonical;
      i = read.next;
      continue;
    }
    throw new CouldNotCheckError(`policy ${name}: unexpected ${JSON.stringify(token.v)} in the policy definition`);
  }

  return {
    name,
    table: table.name,
    command,
    permissive,
    roles: normalizeRoles(roles),
    using,
    withCheck,
  };
}

export function parseDeclaredPolicies(sql: string): DeclaredPolicy[] {
  return splitStatements(tokenizeSql(sql))
    .filter((stmt) => stmt[0]?.v === "create" && stmt[1]?.v === "policy")
    .map(parseCreatePolicy);
}

/**
 * `insert into storage.buckets (id, name, public) values (…) [on conflict …
 *  do update set public = <bool>]`.
 *
 * When there is a conflict branch, that is the branch that actually runs
 * against a project where the bucket already exists — so it, not the VALUES
 * tuple, is what the live row is expected to hold.
 */
export function parseDeclaredBuckets(sql: string): DeclaredBucket[] {
  const out: DeclaredBucket[] = [];

  for (const stmt of splitStatements(tokenizeSql(sql))) {
    if (!(stmt[0]?.v === "insert" && stmt[1]?.v === "into")) continue;
    const target = readDottedName(stmt, 2);
    if (target.name !== "storage.buckets") continue;

    let i = target.next;
    if (!(stmt[i]?.t === "punc" && stmt[i]?.v === "(")) {
      throw new CouldNotCheckError("storage.buckets insert does not list its columns");
    }
    i += 1;
    const columns: string[] = [];
    while (!(stmt[i]?.t === "punc" && stmt[i]?.v === ")")) {
      const token = stmt[i];
      if (!token) throw new CouldNotCheckError("unterminated column list on the storage.buckets insert");
      if (token.t === "punc" && token.v === ",") {
        i += 1;
        continue;
      }
      columns.push(token.v);
      i += 1;
    }
    i += 1;

    if (!(stmt[i]?.t === "word" && stmt[i]?.v === "values")) {
      throw new CouldNotCheckError("storage.buckets insert has no VALUES tuple");
    }
    i += 1;
    if (!(stmt[i]?.t === "punc" && stmt[i]?.v === "(")) {
      throw new CouldNotCheckError("storage.buckets insert has no VALUES tuple");
    }
    i += 1;

    const values: Token[] = [];
    while (!(stmt[i]?.t === "punc" && stmt[i]?.v === ")")) {
      const token = stmt[i];
      if (!token) throw new CouldNotCheckError("unterminated VALUES tuple on the storage.buckets insert");
      if (token.t === "punc" && token.v === ",") {
        i += 1;
        continue;
      }
      values.push(token);
      i += 1;
    }
    i += 1;

    const idIndex = columns.indexOf("id");
    const publicIndex = columns.indexOf("public");
    if (idIndex === -1 || publicIndex === -1) {
      throw new CouldNotCheckError("storage.buckets insert must name both `id` and `public`");
    }
    const idToken = values[idIndex];
    const publicToken = values[publicIndex];
    if (!idToken || idToken.t !== "str") {
      throw new CouldNotCheckError("storage.buckets insert must give a literal bucket id");
    }
    if (!publicToken || publicToken.t !== "word" || (publicToken.v !== "true" && publicToken.v !== "false")) {
      throw new CouldNotCheckError("storage.buckets insert must give a literal `public` flag");
    }

    let isPublic = publicToken.v === "true";

    // …unless a DO UPDATE branch overrides it.
    for (let j = i; j < stmt.length - 2; j += 1) {
      if (stmt[j].t === "word" && stmt[j].v === "public" && stmt[j + 1]?.v === "=") {
        const value = stmt[j + 2];
        if (value?.t === "word" && (value.v === "true" || value.v === "false")) {
          isPublic = value.v === "true";
        }
      }
    }

    out.push({ id: idToken.v, isPublic });
  }

  return out;
}

export function migrationVersion(filename: string): string {
  const base = filename.replace(/\.sql$/i, "");
  const underscore = base.indexOf("_");
  return underscore === -1 ? base : base.slice(0, underscore);
}

export function repoMigrationVersions(filenames: string[]): string[] {
  return filenames
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .map(migrationVersion)
    .sort();
}

// ---------------------------------------------------------------------------
// the live side
// ---------------------------------------------------------------------------

export interface LivePolicy {
  name: string;
  command: PolicyCommand;
  permissive: boolean;
  roles: string[];
  using: string | null;
  withCheck: string | null;
}

function normalizeRoles(roles: string[]): string[] {
  return [...roles.map((r) => r.trim().toLowerCase()).filter(Boolean)].sort();
}

/** `roles` comes back either as a JSON array or as postgres' `{a,b}` text. */
export function parsePgTextArray(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeRoles(value.map((v) => String(v)));
  if (value === null || value === undefined) return [];
  const text = String(value).trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return normalizeRoles([text]);
  const inner = text.slice(1, -1);
  if (inner.trim() === "") return [];
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quoted) {
      if (ch === "\\") {
        current += inner[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (ch === '"') {
        quoted = false;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return normalizeRoles(out);
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.trim() === "" ? null : text;
}

export function normalizeLivePolicies(rows: Record<string, unknown>[]): LivePolicy[] {
  return rows.map((row) => {
    const name = optionalString(row.policyname) ?? "(unnamed)";
    const rawCommand = (optionalString(row.cmd) ?? "ALL").toUpperCase();
    if (!VALID_COMMANDS.has(rawCommand.toLowerCase())) {
      throw new CouldNotCheckError(`live policy ${name}: unrecognised command ${JSON.stringify(rawCommand)}`);
    }
    const permissiveRaw = optionalString(row.permissive);
    const permissive = permissiveRaw === null ? true : permissiveRaw.toUpperCase() !== "RESTRICTIVE";

    try {
      return {
        name,
        command: rawCommand as PolicyCommand,
        permissive,
        roles: parsePgTextArray(row.roles),
        using: canonicalizeExpression(optionalString(row.qual)),
        withCheck: canonicalizeExpression(optionalString(row.with_check)),
      };
    } catch (error) {
      throw new CouldNotCheckError(
        `live policy ${name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// comparison
// ---------------------------------------------------------------------------

export interface DriftItem {
  headline: string;
  detail?: string[];
}

export function diffMigrations(repoVersions: string[], liveVersions: string[]): DriftItem[] {
  const repo = new Set(repoVersions);
  const live = new Set(liveVersions);
  const items: DriftItem[] = [];

  const missing = repoVersions.filter((v) => !live.has(v));
  if (missing.length > 0) {
    items.push({
      headline: `${missing.length} migration(s) in the repo are not applied to the live database`,
      detail: missing.map((v) => `${v} — in supabase/migrations/, absent from schema_migrations`),
    });
  }

  const extra = liveVersions.filter((v) => !repo.has(v));
  if (extra.length > 0) {
    items.push({
      headline: `${extra.length} migration(s) recorded live have no file in the repo`,
      detail: extra.map((v) => `${v} — in schema_migrations, absent from supabase/migrations/`),
    });
  }

  return items;
}

function policyKey(policy: DeclaredPolicy | LivePolicy): string {
  return [
    policy.command,
    policy.permissive ? "permissive" : "restrictive",
    policy.roles.join("+"),
    policy.using ?? "-",
    policy.withCheck ?? "-",
  ].join(" | ");
}

function describe(policy: DeclaredPolicy | LivePolicy): string[] {
  const lines = [
    `command: ${policy.command}`,
    `roles: ${policy.roles.join(", ") || "(none)"}`,
    `${policy.permissive ? "permissive" : "restrictive"}`,
  ];
  if (policy.using !== null) lines.push(`using: ${policy.using}`);
  if (policy.withCheck !== null) lines.push(`with check: ${policy.withCheck}`);
  return lines;
}

/**
 * Names are never compared. A declared policy is satisfied by ANY live policy
 * with the same command, roles, mode and normalised expressions; matches are
 * consumed one-for-one so a duplicate live row is left over and reported.
 * That leftover is the `_1` row the dashboard creates when two operations are
 * ticked on one policy — no name is wrong, the count is.
 */
export function diffPolicies(declared: DeclaredPolicy[], live: LivePolicy[]): DriftItem[] {
  const items: DriftItem[] = [];
  const unmatchedLive = [...live];
  const unmatchedDeclared: DeclaredPolicy[] = [];

  for (const want of declared) {
    const key = policyKey(want);
    const index = unmatchedLive.findIndex((candidate) => policyKey(candidate) === key);
    if (index === -1) {
      unmatchedDeclared.push(want);
      continue;
    }
    unmatchedLive.splice(index, 1);
  }

  for (const want of unmatchedDeclared) {
    const nearMiss = unmatchedLive.filter((candidate) => candidate.command === want.command);
    const detail = [`declared in ${POLICIES_FILE}:`, ...describe(want).map((l) => `  ${l}`)];
    if (nearMiss.length > 0) {
      detail.push(`live policies on the same command that did NOT match:`);
      for (const candidate of nearMiss) {
        detail.push(`  ${candidate.name}`);
        detail.push(...describe(candidate).map((l) => `    ${l}`));
      }
    }
    items.push({
      headline: `no live policy matches declared "${want.name}"`,
      detail,
    });
  }

  for (const extra of unmatchedLive) {
    items.push({
      headline: `live policy "${extra.name}" is not declared in ${POLICIES_FILE}`,
      detail: describe(extra).map((l) => `  ${l}`),
    });
  }

  return items;
}

export interface LiveBucket {
  id: string;
  isPublic: boolean;
}

export function normalizeLiveBuckets(rows: Record<string, unknown>[]): LiveBucket[] {
  return rows.map((row) => {
    const id = optionalString(row.id);
    if (id === null) throw new CouldNotCheckError("a storage.buckets row came back with no id");
    const raw = row.public;
    const isPublic = raw === true || String(raw).toLowerCase() === "true" || String(raw) === "t";
    return { id, isPublic };
  });
}

/**
 * Only the buckets the repo declares are checked. A bucket the repo says
 * nothing about is not drift — unlike a policy, which lives on the shared
 * `storage.objects` table and therefore affects the ones we do declare.
 */
export function diffBuckets(declared: DeclaredBucket[], live: LiveBucket[]): DriftItem[] {
  const items: DriftItem[] = [];
  for (const want of declared) {
    const found = live.find((bucket) => bucket.id === want.id);
    if (!found) {
      items.push({ headline: `bucket "${want.id}" is declared in the repo but does not exist live` });
      continue;
    }
    if (found.isPublic !== want.isPublic) {
      items.push({
        headline: `bucket "${want.id}" is public=${found.isPublic} live, repo declares public=${want.isPublic}`,
        detail: ["a public receipt-images bucket serves every stored photograph over an unauthenticated URL"],
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// talking to the live project, through the Supabase CLI
// ---------------------------------------------------------------------------

export type QueryResult =
  | { ok: true; rows: Record<string, unknown>[] }
  // `fromCli` marks a reason the CLI itself gave us, which is already a
  // complete sentence — no point echoing its raw output after it.
  | { ok: false; reason: string; fromCli: boolean };

function tryParseJson(text: string): unknown {
  if (text === "") return undefined;
  const first = text[0];
  if (first !== "{" && first !== "[" && first !== '"') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorEnvelope(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && value._tag === "Error";
}

// Keys `rowsFrom` already looks inside for a nested result set. An object
// carrying one of these — `{"_tag":"Success","result":null}` is the shape
// that surfaced this — has already been examined and rejected as "no rows
// here" by `rowsFrom`. It must not then be re-admitted by the NDJSON
// heuristic below as if it were one literal database row: a null/odd
// envelope is "could not find a result set", never "one row that happens to
// look like an envelope".
const ENVELOPE_KEYS = new Set(["rows", "result", "results", "data", "records", "_tag"]);

function looksLikeEnvelope(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => ENVELOPE_KEYS.has(key));
}

function errorEnvelopeMessage(value: Record<string, unknown>): string {
  const error = isPlainObject(value.error) ? value.error : {};
  const code = optionalString(error.code);
  const message = optionalString(error.message) ?? "the supabase CLI reported an error";
  const suggestion = optionalString(error.suggestion);
  return [code ? `${code}: ${message}` : message, suggestion].filter(Boolean).join(" — ");
}

function rowsFrom(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value)) {
    return value.every(isPlainObject) ? (value as Record<string, unknown>[]) : null;
  }
  if (isPlainObject(value)) {
    for (const key of ["rows", "result", "results", "data", "records"]) {
      if (key in value) {
        const nested = rowsFrom(value[key]);
        if (nested) return nested;
      }
    }
  }
  return null;
}

/** Every top-level balanced `[...]` region in `text`, in the order they appear. */
function findBalancedArrays(text: string): string[] {
  const regions: string[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const start = text.indexOf("[", searchFrom);
    if (start === -1) break;

    let depth = 0;
    let inString = false;
    let end = -1;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\") {
          i += 1;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "[") depth += 1;
      if (ch === "]") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end === -1) break;
    regions.push(text.slice(start, end + 1));
    searchFrom = end + 1;
  }

  return regions;
}

/**
 * The CLI mixes plain progress lines ("Connecting to…") with JSON, and its
 * exact envelope has changed between versions. Rather than pin one shape, look
 * for the result set in every shape it plausibly takes — and if none is found,
 * say so and exit 2 rather than treating "no rows found" as "no drift".
 */
export function extractQueryRows(stdout: string): QueryResult {
  const whole = tryParseJson(stdout.trim());
  const lineValues = stdout
    .split(/\r?\n/)
    .map((line) => tryParseJson(line.trim()))
    .filter((value) => value !== undefined);

  const candidates = whole === undefined ? lineValues : [whole, ...lineValues];

  const failure = candidates.find(isErrorEnvelope);
  if (failure) return { ok: false, reason: errorEnvelopeMessage(failure), fromCli: true };

  // Do not stop at the FIRST candidate that parses to an array — a stray `[]`
  // progress line ahead of the real rows is itself a parseable (empty) array,
  // and `if (rows)` is true for `[]` in JS. Scan every candidate and prefer
  // the last one that actually has rows; only fall back to an empty match if
  // nothing better ever showed up, which is what keeps a genuinely empty
  // result set (the CLI's only line being `[]`) still reading as zero rows.
  let candidateRows: Record<string, unknown>[] | null = null;
  for (const candidate of candidates) {
    const rows = rowsFrom(candidate);
    if (rows === null) continue;
    if (rows.length > 0) {
      candidateRows = rows;
      continue;
    }
    if (candidateRows === null) candidateRows = rows;
  }
  if (candidateRows !== null) return { ok: true, rows: candidateRows };

  // NDJSON: one row object per line. An envelope-shaped object (one of the
  // wrapper keys above) is excluded — it already went through the candidate
  // loop and was rejected there, so it is not a data row either.
  const objectLines = lineValues.filter(
    (value): value is Record<string, unknown> => isPlainObject(value) && !looksLikeEnvelope(value)
  );
  if (objectLines.length > 0 && objectLines.length === lineValues.length) {
    return { ok: true, rows: objectLines };
  }

  // A stray progress line can print an empty array (`[]`) before the real
  // result set. Scan every balanced array in the output rather than just the
  // first, and prefer the last NON-EMPTY one — the real result is what a
  // deploy log tends to print last, and an empty match earlier must not win
  // over real rows that come after it. A lone, genuinely empty result (the
  // only array in the output) still falls through to that same empty match.
  let fallbackRows: Record<string, unknown>[] | null = null;
  for (const region of findBalancedArrays(stdout)) {
    const rows = rowsFrom(tryParseJson(region));
    if (rows === null) continue;
    if (rows.length > 0) {
      fallbackRows = rows;
      continue;
    }
    if (fallbackRows === null) fallbackRows = rows;
  }
  if (fallbackRows !== null) return { ok: true, rows: fallbackRows };

  return {
    ok: false,
    reason: "could not find a result set in the supabase CLI output (is the CLI version supported?)",
    fromCli: false,
  };
}

const SUPABASE_BIN = process.env.SUPABASE_BIN ?? "supabase";

function runQuery(sql: string): Record<string, unknown>[] {
  const result = spawnSync(
    SUPABASE_BIN,
    ["--workdir", REPO_ROOT, "--output-format", "json", "db", "query", "--linked", sql],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      // stdin is closed so a CLI that decides to prompt for a password fails
      // fast instead of hanging a deploy step forever.
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
    }
  );

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new CouldNotCheckError(
        redactSecrets(
          `the supabase CLI (${SUPABASE_BIN}) is not on PATH — install it, or set SUPABASE_BIN to its full path`
        )
      );
    }
    throw new CouldNotCheckError(`could not run the supabase CLI: ${redactSecrets(result.error.message)}`);
  }

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const parsed = extractQueryRows(stdout);

  if (!parsed.ok) {
    if (parsed.fromCli) throw new CouldNotCheckError(redactSecrets(parsed.reason));
    const tail = redactSecrets(`${stdout}\n${stderr}`).trim().split(/\r?\n/).slice(-4).join(" / ");
    throw new CouldNotCheckError(`${redactSecrets(parsed.reason)}${tail ? ` (cli said: ${tail})` : ""}`);
  }

  if (result.status !== 0) {
    throw new CouldNotCheckError(
      `the supabase CLI exited ${result.status}: ${redactSecrets(stderr).trim() || "no message"}`
    );
  }

  return parsed.rows;
}

// ---------------------------------------------------------------------------
// the check itself
// ---------------------------------------------------------------------------

const Q_TRACKING_TABLE = `select to_regclass('supabase_migrations.schema_migrations') is not null as tracked;`;
const Q_APPLIED_MIGRATIONS = `select version from supabase_migrations.schema_migrations order by version;`;
const Q_STORAGE_POLICIES = `select policyname, cmd, permissive, roles::text[] as roles, qual, with_check from pg_policies where schemaname = '${POLICY_SCHEMA}' and tablename = '${POLICY_TABLE}' order by policyname;`;
const Q_STORAGE_BUCKETS = `select id, public from storage.buckets order by id;`;

export interface Section {
  title: string;
  summary: string;
  items: DriftItem[];
}

function readRepoMigrations(): string[] {
  const dir = path.join(REPO_ROOT, MIGRATIONS_DIR);
  if (!existsSync(dir)) throw new CouldNotCheckError(`${MIGRATIONS_DIR} does not exist in this checkout`);
  return repoMigrationVersions(readdirSync(dir));
}

function readDeclaredStoragePolicies(): { policies: DeclaredPolicy[]; buckets: DeclaredBucket[] } {
  const file = path.join(REPO_ROOT, POLICIES_FILE);
  if (!existsSync(file)) throw new CouldNotCheckError(`${POLICIES_FILE} does not exist in this checkout`);
  const sql = readFileSync(file, "utf8");
  const table = `${POLICY_SCHEMA}.${POLICY_TABLE}`;
  return {
    policies: parseDeclaredPolicies(sql).filter((p) => p.table === table),
    buckets: parseDeclaredBuckets(sql),
  };
}

function checkMigrations(): Section {
  const repoVersions = readRepoMigrations();

  const tracking = runQuery(Q_TRACKING_TABLE);
  const trackedValue = tracking[0]?.tracked;
  const tracked = trackedValue === true || String(trackedValue).toLowerCase() === "true" || String(trackedValue) === "t";

  if (!tracked) {
    return {
      title: "migrations",
      summary: `${repoVersions.length} in the repo, migration history table absent live`,
      items: [
        {
          headline: "the live database has no supabase_migrations.schema_migrations table",
          detail: [
            "nothing on that project has ever been applied through `supabase db push`,",
            "so the schema was built by hand and no migration in the repo is recorded.",
          ],
        },
      ],
    };
  }

  const liveVersions = runQuery(Q_APPLIED_MIGRATIONS)
    .map((row) => optionalString(row.version))
    .filter((v): v is string => v !== null)
    .sort();

  return {
    title: "migrations",
    summary: `${repoVersions.length} in the repo, ${liveVersions.length} recorded live`,
    items: diffMigrations(repoVersions, liveVersions),
  };
}

function checkStorage(): Section[] {
  const declared = readDeclaredStoragePolicies();

  const livePolicies = normalizeLivePolicies(runQuery(Q_STORAGE_POLICIES));
  const liveBuckets = normalizeLiveBuckets(runQuery(Q_STORAGE_BUCKETS));

  return [
    {
      title: `storage policies on ${POLICY_SCHEMA}.${POLICY_TABLE}`,
      summary: `${declared.policies.length} declared, ${livePolicies.length} live (matched by expression, not by name)`,
      items: diffPolicies(declared.policies, livePolicies),
    },
    {
      title: "storage buckets",
      summary: `${declared.buckets.length} declared`,
      items: diffBuckets(declared.buckets, liveBuckets),
    },
  ];
}

export function formatReport(sections: Section[]): string {
  const lines: string[] = ["schema drift check — live supabase project vs this repo", ""];

  for (const section of sections) {
    const state = section.items.length === 0 ? "OK" : "DRIFT";
    lines.push(`${section.title}: ${state} (${section.summary})`);
    for (const item of section.items) {
      lines.push(`  - ${item.headline}`);
      for (const detail of item.detail ?? []) lines.push(`      ${detail}`);
    }
    lines.push("");
  }

  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  lines.push(total === 0 ? "RESULT: NO DRIFT" : `RESULT: DRIFT FOUND — ${total} problem(s) above`);

  return redactSecrets(lines.join("\n"));
}

const USAGE = `usage: node scripts/check-schema-drift.ts

Compares the linked Supabase project against this repo: applied migrations,
storage policies on ${POLICY_SCHEMA}.${POLICY_TABLE} (compared by expression, never by name), and
the public flag on every bucket the repo declares.

Run it from a checkout that has been linked with \`supabase link\`; a worktree
has no link of its own. Exit codes:

  0  no drift
  1  drift found, listed on stdout
  2  could not check — no credentials, not linked, a query failed, --help was
     requested, or an unrecognised argument was given (--help never means
     "clean", because it never compared anything)

env:
  SUPABASE_BIN   path to the supabase CLI (default: supabase on PATH)
`;

export function main(argv: string[]): number {
  // --help is not a clean bill of health — a deploy step that passes a stray
  // flag and only checks the exit code must not read this as "no drift". It
  // still prints the usage text (to stdout, where a human looks for it) but
  // exits the same non-zero code as any other "nothing was verified" case.
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    process.stderr.write(
      "RESULT: COULD NOT CHECK — usage was requested; no comparison was performed.\n"
    );
    return 2;
  }

  const unrecognised = argv.filter((arg) => arg.startsWith("-"));
  if (unrecognised.length > 0) {
    process.stderr.write(
      `RESULT: COULD NOT CHECK — unrecognised argument(s): ${unrecognised.join(", ")}\n` +
        `nothing was verified. this is NOT a clean bill of health.\n\n${USAGE}`
    );
    return 2;
  }

  try {
    const sections = [checkMigrations(), ...checkStorage()];
    process.stdout.write(`${formatReport(sections)}\n`);
    return sections.some((section) => section.items.length > 0) ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `RESULT: COULD NOT CHECK — ${redactSecrets(message)}\n` +
        `nothing was verified. this is NOT a clean bill of health.\n`
    );
    return 2;
  }
}

// Only run when invoked directly. Vitest imports this file for the pure halves.
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
