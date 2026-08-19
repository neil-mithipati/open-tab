| feature | benefit |
|---|---|
| Typecheck gate fixed on main (OT-116) | Internal build hygiene, no user-facing change. Two stale errors in test files (`src/__tests__/setup.ts`, `ReceiptSplitStep.test.tsx`) were making the required `typecheck` gate fail on main, which meant no task in the backlog could be honestly marked done. Fixing both unblocked every other task's gate; 187 tests across 12 files still pass. |
