# Agent status

Updated 2026-08-18 21:16 UTC · regenerated on every task completion.

## Spend

No spend data. The poller may not be running:

```
./.claude/hooks/spend-poll.sh &
curl -s localhost:9464/metrics | head   # must return output
```

## Agents

| Role | Lane | Started | Running |
|---|---|---|---|
| builder-light | . | 2026-08-18T21:12:12Z | 2 |
| publisher | . | 2026-08-18T21:12:15Z | 1 |
| reviewer | . | 2026-08-18T21:15:45Z | 2 |

## Tasks

| ID | State | Task | Tier |
|---|---|---|---|
| `OT-100` | todo | Make main lint-clean — fix pre-existing lint errors blocking the gate — null | builder |
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

## Recent activity

```
2026-08-18T21:14:32Z  .  SubagentStop  
2026-08-18T21:15:05Z  .  SubagentStop  
2026-08-18T21:15:05Z  .  SubagentStop  
2026-08-18T21:15:05Z  .  SubagentStop  
2026-08-18T21:15:05Z  .  SubagentStop  
2026-08-18T21:15:05Z  .  SubagentStop  
2026-08-18T21:15:15Z  .  SubagentStop  builder
2026-08-18T21:15:32Z  .  SubagentStop  builder
2026-08-18T21:15:45Z  .  SubagentStart  reviewer
2026-08-18T21:15:45Z  .  SubagentStart  reviewer
2026-08-18T21:16:17Z  .  SubagentStop  
2026-08-18T21:16:17Z  .  SubagentStop  
2026-08-18T21:16:17Z  .  SubagentStop  
2026-08-18T21:16:17Z  .  SubagentStop  
2026-08-18T21:16:17Z  .  SubagentStop  
2026-08-18T21:16:48Z  .  SubagentStop  
2026-08-18T21:16:48Z  .  SubagentStop  
2026-08-18T21:16:48Z  .  SubagentStop  
2026-08-18T21:16:48Z  .  SubagentStop  
2026-08-18T21:16:48Z  .  SubagentStop  
```

---

Generated locally and pushed to the `status` branch. Freshness depends on
this machine having run and pushed — GitHub cannot pull this data itself.
