import type { DecodeShareLinkFn, EncodeShareLinkFn } from "../model/api";
import { notImplemented } from "../model/wp";

export const encodeShareLink: EncodeShareLinkFn = () => notImplemented("C8", "encodeShareLink");
export const decodeShareLink: DecodeShareLinkFn = () => notImplemented("C8", "decodeShareLink");
