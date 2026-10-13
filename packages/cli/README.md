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
| `passport <address>` | Identifies a deployed diamond, compares its routing with a recipe, and reports cut history and authority |
| `verify-catalog` | Rebuilds the catalog from a Lattice checkout and compares it with the committed one |

## Exit codes

| Code | Means |
| --- | --- |
| 0 | No blockers |
| 1 | The recipe has blockers (Foundry and Safe exports refuse to write) |
| 2 | Invalid input: a bad flag, a file that doesn't validate, an RPC for the wrong chain |
| 3 | Catalog mismatch: the recipe is pinned to a catalog this CLI doesn't have, a catalog doesn't hash to its own hash, the rebuilt catalog differs, or a passport recipe uses an unbundled catalog |

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

Predict the address, and check chain readiness with read-only probes. The RPC comes from `--rpc`, `LATTICE_STUDIO_RPC_URL`, or the chain's public RPC. The CLI says which one it reads through (a public RPC by its host, yours never by its URL); the RPC provider sees the addresses it reads. With `--json`, `readiness` is `online` or `offline` (the RPC isn't answering, so the chain checks didn't run):

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

## passport

    lattice-studio passport <address> --chain <id> [--recipe <file>] [--rpc <url>] [--from-block <n>] [--json] [--out <file>]

Reads a deployed diamond at one block and reports eight claims: code at the address (PP-01), an EIP-2535 loupe
(PP-02), every facet a release in a bundled catalog (PP-03), routing that matches `--recipe` (PP-04) and its catalog
(PP-05), no cuts since the deployment (PP-06), the deployment transaction (PP-07) and `owner()` (PP-08). It reads only
and never signs.

Exit codes: 0 when no claim fails, 1 when one does, 2 for invalid input or a chain that can't be read, 3 when the
recipe's catalog isn't bundled. `--json` prints the passport and `--out` writes it. Its `digest` is keccak256 of the
passport's canonical JSON without the digest (keys sorted, no whitespace), so anyone can recompute it at the same block.

Cut history comes from Envio HyperRPC when `ENVIO_API_TOKEN` is set (chains 10143, 143, 11155111 and 84532), else from
the RPC starting at `--from-block`. Without either, PP-06 and PP-07 are skipped.

## Building

```sh
bun run --cwd packages/cli build   # dist/main.js, for Node 22 or later
```

The build bundles `@lattice-studio/core`, `@lattice-studio/catalog-gen` and the default catalog, so the tarball needs no workspace packages.
