import type { Hex } from "@lattice-studio/core";

/** A recipe hash as the console writes it: 6 + 4 (spec L679, `0x3f2a…a1c4`). */
export function shortHash(hash: Hex): string {
  return hash.length <= 10 ? hash : `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}
