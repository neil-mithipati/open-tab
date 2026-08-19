# Agent status

Updated 2026-08-19 19:02 UTC · regenerated on every task completion.

## Spend

| Lane | Spent | Cap | Used |
|---|---|---|---|
| open-tab | $1.2 | $20.00 | ░░░░░░░░░░ 5% |

## Agents

| Role | Lane | Started | Running |
|---|---|---|---|
| builder-light | open-tab | 2026-08-19T19:01:30Z | 2 |
| reviewer | open-tab | 2026-08-19T19:01:48Z | 2 |
| builder | open-tab | 2026-08-19T19:02:26Z | 2 |

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
| `OT-108` | running | Add indexes on all foreign keys — null | builder |
| `OT-109` | **blocked** | "Toast system: share/save errors surface, link-copied confirms" — >- | builder |
| `OT-110` | **blocked** | Privacy policy page — >- | builder |
| `OT-111` | **blocked** | Account deletion — user-initiated, complete, confirmed — >- | builder-deep |
| `OT-112` | running | Document NEXT_PUBLIC_APP_URL in .env.example — null | builder |
| `OT-113` | **blocked** | ReceiptEditPage still delete-then-reinserts from the browser — route it through saveReceiptState — >- | builder |
| `OT-114` | running | Parallel-cap counter drifts +1 per builder — asymmetric log-event hook wiring — null | builder |
| `OT-115` | **blocked** | Rate-limit hardening — fail-open silence, off-by-one parse ceiling, 429 has no UI — >- | builder |
| `OT-116` | done | Make main typecheck-clean — two pre-existing errors block the required gate for every task — null | builder |

## Recent activity

```
2026-08-19T19:01:26Z  open-tab  SubagentStop  
2026-08-19T19:01:26Z  open-tab  SubagentStop  
2026-08-19T19:01:30Z  open-tab  SubagentStart  builder-light
2026-08-19T19:01:30Z  open-tab  SubagentStart  builder-light
2026-08-19T19:01:48Z  open-tab  SubagentStart  reviewer
2026-08-19T19:01:48Z  open-tab  SubagentStart  reviewer
2026-08-19T19:02:04Z  open-tab  SubagentStop  
2026-08-19T19:02:04Z  open-tab  SubagentStop  
2026-08-19T19:02:04Z  open-tab  SubagentStop  
2026-08-19T19:02:04Z  open-tab  SubagentStop  
2026-08-19T19:02:04Z  open-tab  SubagentStop  
2026-08-19T19:02:17Z  open-tab  SubagentStop  builder-light
2026-08-19T19:02:20Z  open-tab  SubagentStop  
2026-08-19T19:02:20Z  open-tab  SubagentStop  
2026-08-19T19:02:20Z  open-tab  SubagentStop  
2026-08-19T19:02:20Z  open-tab  SubagentStop  
2026-08-19T19:02:20Z  open-tab  SubagentStop  
2026-08-19T19:02:26Z  open-tab  SubagentStart  builder
2026-08-19T19:02:26Z  open-tab  SubagentStart  builder
2026-08-19T19:02:27Z  open-tab  SubagentStop  builder-light
```

---

Generated locally and pushed to the `status` branch. Freshness depends on
this machine having run and pushed — GitHub cannot pull this data itself.
