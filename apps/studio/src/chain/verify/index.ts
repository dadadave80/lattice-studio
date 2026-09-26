/**
 * WP-S8d, Sourcify verification (contracts §5.2 "chain/verify"). `commands.ts` and `services.ts` register at
 * module evaluation (see `contracts/discover.ts`); everything else here is for another module that needs more
 * than the `deploy.retryVerification` command, without loading the engine's chunk: `forgeVerifyCommand` for a
 * "copy the equivalent command" affordance (spec L577), a Follow-up for S5c to wire in.
 */
export { forgeVerifyCommand } from "./copy";
export type { ProxyBuild, VerifyClock, VerifyDeps, VerifyFetch, VerifyRecords } from "./ports";
