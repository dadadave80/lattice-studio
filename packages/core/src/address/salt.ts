import type { AssertSaltSenderFn, BuildSaltFn, NewEntropyFn } from "../model/api";
import { notImplemented } from "../model/wp";

export const buildSalt: BuildSaltFn = () => notImplemented("C5b", "buildSalt");
export const assertSaltSender: AssertSaltSenderFn = () => notImplemented("C5b", "assertSaltSender");
export const newEntropy: NewEntropyFn = () => notImplemented("C5b", "newEntropy");
