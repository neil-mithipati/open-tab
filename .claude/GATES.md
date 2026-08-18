# Gates

`gates.json` is what the SubagentStop hook actually enforces. This file
explains it.

## Required

A builder must report each of these as `pass`. Reporting `n/a` on a
required gate is rejected — otherwise `n/a` is a loophole that turns the
gate into a suggestion.

- `lint`: `npm run lint`
- `test`: `npm run test`

## Pending

No script exists for these, so they are not enforced. Add the script, then
move the name into `required` in `gates.json` — re-running the install
preserves manual promotions.

- `typecheck`: no `npm run typecheck` script found

## Interim cover

While a gate is pending, the reviewer runs the underlying tool directly
rather than through npm — `npx tsc --noEmit` for typecheck, for example.
Slower than a script, but nothing merges unchecked. A pending gate is
covered by review, not by the hook.
