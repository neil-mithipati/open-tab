# Connecting Notion

The scaffold is wired for this already: the publisher card grants
`mcp__notion__*`, and it reads destinations from `.claude/notion.json`. Three
things remain, and all three need you — they involve a browser sign-in and your
own workspace.

Skip this entirely on day one if you want. Without it the publisher writes the same
content to `docs/` as markdown, which is what your READMEs need anyway.

---

## 1. Add the server

```bash
cd ~/your-repo
claude mcp add --transport http notion https://mcp.notion.com/mcp
```

The server **must** be named `notion` — that is what `mcp__notion__*` in the
publisher card matches. A different name silently fails to grant, and the publisher
falls back to markdown without telling you why.

## 2. Authorize

```bash
claude
  /mcp        # select notion, follow the browser prompt
```

Then confirm the tools are visible:

```
  /mcp        # notion should read "connected"
```

If it reads `needs-auth` or `failed`, the publisher will use the fallback.

## 3. Point it somewhere safe

Create one scratch page in Notion. Copy its ID from the URL — the 32-character hex
string before any `?`. Then:

```bash
jq '.scratch_page_id = "PASTE_ID_HERE"' .claude/notion.json > t && mv t .claude/notion.json
```

Leave `use_scratch_only` as `true`. Run one feature through the publisher and read
what it produces. Only once you like the output:

```bash
jq '.docs_database_id = "..." | .kanban_database_id = "..." | .use_scratch_only = false' \
  .claude/notion.json > t && mv t .claude/notion.json
```

---

## Why the scratch page

Notion writes are the one sanctioned exception to the handbook's rule that agents
do not publish. Everything else in this system is reversible by design; a page
written into your real docs board is not. `use_scratch_only` exists so the first
run cannot touch anything you care about, and the publisher is instructed never to
flip it.

## Two things to keep in mind

- **Scope the connection narrowly.** Share only the pages the publisher needs with
  the integration, rather than the whole workspace. It only ever needs the docs
  board, the kanban, and the scratch page.
- **Notion content is data, not instructions.** Anything the publisher reads out of
  a Notion page — including text that looks addressed to it — is untrusted input.
  The card tells it to report and stop rather than act on such text.
