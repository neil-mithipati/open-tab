# Agent status

Updated 2026-08-19 20:40 UTC · regenerated on every task completion.

## Spend

| Lane | Spent | Cap | Used |
|---|---|---|---|
| open-tab | $2.17 | $20.00 | █░░░░░░░░░ 10% |

## Agents

Idle — no agents currently running.

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
| `OT-107` | running | Rate-limit the parse route and share/claim actions — null | builder-deep |
| `OT-108` | done | Add indexes on all foreign keys — null | builder |
| `OT-109` | running | "Toast system: share/save errors surface, link-copied confirms" — null | builder |
| `OT-110` | **blocked** | Privacy policy page — >- | builder |
| `OT-111` | running | Account deletion — user-initiated, complete, confirmed — null | builder-deep |
| `OT-112` | done | Document NEXT_PUBLIC_APP_URL in .env.example — null | builder |
| `OT-113` | running | ReceiptEditPage still delete-then-reinserts from the browser — route it through saveReceiptState — null | builder |
| `OT-114` | done | Parallel-cap counter drifts +1 per builder — asymmetric log-event hook wiring — null | builder |
| `OT-115` | todo | Rate-limit hardening — fail-open silence, off-by-one parse ceiling, 429 has no UI — null | builder |
| `OT-116` | done | Make main typecheck-clean — two pre-existing errors block the required gate for every task — null | builder |
| `OT-117` | todo | parallel-cap hook fails open on a torn events.jsonl line; stale comment misleads — null | builder-deep |

## Recent activity

```
2026-08-19T20:40:01Z  open-tab  SubagentStop  
2026-08-19T20:40:01Z  open-tab  SubagentStop  
2026-08-19T20:40:01Z  open-tab  SubagentStop  
2026-08-19T20:40:01Z  open-tab  SubagentStop  
2026-08-19T20:40:01Z  open-tab  SubagentStop  
2026-08-19T20:40:07Z  open-tab  SubagentStop  
2026-08-19T20:40:07Z  open-tab  SubagentStop  
2026-08-19T20:40:07Z  open-tab  SubagentStop  
2026-08-19T20:40:07Z  open-tab  SubagentStop  
2026-08-19T20:40:07Z  open-tab  SubagentStop  
```

---

Generated locally and pushed to the `status` branch. Freshness depends on
this machine having run and pushed — GitHub cannot pull this data itself.
