import type { CommandName } from "./args";

export const USAGE = `Usage: lattice-studio <command> [options]

Commands:
  check <file>            Check a recipe.json or .lattice.json project file: routing, problems, cut plan
  plan <file>             Show the cut plan and the init call
  predict                 Predict the diamond's address for a deploying account (or a Safe) on a chain
  export foundry <file>   Write the standalone Foundry deploy script
  export brief <file>     Write the agent brief (Markdown)
  export recipe <file>    Write the normalized recipe.json with its $schema
  export safe <file>      Write a Safe Transaction Builder batch that deploys the diamond
  verify-catalog          Rebuild the catalog from a Lattice checkout and compare it with the committed one

Options:
  --json                  Machine-readable output (check mirrors the Analysis type)
  --catalog <dir>         Use the catalogs in <dir> (catalog/ or catalog/<id>/) instead of the bundled one
  --deployer <address>    The deploying account: resolves "Deploying account" and "This diamond"
  --chain <id>            The chain; on check and plan it adds read-only readiness probes
  --rpc <url>             RPC for the probes (default: the chain's public RPC; also LATTICE_STUDIO_RPC_URL)
  --path factory|createx  LatticeFactory (default) or CreateX CREATE3
  --project <file>        Read the salt entropy, scope and path from a .lattice.json project file
  --entropy <hex>         11 bytes of salt entropy (without it, and without --project, fresh entropy is drawn and printed)
  --scope every-chain|this-chain
  --safe <address>        The Safe that deploys (export safe)
  --confirm <path>=<address>
                          Confirm an authority address that came from the file (LINK-01), in full
  --out <file|dir>        Write the export there instead of to stdout
  --lattice <dir>         The Lattice checkout to rebuild from (verify-catalog)
  -h, --help              Show this help
  --version               Show the version

Exit codes: 0 no blockers, 1 blockers, 2 invalid input, 3 catalog mismatch.`;

const EXAMPLES: Record<CommandName, string> = {
  check: `lattice-studio check recipe.json
lattice-studio check governed-vault.lattice.json --json
lattice-studio check recipe.json --deployer 0x… --chain 11155111 --rpc http://127.0.0.1:8545`,
  plan: "lattice-studio plan recipe.json",
  predict: `lattice-studio predict --deployer 0x… --chain 11155111 --project governed-vault.lattice.json
lattice-studio predict --deployer 0x… --chain 8453 --path createx --entropy 0x… --scope this-chain`,
  "export foundry": "lattice-studio export foundry recipe.json --chain 11155111 --entropy 0x… --out script/",
  "export brief": "lattice-studio export brief recipe.json --out BRIEF.md",
  "export recipe": "lattice-studio export recipe governed-vault.lattice.json --out recipe.json",
  "export safe": "lattice-studio export safe governed-vault.lattice.json --safe 0x… --chain 11155111 --out batch.json",
  "verify-catalog": "bun packages/cli/src/main.ts verify-catalog --lattice ../lattice",
};

/** The usage, with examples for one command when it's named. */
export function usageFor(command?: CommandName): string {
  if (command === undefined) return USAGE;
  return `${USAGE}\n\nExamples (${command}):\n${EXAMPLES[command]
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")}`;
}
