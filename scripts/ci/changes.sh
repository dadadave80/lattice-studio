#!/usr/bin/env bash
# Which CI jobs a change needs (#45). Reads changed paths, one per line, on stdin (`git diff --name-only`) and
# prints `group=true|false` lines for $GITHUB_OUTPUT. `--all` prints every group true without reading stdin: the
# workflows pass it for workflow_dispatch runs and whenever there's no pull request diff to read.
#
# Groups and the jobs they gate:
#   code     check, bun test                  anything outside the docs-only set below
#   app      browser, e2e, Performance        what the app's build, its tests and the perf harness read
#   size     Size budgets                     app, plus the pitch decks (size.ts budgets every .js in dist)
#   golden   Golden tests                     golden/, plus the Foundry inputs every Foundry job shares
#   chain    Chain tests, Sepolia fork suite  e2e-chain/, plus the shared Foundry inputs
#   catalog  Catalog drift                    overlay/ and catalog-gen, plus the shared Foundry inputs
#
# Workflows, the lockfile, the root configs and this script run everything. A path no rule names counts as code,
# so a new folder runs check and bun test until it's mapped here.
set -euo pipefail

code=false app=false size=false golden=false chain=false catalog=false

all() { code=true app=true size=true golden=true chain=true catalog=true; }
foundry() { golden=true chain=true catalog=true; }

if [[ "${1:-}" == "--all" ]]; then
  all
else
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    # Markdown at the root (README, SECURITY, AGENTS…): no job reads it. Markdown inside a package folder
    # falls through to that folder's rule, since packages/tokens/README.md is checked by its own test.
    if [[ "$path" != */* && "$path" == *.md ]]; then continue; fi
    case "$path" in
      .github/workflows/* | .github/actions/* | bun.lock | package.json | bunfig.toml | tsconfig.base.json | .oxlintrc.json | .gitmodules | scripts/ci/changes.sh | scripts/ci/setup-metrics.ts)
        all ;;
      LICENSE | docs/* | skills/* | .github/*.md | .github/ISSUE_TEMPLATE/*)
        ;;
      apps/studio/public/pitch/*)
        code=true size=true ;;
      # Keep the inspection Anvil proofs' value-import dependencies here; register new suites in
      # e2e-chain/inspection.chain.test.ts too. UI-only edits still use the ordinary app rule below.
      apps/studio/local-env.ts | apps/studio/src/chain/deploy/viem-port.ts | \
      apps/studio/src/chain/infra/account.ts | apps/studio/src/chain/infra/probe.ts | \
      apps/studio/src/chain/inspect/*.anvil.test.ts | \
      apps/studio/src/chain/inspect/call.ts | apps/studio/src/chain/inspect/engine.ts | \
      apps/studio/src/chain/inspect/history-codec.ts | apps/studio/src/chain/inspect/history-deployment.ts | \
      apps/studio/src/chain/inspect/history.ts | apps/studio/src/chain/inspect/reads.ts | \
      apps/studio/src/chain/inspect/transaction-owner.ts | apps/studio/src/chain/inspect/transaction.ts | \
      apps/studio/src/chain/inspect/upgrade-authority.ts | apps/studio/src/chain/inspect/upgrade-controller.ts | \
      apps/studio/src/chain/inspect/upgrade-evidence.ts | apps/studio/src/chain/inspect/upgrade-plan.ts | \
      apps/studio/src/chain/inspect/upgrade-preflight.ts | apps/studio/src/chain/inspect/upgrade-records.ts | \
      apps/studio/src/chain/inspect/upgrade-tracking.ts | apps/studio/src/chain/inspect/upgrade-transport.ts)
        code=true app=true size=true chain=true ;;
      apps/studio/* | packages/tokens/* | fixtures/* | scripts/dev/* | scripts/perf/* | scripts/ci/size* | scripts/ci/react-compiler-dist-check* | scripts/ci/e2e-summary.ts)
        code=true app=true size=true ;;
      packages/core/* | catalog/*)
        code=true app=true size=true; foundry ;;
      lattice) # the submodule's gitlink: a pin move
        code=true; foundry ;;
      golden/*)
        code=true golden=true ;;
      e2e-chain/*)
        code=true chain=true ;;
      overlay/* | packages/catalog-gen/*)
        code=true catalog=true ;;
      *)
        code=true ;;
    esac
  done
fi

printf '%s\n' "code=$code" "app=$app" "size=$size" "golden=$golden" "chain=$chain" "catalog=$catalog"
