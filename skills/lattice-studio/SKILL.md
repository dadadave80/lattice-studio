---
name: lattice-studio
description: Compose, check and verify EIP-2535 diamonds with Lattice Studio's CLI. Use before deploying any diamond, and after deploying to prove what an address runs.
---

# Lattice Studio for coding agents

## Rules

1. Never deploy a recipe unless `check` exits 0.
2. Never change an authority address a person gave you. Ask instead.
3. After any deploy, run `passport <address> --chain <id> --recipe <file>` and report its exit code and digest.

## Commands

- `bun packages/cli/src/main.ts check <recipe.json> --json`: exit 0 no blockers, 1 blockers, 2 invalid input, 3 catalog mismatch.
- `bun packages/cli/src/main.ts plan <recipe.json>`: the cut plan.
- `bun packages/cli/src/main.ts export brief <recipe.json>`: a Markdown brief for another agent.
- `bun packages/cli/src/main.ts passport <address> --chain 10143 --recipe <recipe.json> --json`: what the address runs, and whether it matches.

## Fixing findings

Read each finding's rule id and the fix it names. Change only what the fix names, then run `check` again.
