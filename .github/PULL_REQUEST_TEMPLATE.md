## What this changes

<!-- One or two sentences: what now works, or what's fixed. -->

## Accessibility states

Every state this PR touches that's drawn on the Claude Design States boards has a browser test and a
screenshot baseline in both themes (spec "Design stays in step with code"). Check what applies:

- [ ] Keyboard path: every action this PR adds or changes is reachable and operable without a mouse
- [ ] Focus is visible after every action (placement, deletion, undo, dialog close)
- [ ] Accessible names: `aria-label`/`aria-labelledby` on every control this PR adds; `aria-disabled` carries
      a stated reason, never a bare disabled control
- [ ] Both themes (Shop and Draft) render correctly
- [ ] Reduced motion respected (`prefers-reduced-motion`)
- [ ] `axe` run locally against the states this PR adds or changes (`bun run e2e`), clean or with findings noted
      below

## Budgets

- [ ] `bun scripts/ci/size.ts --build` passes, or the table below explains what grew and why
- [ ] No new dependency outside `.handoff/plan/contracts.md` §2 (a WP never adds one; say so in the PR body if
      one is needed)

## Testing

- [ ] `bun run check` passes
- [ ] `bun test` passes
- [ ] Relevant browser/e2e/golden/chain suites pass locally (name which)

## Notes

<!-- Interpretations, CCRs, follow-ups, anything a reviewer should know. -->
