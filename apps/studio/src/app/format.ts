/** "0x3f2a…a1c4": a hash's first four and last four hex digits (spec L504, L679), as addresses are. */
export function shortHash(hash: string): string {
  return hash.length <= 10 ? hash : `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}
