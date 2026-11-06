/** The analyzer's chunk (`analyzer.ts`): core's analysis and narration, and every check they run. */
import { analyze, analyzeUpgrade, narrate } from "@lattice-studio/core";
import type { Analyzer } from "./analyzer";

export const ANALYZER: Analyzer = { analyze, analyzeUpgrade, narrate };
