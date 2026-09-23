import type { ContentBoundsFn, FreeSlotFn, PushBelowFn } from "../model/api";
import { notImplemented } from "../model/wp";

export const freeSlot: FreeSlotFn = () => notImplemented("C9", "freeSlot");
export const pushBelow: PushBelowFn = () => notImplemented("C9", "pushBelow");
export const contentBounds: ContentBoundsFn = () => notImplemented("C9", "contentBounds");
