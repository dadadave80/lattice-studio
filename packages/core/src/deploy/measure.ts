import type { CalldataHashFn, GasShareFn } from "../model/api";
import { notImplemented } from "../model/wp";

export const calldataHash: CalldataHashFn = () => notImplemented("C5c", "calldataHash");
export const gasShare: GasShareFn = () => notImplemented("C5c", "gasShare");
