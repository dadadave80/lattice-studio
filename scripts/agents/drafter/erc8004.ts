/**
 * Prints the `cast` commands that register the Drafter on Monad testnet's ERC-8004 IdentityRegistry and give it
 * feedback on the ReputationRegistry. It sends nothing; David runs the commands with his own keystores.
 *
 *   bun scripts/agents/drafter/erc8004.ts register --agent-uri <url>
 *   bun scripts/agents/drafter/erc8004.ts feedback --agent-id <n> --passport <passport.json> --passport-uri <url>
 */
import { readFileSync } from "node:fs";

const IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const REPUTATION = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
const RPC = "https://testnet-rpc.monad.xyz";

export type PassportFile = { kind?: unknown; digest?: unknown; claims?: { id: string; status: string }[] };

export function registerCommands(agentUri: string): string[] {
  return [
    `cast send ${IDENTITY} "register(string)" "${agentUri}" --account monad-deployer --rpc-url ${RPC}`,
    `cast receipt <tx hash> --json --rpc-url ${RPC}`,
    `cast keccak "Registered(uint256,string,address)"   # topic 0; the agentId is topic 1 of that log`,
  ];
}

export function feedbackCommand(agentId: string, digest: string, passportUri: string): string {
  return `cast send ${REPUTATION} "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)" ${agentId} 100 0 "lattice-passport" "pass" "" "${passportUri}" ${digest} --account monad-verifier --rpc-url ${RPC}`;
}

/** Null when the passport earns feedback; otherwise why it doesn't. */
export function checkPassport(passport: PassportFile): string | null {
  if (passport.kind !== "lattice-passport/v1") return "That file isn't a lattice-passport/v1 passport.";
  if (typeof passport.digest !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(passport.digest)) return "The passport has no digest.";
  const failedClaims = (passport.claims ?? []).filter((c) => c.status === "fail").map((c) => c.id);
  return failedClaims.length > 0 ? `Refused: ${failedClaims.join(", ")} failed, so the Drafter earns no feedback for this contract.` : null;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

export function main(argv: readonly string[]): number {
  if (argv[0] === "register") {
    const uri = flag(argv, "--agent-uri");
    if (uri === undefined) {
      process.stderr.write("register needs --agent-uri <url>.\n");
      return 2;
    }
    process.stdout.write(`${registerCommands(uri).join("\n")}\n`);
    return 0;
  }
  if (argv[0] === "feedback") {
    const agentId = flag(argv, "--agent-id");
    const file = flag(argv, "--passport");
    const uri = flag(argv, "--passport-uri");
    if (agentId === undefined || file === undefined || uri === undefined || !/^[0-9]+$/.test(agentId)) {
      process.stderr.write("feedback needs --agent-id <n>, --passport <file> and --passport-uri <url>.\n");
      return 2;
    }
    const passport = JSON.parse(readFileSync(file, "utf8")) as PassportFile;
    const refusal = checkPassport(passport);
    if (refusal !== null) {
      process.stderr.write(`${refusal}\n`);
      return 1;
    }
    process.stdout.write(`${feedbackCommand(agentId, String(passport.digest), uri)}\n`);
    return 0;
  }
  process.stderr.write("Use: erc8004.ts register --agent-uri <url>, or erc8004.ts feedback --agent-id <n> --passport <file> --passport-uri <url>.\n");
  return 2;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
