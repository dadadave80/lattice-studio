import type { ParseIssue, Problem } from "@lattice-studio/core";

/** Exit codes (spec L921): 0 no blockers, 1 blockers, 2 invalid input, 3 catalog mismatch. */
export const EXIT = { ok: 0, blockers: 1, invalid: 2, catalog: 3 } as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Why a command stopped: the exit code, one sentence, and whatever details a `--json` reader needs. */
export type Failure = {
  exit: ExitCode;
  message: string;
  /** File validation issues, each with its file and path (spec L501). */
  issues?: ParseIssue[];
  /** The blockers that stopped an export. */
  problems?: Problem[];
};

export function invalid(message: string, issues?: ParseIssue[]): Failure {
  return issues === undefined ? { exit: EXIT.invalid, message } : { exit: EXIT.invalid, message, issues };
}

export function catalogMismatch(message: string): Failure {
  return { exit: EXIT.catalog, message };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
