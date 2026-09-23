import type { FormatAddressFn, FormatCountFn, FormatDurationFn, FormatFeeFn, FormatGasFn, FormatKeysFn, FormatSelectorFn, FormatTimeFn, PluralFn } from "../model/api";
import { notImplemented } from "../model/wp";

export const formatSelector: FormatSelectorFn = () => notImplemented("C10", "formatSelector");
export const formatAddress: FormatAddressFn = () => notImplemented("C10", "formatAddress");
export const formatCount: FormatCountFn = () => notImplemented("C10", "formatCount");
export const formatGas: FormatGasFn = () => notImplemented("C10", "formatGas");
export const formatFee: FormatFeeFn = () => notImplemented("C10", "formatFee");
export const formatDuration: FormatDurationFn = () => notImplemented("C10", "formatDuration");
export const formatTime: FormatTimeFn = () => notImplemented("C10", "formatTime");
export const formatKeys: FormatKeysFn = () => notImplemented("C10", "formatKeys");
export const plural: PluralFn = () => notImplemented("C10", "plural");
