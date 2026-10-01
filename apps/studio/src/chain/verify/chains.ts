/**
 * Chains Sourcify's public server never serves: local and ephemeral test networks a deploy target on the real
 * internet is never one of (contracts §5.5's Anvil is 31337, only in end-to-end builds). Kept local to this
 * module: a routine `bun run test:chain` or e2e run against a local Anvil deploy must never reach
 * `https://sourcify.dev`, so this is checked before every submission, not just before the watcher picks a
 * record up. A CCR in the WP-S8d report asks for a proper chains-Sourcify-serves allowlist once Studio settles
 * its verified-chains policy; until then this needs nothing as Studio's own chain list grows, since a real
 * target is never one of these ids.
 */
const NEVER_VERIFY: Readonly<Record<number, string>> = {
  31337: "Anvil",
  1337: "Ganache",
};

/** Whether Sourcify could plausibly verify a contract on `chainId`. */
export function sourcifyServes(chainId: number): boolean {
  return !(chainId in NEVER_VERIFY);
}

/**
 * Chains Sourcify serves and Etherscan's API V2 doesn't (`https://api.etherscan.io/v2/chainlist`): HSKChain
 * Testnet's explorer is Blockscout.
 */
const NOT_ON_ETHERSCAN: ReadonlySet<number> = new Set([133]);

/** Whether Etherscan's API V2 could verify a contract on `chainId`. Where it can't, Etherscan is never asked. */
export function etherscanServes(chainId: number): boolean {
  return sourcifyServes(chainId) && !NOT_ON_ETHERSCAN.has(chainId);
}

/** "Anvil", or "this chain" for an id this module doesn't name. */
export function unverifiableChainName(chainId: number): string {
  return NEVER_VERIFY[chainId] ?? "this chain";
}
