# Lattice Passport

Lattice Passport reads a deployed EIP-2535 diamond and records what its loupe routes, which facets match releases in
the bundled Lattice catalog, and who holds `owner()` when that selector is routed. With a recipe, it compares the
on-chain routing with the plan the CLI computes from that recipe and catalog. When cut history is available, it
identifies the deployment transaction and every later `DiamondCut`; the output carries a digest anyone can recompute
from the same facts.

## What it doesn't prove

A passport does not prove storage values such as a token's name or symbol, the safety of Lattice's code (which is
unaudited), or that an RPC answered honestly. Cross-check the reads with a second RPC by running the same command
with another `--rpc <url>` and comparing the block, claims, and digest.

## Command and claims

```sh
bun packages/cli/src/main.ts passport <address> --chain 10143 --recipe recipe.json --json
```

| Claim | What it establishes |
| --- | --- |
| PP-01 | Code is deployed at the address. |
| PP-02 | The address answers the EIP-2535 `facets()` loupe. |
| PP-03 | Every routed facet's runtime code hash matches a release in a bundled catalog, or is identified as the diamond itself. |
| PP-04 | Selector routing matches the plan computed from `--recipe`. |
| PP-05 | The recipe uses a catalog bundled with this CLI. |
| PP-06 | No `DiamondCut` occurred after the deployment transaction. |
| PP-07 | The earliest cut's transaction, sender and target identify the deployment path. |
| PP-08 | The value returned by `owner()` when the diamond routes that selector. |

| Exit code | Meaning |
| --- | --- |
| 0 | Every claim passes, warns or is skipped. |
| 1 | At least one claim fails. |
| 2 | Invalid input or the chain couldn't be read. |
| 3 | The recipe was made against a different catalog. |

Without `--recipe`, PP-04 and PP-05 are skipped. Without cut history, PP-06 and PP-07 are skipped. PP-08 is skipped
when `owner()` is not routed. A failed or unknown claim stays visible in the JSON and the human-readable output.

## JSON and digest

The JSON includes the chain id, address and block; the catalog tag and hash; an optional recipe hash; identified
facets with their code hashes and selectors; deployment and cut history when available; authority; all eight claims;
and the source used for state reads and logs. Unknown `catalog`, `recipeHash`, `deployment`, `history` and `authority`
values are `null`; a facet's code hash is `null` when its address is the diamond itself.

`digest` is keccak256 of the canonical JSON containing every other field: object keys are sorted at every depth and
there is no whitespace. Arrays retain their order. The passport has no timestamp, so the same block and facts produce
the same digest.

## Data sources

The selected chain RPC supplies state: code, `facets()`, facet code, and `owner()` when routed. If
`ENVIO_API_TOKEN` is set, cut history uses Envio HyperRPC for Monad Testnet, Monad mainnet, Sepolia and Base Sepolia.
Otherwise, pass `--from-block <n>` to read logs through the selected RPC. Fast chains can accumulate many blocks
between deploy and review, while public RPCs limit `eth_getLogs` ranges; HyperRPC indexes the history and lets the
CLI split requests when a provider refuses a range. If neither source is available, the passport says that history
was not read and skips PP-06 and PP-07.

## Privacy

Identify mode needs no recipe. Verify mode reads the recipe locally, computes its plan and sends only chain reads to
the RPC; the recipe is not uploaded to Studio or Envio. The RPC provider sees the diamond and facet addresses that
the CLI reads. Envio sees the diamond address whose cut history it returns.

## In CI

```yaml
- run: bun packages/cli/src/main.ts passport ${{ vars.DIAMOND }} --chain 10143 --recipe recipe.json --json --out passport.json
  env:
    ENVIO_API_TOKEN: ${{ secrets.ENVIO_API_TOKEN }}
```

## Roadmap

An on-chain recipe hash can anchor passports after Studio re-pins to Lattice v0.5.0, whose `DiamondDeployed` event
carries `recipeHash`. Passkey-signed passports could be verified through Monad's P256 precompile. Studio could act
as an ERC-8004 validator once a Validation Registry is canonical on Monad.
