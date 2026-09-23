/**
 * S8a's registration (contracts §5.2 "chain"): `chainService()` loads the chain module through the lazy boundary
 * (spec L822). Under Vitest (`env.test`) the real module stays unregistered, so no component test fetches wagmi
 * by accident: tests serve `fakeChainService()` through the harness instead.
 */
import { env, provideServices } from "@/contracts";
import { chainLoader } from "./loader";

if (!env.test) provideServices({ chain: () => chainLoader.load() });
