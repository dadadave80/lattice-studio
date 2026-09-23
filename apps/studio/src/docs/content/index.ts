import { PROBLEM_CODES, type ProblemCode } from "@lattice-studio/core";
import { CORE_DEP_STO } from "./core-dep-sto";
import { INIT_AUTH_LINK } from "./init-auth-link";
import { NET } from "./net";
import { SEL_SEM } from "./sel-sem";
import type { ProblemDocEntry } from "./types";

const ALL: readonly ProblemDocEntry[] = [...SEL_SEM, ...CORE_DEP_STO, ...INIT_AUTH_LINK, ...NET];

const BY_CODE: Partial<Record<ProblemCode, ProblemDocEntry>> = {};
for (const entry of ALL) {
  if (BY_CODE[entry.code]) throw new Error(`Problem doc content has two entries for ${entry.code}.`);
  BY_CODE[entry.code] = entry;
}
for (const code of PROBLEM_CODES) {
  if (!BY_CODE[code]) throw new Error(`Problem doc content is missing ${code}.`);
}

/** Every problem code's doc content, checked complete against `PROBLEM_CODES` at module load. */
export const PROBLEM_DOC_CONTENT: Readonly<Record<ProblemCode, ProblemDocEntry>> = BY_CODE as Record<ProblemCode, ProblemDocEntry>;

/** All entries, in `PROBLEM_CODES` order (the checks table's order, spec L309-L342), for the index. */
export const PROBLEM_DOC_ENTRIES: readonly ProblemDocEntry[] = PROBLEM_CODES.map((code) => PROBLEM_DOC_CONTENT[code]);

export type { DocFamily, ProblemDocEntry } from "./types";
