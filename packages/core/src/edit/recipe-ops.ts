import type { AddInitStepFn, ClearOwnerFn, ExcludeSelectorFn, IncludeSelectorFn, LoadRecipeFn, MoveInitStepFn, PlaceFacetFn, RemoveFacetsFn, RemoveInitStepFn, RouteSelectorFn, SetImmutableFn, SetInitArgFn } from "../model/api";
import { notImplemented } from "../model/wp";

export const placeFacet: PlaceFacetFn = () => notImplemented("C11", "placeFacet");
export const removeFacets: RemoveFacetsFn = () => notImplemented("C11", "removeFacets");
export const routeSelector: RouteSelectorFn = () => notImplemented("C11", "routeSelector");
export const clearOwner: ClearOwnerFn = () => notImplemented("C11", "clearOwner");
export const excludeSelector: ExcludeSelectorFn = () => notImplemented("C11", "excludeSelector");
export const includeSelector: IncludeSelectorFn = () => notImplemented("C11", "includeSelector");
export const loadRecipe: LoadRecipeFn = () => notImplemented("C11", "loadRecipe");
export const setInitArg: SetInitArgFn = () => notImplemented("C11", "setInitArg");
export const addInitStep: AddInitStepFn = () => notImplemented("C11", "addInitStep");
export const removeInitStep: RemoveInitStepFn = () => notImplemented("C11", "removeInitStep");
export const moveInitStep: MoveInitStepFn = () => notImplemented("C11", "moveInitStep");
export const setImmutable: SetImmutableFn = () => notImplemented("C11", "setImmutable");
