# Agent status

Updated 2026-08-19 14:27 UTC · regenerated on every task completion.

## Spend

| Lane | Spent | Cap | Used |
|---|---|---|---|
| open-tab | $2.87 | $20.00 | █░░░░░░░░░ 14% |

## Agents

| Role | Lane | Started | Running |
|---|---|---|---|
| builder-deep | open-tab | 2026-08-19T13:31:48Z | 1 |
| builder-light | open-tab | 2026-08-19T13:37:16Z | 2 |
| reviewer | open-tab | 2026-08-19T14:22:48Z | 3 |
| publisher | open-tab | 2026-08-19T14:26:15Z | 4 |

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
| `OT-108` | **blocked** | Add indexes on all foreign keys — >- | builder |
| `OT-109` | **blocked** | "Toast system: share/save errors surface, link-copied confirms" — >- | builder |
| `OT-110` | **blocked** | Privacy policy page — >- | builder-light |
| `OT-111` | **blocked** | Account deletion — user-initiated, complete, confirmed — >- | builder-deep |
| `OT-112` | **blocked** | Document NEXT_PUBLIC_APP_URL in .env.example — >- | builder-light |
| `OT-113` | **blocked** | ReceiptEditPage still delete-then-reinserts from the browser — route it through saveReceiptState — >- | builder |
| `OT-114` | **blocked** | Parallel-cap counter drifts +1 per builder — asymmetric log-event hook wiring — >- | builder |

## Recent activity

```
2026-08-19T14:26:47Z  open-tab  SubagentStop  
2026-08-19T14:26:47Z  open-tab  SubagentStop  
2026-08-19T14:26:47Z  open-tab  SubagentStop  
2026-08-19T14:26:47Z  open-tab  SubagentStop  
2026-08-19T14:27:07Z  open-tab  SubagentStop  
2026-08-19T14:27:07Z  open-tab  SubagentStop  
2026-08-19T14:27:07Z  open-tab  SubagentStop  
2026-08-19T14:27:07Z  open-tab  SubagentStop  
2026-08-19T14:27:07Z  open-tab  SubagentStop  
2026-08-19T14:27:09Z  open-tab  SubagentStop  
2026-08-19T14:27:09Z  open-tab  SubagentStop  
2026-08-19T14:27:09Z  open-tab  SubagentStop  
2026-08-19T14:27:09Z  open-tab  SubagentStop  
2026-08-19T14:27:09Z  open-tab  SubagentStop  
2026-08-19T14:27:12Z  open-tab  SubagentStop  publisher
2026-08-19T14:27:35Z  open-tab  SubagentStop  
2026-08-19T14:27:35Z  open-tab  SubagentStop  
2026-08-19T14:27:35Z  open-tab  SubagentStop  
2026-08-19T14:27:35Z  open-tab  SubagentStop  
2026-08-19T14:27:35Z  open-tab  SubagentStop  
```

---

Generated locally and pushed to the `status` branch. Freshness depends on
this machine having run and pushed — GitHub cannot pull this data itself.
