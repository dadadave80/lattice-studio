/**
 * What the verify engine needs from the world (contracts §5.2 "chain/verify"): a fetch-shaped call for Sourcify,
 * Etherscan and the catalog's standard JSON, a clock for polling, and the deployment records. Plain interfaces, so
 * `engine.ts` stays free of the DOM and the network: unit tests pass fakes; `app-deps.ts` wires the real ones.
 */
import type { Deployment, Result } from "@lattice-studio/core";

/** A fetch-shaped call: the real `fetch` in the app, a scripted fake in tests. */
export type VerifyFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type VerifyClock = {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type VerifyRecords = {
  list(projectId: string): Promise<Deployment[]>;
  /** Rejects when the browser refuses the write; the engine says so and leaves the record as it was. */
  put(deployment: Deployment): Promise<void>;
};

/** The proxy's standard JSON and the compiler version to submit it with (spec L577). */
export type ProxyBuild = { stdJsonInput: unknown; compilerVersion: string };

export type VerifyDeps = {
  fetchImpl: VerifyFetch;
  clock: VerifyClock;
  records: VerifyRecords;
  /** The open project's id, for `retryVerification`'s lookup (records are looked up by [chainId, address] alone,
   * but the service's `list` still takes the project they belong to). */
  projectId(): string;
  /** The standard JSON for `chainId`'s proxy on the given deploy path: the catalog tag's build, or a
   * chain-specific factory's build commit (spec L577). */
  proxyBuild(chainId: number, path: Deployment["path"]): Promise<Result<ProxyBuild, string>>;
  /** Sourcify's base URL; overridable for tests. Default `https://sourcify.dev/server`. */
  baseUrl?: string;
  /** The Etherscan API key to verify with, or undefined when Etherscan verification isn't set up (`key.ts`). */
  etherscanKey(): string | undefined;
  /** Etherscan's API endpoint; overridable for tests. Default `https://api.etherscan.io/v2/api`. */
  etherscanBaseUrl?: string;
};
