/**
 * The component-test harness (contracts §1: K2, then frozen). Browser tests import from here:
 *
 *   const screen = await renderWithStudio(<CatalogPanel />, { project, theme: "light" });
 *   const chain = fakeChainService({ account });   // then pass { chain } to renderWithStudio
 *   const clock = fakeClock({ at: "2026-09-23T12:00:00Z", timers: vi });
 *   overrideCommands([command({ id: "layout.tidy", … })]);
 *   seedDeployState({ phase: "proposed", safe, chainId: 11155111 });
 *   expect(bufferedServices().log.at(-1)?.text).toBe("Tidied 14 facets.");
 *
 * Everything installed here is undone after each test. `bun test` files import `./clock`, `./chain` or
 * `./overrides` directly: this barrel pulls in the browser renderer and the Vite-only fixture loader.
 */
export { fixtureCatalog } from "./catalog";
export {
  CREATEX_CODEHASH, FAKE_CHAINS, FAKE_CONNECTORS, fakeChainService, GAS_CAP, healthyChainState, MULTICALL3_CODEHASH,
} from "./chain";
export type { FakeChain, FakeChainCall, FakeChainOptions } from "./chain";
export { onCleanup } from "./cleanup";
export { fakeClock } from "./clock";
export type { FakeClock, FakeClockOptions, FakeTimers } from "./clock";
export { overrideCommands, pristineCommands, seedDeployState } from "./overrides";
export { renderWithStudio, seedStudio } from "./render";
export type { StudioOptions } from "./render";
export { bufferedServices } from "@/contracts/services";
