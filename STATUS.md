# Agent status

Updated 2026-08-19 19:05 UTC · regenerated on every task completion.

## Spend

| Lane | Spent | Cap | Used |
|---|---|---|---|
| open-tab | $5.78 | $20.00 | ██░░░░░░░░ 28% |

## Agents

| Role | Lane | Started | Running |
|---|---|---|---|
| builder-light | open-tab | 2026-08-19T19:01:30Z | 2 |
| reviewer | open-tab | 2026-08-19T19:03:15Z | 5 |
| publisher | open-tab | 2026-08-19T19:03:40Z | 1 |
| builder | open-tab | 2026-08-19T19:05:06Z | 5 |

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
2026-08-19T19:05:29Z  open-tab  SubagentStop  
2026-08-19T19:05:29Z  open-tab  SubagentStop  
2026-08-19T19:05:29Z  open-tab  SubagentStop  
2026-08-19T19:05:29Z  open-tab  SubagentStop  
2026-08-19T19:05:30Z  open-tab  SubagentStop  
2026-08-19T19:05:30Z  open-tab  SubagentStop  
2026-08-19T19:05:30Z  open-tab  SubagentStop  
2026-08-19T19:05:30Z  open-tab  SubagentStop  
2026-08-19T19:05:30Z  open-tab  SubagentStop  
2026-08-19T19:05:37Z  open-tab  SubagentStop  
2026-08-19T19:05:37Z  open-tab  SubagentStop  
2026-08-19T19:05:37Z  open-tab  SubagentStop  
2026-08-19T19:05:37Z  open-tab  SubagentStop  
2026-08-19T19:05:37Z  open-tab  SubagentStop  
2026-08-19T19:05:48Z  open-tab  SubagentStop  reviewer
2026-08-19T19:05:53Z  open-tab  SubagentStop  
2026-08-19T19:05:53Z  open-tab  SubagentStop  
2026-08-19T19:05:53Z  open-tab  SubagentStop  
2026-08-19T19:05:53Z  open-tab  SubagentStop  
2026-08-19T19:05:53Z  open-tab  SubagentStop  
```

---

Generated locally and pushed to the `status` branch. Freshness depends on
this machine having run and pushed — GitHub cannot pull this data itself.
