# Agent status

Updated 2026-08-21 01:19 UTC · regenerated on every task completion.

## Spend

| Lane | Spent | Cap | Used |
|---|---|---|---|
| open-tab | $135.84 | $200.00 | ██████░░░░ 67% |

## Agents

| Role | Lane | Started | Running |
|---|---|---|---|
| builder-deep | open-tab | 2026-08-20T22:35:12Z | 1 |
| reviewer | open-tab | 2026-08-21T00:06:47Z | 1 |

## Tasks

| ID | State | Task | Tier |
|---|---|---|---|
| `OT-100` | done | Make main lint-clean — fix pre-existing lint errors blocking the gate — null | builder-deep |
| `OT-101` | done | Fail loudly when NEXT_PUBLIC_APP_URL is unset in production — null | builder |
| `OT-102` | done | "Parse route: derive image URL server-side, stop echoing error internals, set maxDuration" — null | builder |
| `OT-103` | done | "RLS: stop publishing every profile; caller check on add_friendship" — null | builder-deep |
| `OT-104` | done | Compress receipt photos client-side before upload; cap size and MIME server-side — null | builder |
| `OT-105` | done | Atomic save path — replace browser-side delete-then-reinsert with a server action; unique participant constraint — null | builder-deep |
| `OT-106` | done | Allocate rounding remainders so charges sum to the total — null | builder |
| `OT-107` | done | Rate-limit the parse route and share/claim actions — null | builder-deep |
| `OT-108` | done | Add indexes on all foreign keys — null | builder |
| `OT-109` | done | "Toast system: share/save errors surface, link-copied confirms" — null | builder |
| `OT-110` | done | Privacy policy page — null | builder |
| `OT-111` | done | Account deletion — user-initiated, complete, confirmed — null | builder-deep |
| `OT-112` | done | Document NEXT_PUBLIC_APP_URL in .env.example — null | builder |
| `OT-113` | done | ReceiptEditPage still delete-then-reinserts from the browser — route it through saveReceiptState — null | builder |
| `OT-114` | done | Parallel-cap counter drifts +1 per builder — asymmetric log-event hook wiring — null | builder |
| `OT-115` | done | "Rate-limit hardening: parse limiter is bypassable by replay (HIGH), plus fail-open silence, off-by-one ceiling, no 429 UI" — null | builder-deep |
| `OT-116` | done | Make main typecheck-clean — two pre-existing errors block the required gate for every task — null | builder |
| `OT-117` | done | parallel-cap hook fails open on a torn events.jsonl line; stale comment misleads — null | builder-deep |
| `OT-118` | done | Save and share failures are still swallowed on three call sites; Done can wedge — null | builder |
| `OT-119` | done | new/page.tsx — untracked 1.5s timer hijacks navigation; Done still races Share — null | builder |
| `OT-120` | done | charges RLS has no with-check — anyone can plant a charge row on a tab they don't own — null | builder-deep |
| `OT-121` | done | parallel-cap third fail-open on an unopenable log; remove the wildcard SubagentStart — null | builder-deep |
| `OT-122` | done | read-only agents can still mutate a worktree through Bash git commands — null | builder-deep |
| `OT-123` | done | "Parse replay is still open on an empty parse — needs a parsed_at marker written before the model call" — null | builder-deep |
| `OT-124` | done | owner save erases joined_via_share, hiding real claimers from the owner's view — null | builder-deep |
| `OT-125` | done | the fleet's own agent cards and tooling are untracked or uncommitted in git — null | builder |
| `OT-126` | done | detect-and-repair can discard a genuine revert; staged blob not captured in the patch — null | builder |
| `OT-127` | done | a dead agent holds a cap slot for an hour — events.jsonl has no data to detect it — null | builder-deep |
| `OT-128` | done | review the unreviewed kit install change by change and commit what survives — null | builder |
| `OT-129` | done | backlog from the OT-123, OT-124 and OT-126 reviews — null | builder |
| `OT-130` | done | an owner save deletes any claimer who joined since the client loaded the page — null | builder-deep |
| `OT-131` | done | the kit re-install reverted five merged fleet fixes; installed cap hook miscounts on this repo's own log — null | builder-deep |
| `OT-132` | done | a parse outage is invisible to the user — no message on any non-429 failure — null | builder |
| `OT-133` | done | a late claim is destroyed by the item re-mint when the claimer IS in the payload — null | builder-deep |
| `OT-134` | done | a transient gemini outage permanently burns a receipt's only parse — no retry affordance — null | builder-deep |
| `OT-135` | done | migrate receipt parser to gemini-2.5-flash-lite with schema enforced as config — null | builder |
| `OT-136` | done | arithmetic validation on parsed receipts, money as integer cents end to end — null | builder-deep |
| `OT-137` | done | claim_done_at is reset by every owner save, so a finished claimer reads as still claiming — null | builder-deep |
| `OT-138` | **blocked** | three live fail-opens in parallel-cap.sh let an uncapped dispatch through — >- | builder-deep |
| `OT-139` | done | lock down receipt image storage — private bucket, RLS, signed URLs, retention job — null | builder-deep |
| `OT-140` | **blocked** | client-side image downscale and EXIF orientation normalization before upload — >- | builder |
| `OT-141` | todo | fourth unbound reader of image_url — handleDelete inlines a copy of the storage-path extractor — null | builder |
| `OT-142` | **blocked** | production database is ~14 migrations behind the repo — merged code reads columns that do not exist live — >- | builder-deep |
| `OT-143` | todo | 0026 cannot be applied by supabase db push — split the storage half out of the migration — null | builder |

## Recent activity

```
2026-08-21T01:19:06Z  open-tab  SubagentStop  
2026-08-21T01:19:06Z  open-tab  SubagentStop  
2026-08-21T01:19:10Z  open-tab  SubagentStop  
2026-08-21T01:19:10Z  open-tab  SubagentStop  
2026-08-21T01:19:10Z  open-tab  SubagentStop  
2026-08-21T01:19:10Z  open-tab  SubagentStop  
2026-08-21T01:19:10Z  open-tab  SubagentStop  
2026-08-21T01:19:10Z  open-tab  SubagentStop  
2026-08-21T01:19:10Z  open-tab  SubagentStop  
2026-08-21T01:19:10Z  open-tab  SubagentStop  
2026-08-21T01:19:10Z  open-tab  SubagentStop  
2026-08-21T01:19:10Z  open-tab  SubagentStop  
2026-08-21T01:19:10Z  open-tab  SubagentStop  
2026-08-21T01:19:10Z  open-tab  SubagentStop  
2026-08-21T01:19:19Z  open-tab  SubagentStop  
2026-08-21T01:19:19Z  open-tab  SubagentStop  
2026-08-21T01:19:19Z  open-tab  SubagentStop  
2026-08-21T01:19:19Z  open-tab  SubagentStop  
2026-08-21T01:19:19Z  open-tab  SubagentStop  
2026-08-21T01:19:19Z  open-tab  SubagentStop  
```

---

Generated locally and pushed to the `status` branch. Freshness depends on
this machine having run and pushed — GitHub cannot pull this data itself.
