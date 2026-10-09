/** The analyzer's chunk (`analyzer.ts`): core's analysis and narration, and every check they run. */
import { analyze, narrate } from "@lattice-studio/core";
import type { Analyzer } from "./analyzer";

export const ANALYZER: Analyzer = { analyze, narrate };
