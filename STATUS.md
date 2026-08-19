# Agent status

Updated 2026-08-19 21:12 UTC · regenerated on every task completion.

## Spend

| Lane | Spent | Cap | Used |
|---|---|---|---|
| open-tab | $35.32 | $100.00 | ███░░░░░░░ 35% |

## Agents

| Role | Lane | Started | Running |
|---|---|---|---|
| publisher | open-tab | 2026-08-19T21:03:46Z | 1 |
| reviewer | open-tab | 2026-08-19T21:09:07Z | 4 |

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
| `OT-110` | **blocked** | Privacy policy page — >- | builder |
| `OT-111` | running | Account deletion — user-initiated, complete, confirmed — null | builder-deep |
| `OT-112` | done | Document NEXT_PUBLIC_APP_URL in .env.example — null | builder |
| `OT-113` | done | ReceiptEditPage still delete-then-reinserts from the browser — route it through saveReceiptState — null | builder |
| `OT-114` | done | Parallel-cap counter drifts +1 per builder — asymmetric log-event hook wiring — null | builder |
| `OT-115` | running | "Rate-limit hardening: parse limiter is bypassable by replay (HIGH), plus fail-open silence, off-by-one ceiling, no 429 UI" — null | builder-deep |
| `OT-116` | done | Make main typecheck-clean — two pre-existing errors block the required gate for every task — null | builder |
| `OT-117` | running | parallel-cap hook fails open on a torn events.jsonl line; stale comment misleads — null | builder-deep |
| `OT-118` | done | Save and share failures are still swallowed on three call sites; Done can wedge — null | builder |
| `OT-119` | todo | new/page.tsx — untracked 1.5s timer hijacks navigation; Done still races Share — null | builder |

## Recent activity

```
2026-08-19T21:11:40Z  open-tab  SubagentStop  
2026-08-19T21:11:40Z  open-tab  SubagentStop  
2026-08-19T21:11:40Z  open-tab  SubagentStop  
2026-08-19T21:11:40Z  open-tab  SubagentStop  
2026-08-19T21:11:40Z  open-tab  SubagentStop  
2026-08-19T21:11:45Z  open-tab  SubagentStop  
2026-08-19T21:11:45Z  open-tab  SubagentStop  
2026-08-19T21:11:45Z  open-tab  SubagentStop  
2026-08-19T21:11:45Z  open-tab  SubagentStop  
2026-08-19T21:11:45Z  open-tab  SubagentStop  
2026-08-19T21:12:06Z  open-tab  SubagentStop  
2026-08-19T21:12:06Z  open-tab  SubagentStop  
2026-08-19T21:12:06Z  open-tab  SubagentStop  
2026-08-19T21:12:06Z  open-tab  SubagentStop  
2026-08-19T21:12:06Z  open-tab  SubagentStop  
2026-08-19T21:12:11Z  open-tab  SubagentStop  
2026-08-19T21:12:11Z  open-tab  SubagentStop  
2026-08-19T21:12:11Z  open-tab  SubagentStop  
2026-08-19T21:12:11Z  open-tab  SubagentStop  
2026-08-19T21:12:11Z  open-tab  SubagentStop  
```

---

Generated locally and pushed to the `status` branch. Freshness depends on
this machine having run and pushed — GitHub cannot pull this data itself.
