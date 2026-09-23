/**
 * Work-package ids and the typed "not built yet" throw that every stub uses until its owner lands.
 * The ids are the build plan's (`plan/wp.json`); `PROBLEMS` and `COMMAND_OWNERS` name their owners with them.
 */

export const WP_IDS = [
  "K1", "T1", "K3", "K2",
  "C1", "C2", "C3", "C4a", "C4b", "C4c", "C5a", "C5b", "C5c", "C6", "C7a", "C7b", "C7c", "C8", "C9", "C10", "C11", "C12",
  "CG1", "CG2", "CG3", "CG4", "CG5", "CG6", "CG7", "CG8",
  "GT1", "GT1b", "GT2", "CLI1",
  "S0", "S1", "S2", "S3", "S4a", "S4b", "S4c", "S4d", "S4e", "S5a", "S5b", "S5c", "S5d", "S5e", "S6", "S7a", "S7b",
  "S8a", "S8b", "S8c", "S8d", "S9", "S10", "S11a", "S11b", "S12", "S13", "S14",
  "Q0", "Q1a", "Q1b", "Q1c", "Q1d", "Q1e", "Q2", "Q3", "Q4", "Q5", "Q6", "REL1",
] as const;

export type WpId = (typeof WP_IDS)[number];

/**
 * Thrown by a public core function whose work package hasn't landed. The message is exactly
 * `Not built yet · WP-<id>`, so a UI boundary can show it verbatim; `fn` names the function.
 * This is the one throw core allows besides programmer errors: expected failures return `Result`.
 */
export class NotImplemented extends Error {
  readonly wp: WpId;
  readonly fn: string;

  constructor(wp: WpId, fn: string) {
    super(`Not built yet · WP-${wp}`);
    this.name = "NotImplemented";
    this.wp = wp;
    this.fn = fn;
  }
}

/** The body of every stub: `export const analyze: Analyze = () => notImplemented("C2", "analyze")`. */
export function notImplemented(wp: WpId, fn: string): never {
  throw new NotImplemented(wp, fn);
}

/** Guard for boundaries that degrade instead of crashing (spec: "Not built yet · WP-<id>"). */
export function isNotImplemented(error: unknown): error is NotImplemented {
  return error instanceof NotImplemented;
}
