/**
 * @internal For the review's browser tests: a fake deploy controller that records every call and plays any state,
 * a deployable copy of the fixture catalog (a fixture tag can't deploy, contracts §4), projects from the catalog's
 * templates, and `renderReview` that opens the dialog the way the app does. Never imported by the app.
 */
import type { Address, Catalog, Project, Recipe } from "@lattice-studio/core";
import { loadTemplate, toChecksum } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { expect } from "vitest";
import { page } from "vitest/browser";
import {
  getAnalysis, openDialog, provideDeployController, provideServices, type DeployController, type DeployState,
  type WalletAccount,
} from "@/contracts";
import { DialogHost } from "@/ui";
import { fakeChainService, fixtureCatalog, onCleanup, renderWithStudio, type FakeChain, type StudioOptions } from "../../../test/harness";
import { provideFeeReader, type FeeReader } from "./fees";
import { resetReviewState } from "./review-state";

export const SEPOLIA = 11155111;
export const BASE_SEPOLIA = 84532;
/** Anvil's first account. */
export const ALICE: Address = toChecksum("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");

export function account(patch: Partial<WalletAccount> = {}): WalletAccount {
  return { address: ALICE, chainId: SEPOLIA, connector: "io.metamask", kind: "eoa", balance: 10n ** 18n, ...patch };
}

let deployable: Catalog | null = null;

/** The fixture catalog under a release tag, so Deploy isn't disabled as a fixture (contracts §4). */
export function deployableCatalog(): Catalog {
  deployable ??= { ...fixtureCatalog(), lattice: { ...fixtureCatalog().lattice, tag: "v0.4.0" } };
  return deployable;
}

/** A project holding a catalog template ("ERC20", "GovernedVault", "SafeDiamondCut"). */
export function templateProject(name: string, patch: Partial<Project> = {}, catalog: Catalog = deployableCatalog()): Project {
  const recipe = loadTemplate(catalog, name);
  if (!recipe.ok) throw new Error(recipe.error);
  return makeProject({ name, recipe: recipe.value, ...patch });
}

export function withRecipe(project: Project, recipe: Recipe): Project {
  return { ...project, recipe };
}

export type ControllerCall = { method: keyof DeployController; args: unknown[] };

export type FakeController = DeployController & {
  readonly calls: ControllerCall[];
  /** Merges `patch` into the state and tells subscribers. */
  set(patch: Partial<DeployState>): void;
  methods(): string[];
};

/**
 * A deploy controller that records every call. `open()` snapshots the analysis' recipe hash and enters Review, and
 * `changed()` marks the review changed and simulating, as contracts §5.2 describes; everything else only records,
 * so a test plays the rest with `set`.
 */
export function fakeDeployController(initial: DeployState = { phase: "idle" }): FakeController {
  let state: DeployState = initial;
  const listeners = new Set<(s: DeployState) => void>();
  const calls: ControllerCall[] = [];
  const record = (method: keyof DeployController, args: unknown[] = []) => calls.push({ method, args });
  const set = (patch: Partial<DeployState>) => {
    state = { ...state, ...patch };
    for (const listener of Array.from(listeners)) listener(state);
  };
  const fake: FakeController = {
    calls,
    set,
    methods: () => calls.map((c) => c.method),
    state: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    open() {
      record("open");
      set({ phase: "review", snapshot: getAnalysis().recipeHash, changedSinceReview: false });
    },
    changed() {
      record("changed");
      set({ phase: "simulating", changedSinceReview: true });
    },
    async sign(options) {
      record("sign", options === undefined ? [] : [options]);
    },
    proposed(batch) {
      record("proposed", [batch]);
    },
    async deployMissing(names) {
      record("deployMissing", [names]);
    },
    keepWaiting: () => record("keepWaiting"),
    checkWallet: () => record("checkWallet"),
    reviewAgain: () => record("reviewAgain"),
    discardProposal: () => record("discardProposal"),
    retry: () => record("retry"),
    close: () => record("close"),
  };
  return fake;
}

/** Serves `controller` from `deployController()` for this test. */
export function installController(controller: DeployController): void {
  onCleanup(provideDeployController(async () => controller));
}

/** Serves fees from `reader` for this test (default: about 0.001 ETH, at most 0.002 ETH). */
export function installFees(reader?: FeeReader): void {
  onCleanup(provideFeeReader(reader ?? (async () => ({ ok: true, value: { about: 10n ** 15n, max: 2n * 10n ** 15n } }))));
}

/** Takes the connection offline for this test. */
export function goOffline(): void {
  onCleanup(provideServices({ connection: { isOnline: () => false, subscribe: () => () => {} } }));
}

export type ReviewOptions = Omit<StudioOptions, "chain"> & {
  chain?: FakeChain;
  controller?: FakeController;
  at?: "review" | "progress";
  /** The fee reader; default a fixed quote, `false` leaves the real one. */
  fees?: FeeReader | false;
};

/**
 * Renders the dialog host with the stores seeded (a deployable catalog, Sepolia selected, a connected account and a
 * healthy chain unless the options say otherwise), opens the review and waits for it.
 */
export async function renderReview(options: ReviewOptions = {}) {
  const catalog = options.catalog === undefined ? deployableCatalog() : options.catalog;
  const chain = options.chain ?? fakeChainService({ account: account(), ...(catalog ? { catalog } : {}) });
  const controller = options.controller ?? fakeDeployController();
  installController(controller);
  if (options.fees !== false) installFees(options.fees);
  resetReviewState();
  onCleanup(resetReviewState);
  // Served before the session selects the chain, so S1's chain mirror (the prediction's account) finds it.
  chain.install();
  const { chain: _chain, controller: _controller, at: _at, fees: _fees, ...studio } = options;
  const screen = await renderWithStudio(<DialogHost />, {
    ...studio,
    catalog,
    session: { chainId: SEPOLIA, ...options.session },
  });
  openDialog("deploy-review", { at: options.at ?? "review" });
  const dialog = page.getByRole("dialog");
  await expect.element(dialog).toBeVisible();
  return { screen, dialog, chain, controller };
}

/** A section of the open review by its title. */
export function section(title: string) {
  return page.getByRole("region", { name: title, exact: true });
}
