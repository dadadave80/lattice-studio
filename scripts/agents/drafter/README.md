# Lattice Drafter

Drafts Lattice recipes from plain English with Qwen 3.8 Max. The model calls Lattice Studio's own CLI as tools and may
finish only when `check` exits 0. It never deploys and never signs: a person reads the plan, confirms any authority
address in Studio, and deploys.

    DRAFTER_API_KEY=… bun scripts/agents/drafter/drafter.ts "An ERC20 called Metro Credits with symbol MCR" --out .drafts/mcr.recipe.json

| Variable | Default |
| --- | --- |
| `DRAFTER_API_KEY` | None, required; never logged or written |
| `DRAFTER_BASE_URL` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| `DRAFTER_MODEL` | `qwen3.8-max` |
| `DRAFTER_DISABLE_THINKING` | Unset; `1` sends `enable_thinking: false` |

Each run writes the recipe and `<out>.transcript.json`: every tool call with its exit code and rule ids, and the final
recipe hash. `erc8004.ts` prints the commands that register the Drafter on Monad testnet's ERC-8004 registries and
credit it when a deployed diamond's passport has no failed claim.
