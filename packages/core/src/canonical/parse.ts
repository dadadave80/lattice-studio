import type { ParseProjectFileFn, ParseProjectFn, ParseRecipeFn } from "../model/api";
import { notImplemented } from "../model/wp";

export const parseRecipe: ParseRecipeFn = () => notImplemented("C1", "parseRecipe");
export const parseProject: ParseProjectFn = () => notImplemented("C1", "parseProject");
export const parseProjectFile: ParseProjectFileFn = () => notImplemented("C1", "parseProjectFile");
