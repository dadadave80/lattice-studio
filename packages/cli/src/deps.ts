import type { Random } from "@lattice-studio/core";
import type { VerifyOptions } from "@lattice-studio/catalog-gen/verify";
import type { Transport } from "viem";

/**
 * Everything the CLI takes from the outside world, injected so tests run commands in-process with fakes and
 * nothing in `src/` reaches for a clock, randomness or the network on its own.
 */
export type Deps = {
  /** Resolves relative paths in arguments. */
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  /** Raw writes: exports go to stdout byte for byte. */
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  random: Random;
  /** Milliseconds since the epoch (the Safe batch's `createdAt`, probe times). */
  now: () => number;
  /** The RPC transport for readiness probes; viem's `http(url)` by default. */
  transport?: (url: string) => Transport;
  /** catalog-gen's generator for `verify-catalog`; injectable so tests needn't run Foundry. */
  generate?: VerifyOptions["generate"];
  /** `verify-catalog` needs Bun: catalog-gen runs Foundry through `Bun.spawn` and reads the overlay with `Bun.YAML`. */
  hasBun: boolean;
};

/** The real world, for `main.ts`. */
export function processDeps(): Deps {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    random: (bytes) => crypto.getRandomValues(new Uint8Array(bytes)),
    now: () => Date.now(),
    hasBun: typeof (globalThis as { Bun?: unknown }).Bun !== "undefined",
  };
}
