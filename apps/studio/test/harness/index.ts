/**
 * The component-test harness (contracts §1: K2, then frozen). Browser tests import from here:
 *
 *   const screen = await renderWithStudio(<CatalogPanel />, { project, theme: "draft" });
 *   const chain = fakeChainService({ account });   // then pass { chain } to renderWithStudio
 *   const clock = fakeClock({ at: "2026-09-23T12:00:00Z", timers: vi });
 *
 * `bun test` files import `./clock` or `./chain` directly: this barrel pulls in the browser renderer.
 */
export { fixtureCatalog, hasFixtureCatalog } from "./catalog";
export { FAKE_CHAINS, fakeChainService, healthyChainState } from "./chain";
export type { FakeChain, FakeChainCall, FakeChainOptions } from "./chain";
export { onCleanup } from "./cleanup";
export { fakeClock } from "./clock";
export type { FakeClock, FakeClockOptions, FakeTimers } from "./clock";
export { renderWithStudio, seedStudio } from "./render";
export type { StudioOptions } from "./render";
export { bufferedServices } from "@/contracts/services";
export { snapshotCommands } from "@/contracts/commands";
