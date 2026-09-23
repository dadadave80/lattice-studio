# lattice-studio

Check, plan, predict and export [Lattice](https://github.com/dadadave80/lattice) diamond recipes from the command line, with the same analysis Lattice Studio runs in the browser. Built for CI and coding agents: `--json` output and stable exit codes.

```sh
bunx lattice-studio check recipe.json
```

The package bundles the catalog it checks against (the Lattice release its version was built with), so it needs nothing else and never touches the network unless you ask for readiness probes.

## Commands

| Command | Does |
| --- | --- |
| `check <file>` | Analyzes a `recipe.json` or `.lattice.json` project file: routing, problems, the cut plan |
| `plan <file>` | Shows the cut plan (`[00] ADD name, address, routed/total selectors`) and the init call |
| `predict` | Predicts the diamond's address for a deploying account (a Safe too, without connecting it) |
| `export foundry <file>` | Writes the standalone Foundry deploy script |
| `export brief <file>` | Writes the agent brief (Markdown) |
| `export recipe <file>` | Writes the normalized `recipe.json` with its `$schema` |
| `export safe <file>` | Writes a Safe Transaction Builder batch that deploys the diamond from the Safe |
| `verify-catalog` | Rebuilds the catalog from a Lattice checkout and compares it with the committed one |

## Exit codes

| Code | Means |
| --- | --- |
| 0 | No blockers |
| 1 | The recipe has blockers (Foundry and Safe exports refuse to write) |
| 2 | Invalid input: a bad flag, a file that doesn't validate, an RPC for the wrong chain |
| 3 | Catalog mismatch: the recipe is pinned to a catalog this CLI doesn't have, a catalog doesn't hash to its own hash, or the rebuilt catalog differs |

## Examples

Check a recipe in CI:

```sh
lattice-studio check recipe.json
lattice-studio check recipe.json --json > analysis.json   # mirrors the Analysis type
```

An authority address that came from the file (an admin, a Safe) blocks with LINK-01 until you confirm it in full:

```sh
lattice-studio check recipe.json --confirm 'steps[0].safe=0x5AFe00000000000000000000000000000000a11C'
```

Predict the address, and check chain readiness with read-only probes (the RPC comes from `--rpc`, `LATTICE_STUDIO_RPC_URL`, or the chain's public RPC; it's never printed):

```sh
lattice-studio predict --deployer 0xYourAccount --chain 11155111 --project governed-vault.lattice.json
lattice-studio check recipe.json --deployer 0xYourAccount --chain 11155111 --entropy 0x0102030405060708090a0b
```

The salt's entropy and scope come from `--project <file>`, or from `--entropy <11 bytes hex>` and `--scope every-chain|this-chain`. Without either, fresh entropy is drawn and printed on stderr so you can pass it again.

Export:

```sh
lattice-studio export foundry recipe.json --chain 11155111 --entropy 0x0102030405060708090a0b --out script/
lattice-studio export brief recipe.json --out BRIEF.md
lattice-studio export safe governed-vault.lattice.json --safe 0xYourSafe --chain 11155111 --out batch.safe.json
```

Exports are byte for byte what Studio writes for the same recipe, catalog and inputs.

Use another catalog (a `catalog/` folder with `manifest.json`, or one `catalog/<id>/` folder):

```sh
lattice-studio check recipe.json --catalog ../lattice-studio/catalog
```

Verify the catalog. This rebuilds it with Foundry 1.8.3 from a Lattice checkout at the catalog's tag, so it runs under Bun from a Lattice Studio checkout (it uses the checkout's `overlay/` and `catalog/`):

```sh
bun packages/cli/src/main.ts verify-catalog --lattice ../lattice
```

## Building

```sh
bun run --cwd packages/cli build   # dist/main.js, for Node 22 or later
```

The build bundles `@lattice-studio/core`, `@lattice-studio/catalog-gen` and the default catalog, so the tarball needs no workspace packages.
