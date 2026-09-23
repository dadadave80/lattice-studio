import type { ApplyLayoutFn, FlipPinsFn, MoveCardsFn, RecordPredictionFn, RenameProjectFn, SetCardPositionFn, SetExpandedFn } from "../model/api";
import { notImplemented } from "../model/wp";

export const renameProject: RenameProjectFn = () => notImplemented("C11", "renameProject");
export const moveCards: MoveCardsFn = () => notImplemented("C11", "moveCards");
export const setCardPosition: SetCardPositionFn = () => notImplemented("C11", "setCardPosition");
export const flipPins: FlipPinsFn = () => notImplemented("C11", "flipPins");
export const setExpanded: SetExpandedFn = () => notImplemented("C11", "setExpanded");
export const applyLayout: ApplyLayoutFn = () => notImplemented("C11", "applyLayout");
export const recordPrediction: RecordPredictionFn = () => notImplemented("C11", "recordPrediction");
