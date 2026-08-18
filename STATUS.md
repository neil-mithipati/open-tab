# Agent status

Updated 2026-08-18 22:17 UTC · regenerated on every task completion.

## Spend

| Lane | Spent | Cap | Used |
|---|---|---|---|
| . | $9.61 | $40.00 | ██░░░░░░░░ 24% |

## Agents

| Role | Lane | Started | Running |
|---|---|---|---|
| builder-light | . | 2026-08-18T21:12:12Z | 2 |
| builder-deep | . | 2026-08-18T22:00:31Z | 3 |
| reviewer | . | 2026-08-18T22:07:46Z | 6 |
| builder | . | 2026-08-18T22:13:58Z | 6 |
| publisher | . | 2026-08-18T22:14:02Z | 7 |

## Tasks

| ID | State | Task | Tier |
|---|---|---|---|
| `OT-100` | done | Make main lint-clean — fix pre-existing lint errors blocking the gate — null | builder-deep |
| `OT-101` | done | Fail loudly when NEXT_PUBLIC_APP_URL is unset in production — null | builder |
| `OT-102` | done | "Parse route: derive image URL server-side, stop echoing error internals, set maxDuration" — null | builder |
| `OT-103` | done | "RLS: stop publishing every profile; caller check on add_friendship" — null | builder-deep |
| `OT-104` | done | Compress receipt photos client-side before upload; cap size and MIME server-side — null | builder |
| `OT-105` | done | Atomic save path — replace browser-side delete-then-reinsert with a server action; unique participant constraint — null | builder-deep |
| `OT-106` | running | Allocate rounding remainders so charges sum to the total — null | builder |
| `OT-107` | todo | Rate-limit the parse route and share/claim actions — null | builder |
| `OT-108` | todo | Add indexes on all foreign keys — null | builder-light |
| `OT-109` | todo | "Toast system: share/save errors surface, link-copied confirms" — null | builder |
| `OT-110` | todo | Privacy policy page — null | builder-light |
| `OT-111` | todo | Account deletion — user-initiated, complete, confirmed — null | builder-deep |
| `OT-112` | todo | Document NEXT_PUBLIC_APP_URL in .env.example — null | builder-light |
| `OT-113` | todo | ReceiptEditPage still delete-then-reinserts from the browser — route it through saveReceiptState — null | builder |

## Recent activity

```
2026-08-18T22:16:04Z  .  SubagentStop  
2026-08-18T22:16:04Z  .  SubagentStop  
2026-08-18T22:16:04Z  .  SubagentStop  
2026-08-18T22:16:04Z  .  SubagentStop  
2026-08-18T22:16:04Z  .  SubagentStop  
2026-08-18T22:16:35Z  .  SubagentStop  
2026-08-18T22:16:35Z  .  SubagentStop  
2026-08-18T22:16:35Z  .  SubagentStop  
2026-08-18T22:16:35Z  .  SubagentStop  
2026-08-18T22:16:35Z  .  SubagentStop  
2026-08-18T22:17:06Z  .  SubagentStop  
2026-08-18T22:17:06Z  .  SubagentStop  
2026-08-18T22:17:06Z  .  SubagentStop  
2026-08-18T22:17:06Z  .  SubagentStop  
2026-08-18T22:17:06Z  .  SubagentStop  
2026-08-18T22:17:38Z  .  SubagentStop  
2026-08-18T22:17:38Z  .  SubagentStop  
2026-08-18T22:17:38Z  .  SubagentStop  
2026-08-18T22:17:38Z  .  SubagentStop  
2026-08-18T22:17:38Z  .  SubagentStop  
```

---

Generated locally and pushed to the `status` branch. Freshness depends on
this machine having run and pushed — GitHub cannot pull this data itself.
