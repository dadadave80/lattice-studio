/**
 * S5e: the console drawer (the record of everything that happens, a command line that speaks every verb, the live
 * script and recipe) and the Export menu. Its `log` service, commands and the Safe batch dialog register from
 * `services.ts` and `commands.ts`.
 */
export { ConsolePanel } from "./ConsolePanel";
export { consoleSummary } from "./summary";
export type { Summary, SummaryInput, SummaryKind } from "./summary";
