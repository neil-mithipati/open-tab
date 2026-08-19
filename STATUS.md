# Agent status

Updated 2026-08-19 13:04 UTC · regenerated on every task completion.

## Spend

| Lane | Spent | Cap | Used |
|---|---|---|---|
| open-tab | $1.3 | $10.00 | █░░░░░░░░░ 12% |

## Agents

| Role | Lane | Started | Running |
|---|---|---|---|
| builder | default | 2026-08-19T12:26:57Z | 2 |
| publisher | open-tab | 2026-08-19T13:04:25Z | 3 |

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
| `OT-108` | running | Add indexes on all foreign keys — null | builder-light |
| `OT-109` | todo | "Toast system: share/save errors surface, link-copied confirms" — null | builder |
| `OT-110` | todo | Privacy policy page — null | builder-light |
| `OT-111` | todo | Account deletion — user-initiated, complete, confirmed — null | builder-deep |
| `OT-112` | running | Document NEXT_PUBLIC_APP_URL in .env.example — null | builder-light |
| `OT-113` | todo | ReceiptEditPage still delete-then-reinserts from the browser — route it through saveReceiptState — null | builder |

## Recent activity

```
2026-08-19T12:29:08Z  default  SubagentStop  
2026-08-19T12:29:08Z  default  SubagentStop  
2026-08-19T12:29:08Z  default  SubagentStop  
2026-08-19T12:29:40Z  default  SubagentStop  
2026-08-19T12:29:40Z  default  SubagentStop  
2026-08-19T12:29:40Z  default  SubagentStop  
2026-08-19T12:29:40Z  default  SubagentStop  
2026-08-19T12:29:40Z  default  SubagentStop  
2026-08-19T12:30:13Z  default  SubagentStop  
2026-08-19T12:30:13Z  default  SubagentStop  
2026-08-19T12:30:13Z  default  SubagentStop  
2026-08-19T12:30:13Z  default  SubagentStop  
2026-08-19T12:30:13Z  default  SubagentStop  
2026-08-19T13:04:25Z  open-tab  SubagentStart  publisher
2026-08-19T13:04:25Z  open-tab  SubagentStart  publisher
2026-08-19T13:04:57Z  open-tab  SubagentStop  
2026-08-19T13:04:57Z  open-tab  SubagentStop  
2026-08-19T13:04:57Z  open-tab  SubagentStop  
2026-08-19T13:04:57Z  open-tab  SubagentStop  
2026-08-19T13:04:57Z  open-tab  SubagentStop  
```

---

Generated locally and pushed to the `status` branch. Freshness depends on
this machine having run and pushed — GitHub cannot pull this data itself.
