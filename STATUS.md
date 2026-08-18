# Agent status

Updated 2026-08-18 21:33 UTC · regenerated on every task completion.

## Spend

| Lane | Spent | Cap | Used |
|---|---|---|---|
| . | $9.61 | $40.00 | ██░░░░░░░░ 24% |

## Agents

| Role | Lane | Started | Running |
|---|---|---|---|
| builder-light | . | 2026-08-18T21:12:12Z | 2 |
| builder | . | 2026-08-18T21:26:26Z | 2 |
| publisher | . | 2026-08-18T21:26:30Z | 2 |
| builder-deep | . | 2026-08-18T21:30:24Z | 1 |
| reviewer | . | 2026-08-18T21:32:51Z | 3 |

## Tasks

| ID | State | Task | Tier |
|---|---|---|---|
| `OT-100` | running | Make main lint-clean — fix pre-existing lint errors blocking the gate — null | builder-deep |
| `OT-101` | running | Fail loudly when NEXT_PUBLIC_APP_URL is unset in production — null | builder |
| `OT-102` | todo | "Parse route: derive image URL server-side, stop echoing error internals, set maxDuration" — null | builder |
| `OT-103` | todo | "RLS: stop publishing every profile; caller check on add_friendship" — null | builder-deep |
| `OT-104` | todo | Compress receipt photos client-side before upload; cap size and MIME server-side — null | builder |
| `OT-105` | todo | Atomic save path — replace browser-side delete-then-reinsert with a server action; unique participant constraint — null | builder-deep |
| `OT-106` | todo | Allocate rounding remainders so charges sum to the total — null | builder |
| `OT-107` | todo | Rate-limit the parse route and share/claim actions — null | builder |
| `OT-108` | todo | Add indexes on all foreign keys — null | builder-light |
| `OT-109` | todo | "Toast system: share/save errors surface, link-copied confirms" — null | builder |
| `OT-110` | todo | Privacy policy page — null | builder-light |
| `OT-111` | todo | Account deletion — user-initiated, complete, confirmed — null | builder-deep |
| `OT-112` | todo | Document NEXT_PUBLIC_APP_URL in .env.example — null | builder-light |

## Recent activity

```
2026-08-18T21:31:27Z  .  SubagentStop  
2026-08-18T21:31:27Z  .  SubagentStop  
2026-08-18T21:31:58Z  .  SubagentStop  
2026-08-18T21:31:58Z  .  SubagentStop  
2026-08-18T21:31:58Z  .  SubagentStop  
2026-08-18T21:31:58Z  .  SubagentStop  
2026-08-18T21:31:58Z  .  SubagentStop  
2026-08-18T21:32:29Z  .  SubagentStop  
2026-08-18T21:32:29Z  .  SubagentStop  
2026-08-18T21:32:29Z  .  SubagentStop  
2026-08-18T21:32:29Z  .  SubagentStop  
2026-08-18T21:32:29Z  .  SubagentStop  
2026-08-18T21:32:50Z  .  SubagentStop  builder-deep
2026-08-18T21:32:51Z  .  SubagentStart  reviewer
2026-08-18T21:32:51Z  .  SubagentStart  reviewer
2026-08-18T21:33:22Z  .  SubagentStop  
2026-08-18T21:33:22Z  .  SubagentStop  
2026-08-18T21:33:22Z  .  SubagentStop  
2026-08-18T21:33:22Z  .  SubagentStop  
2026-08-18T21:33:22Z  .  SubagentStop  
```

---

Generated locally and pushed to the `status` branch. Freshness depends on
this machine having run and pushed — GitHub cannot pull this data itself.
