/**
 * Recipes for Flows 4-6 (spec L432-L455), built against the real catalog the e2e build serves (Q0's `catalog()`),
 * the same way `_support/projects.ts` builds Flow 1-3's. Verified against `analyze()` in Node before being
 * turned into specs (see the WP-Q1b report): every scenario below names exactly the problems its comment says,
 * nothing more, so a spec's assertions aren't guessing at what the checks produce.
 *
 * - Flow 4's own example (spec L432) is the real catalog's: AxelarGatewayAdapter and HyperlaneGatewayAdapter both
 *   export `sendMessage(bytes,bytes,bytes[])` 0xcdfe7f5c and `supportsAttribute(bytes4)` 0xdc680a0f.
 *   LayerZeroGatewayAdapter exports both too, for the three-or-more-contenders owner menu (spec L434).
 * - Flow 5's own example (spec L443) is the real catalog's too: VaultCore requires ERC4626 (hard, one option:
 *   the catalog has no hard requirement with more than one option, so "Compare options…" never has real data to
 *   show; see the WP-Q1b report's spec gap).
 * - The DEP-02 companion example (spec L449, "GovernedDiamondCut … EmergencyStop") is illustrative; the real
 *   catalog's blank diamond already carries the same pattern for its own cut facet, AccessControlDiamondCut, with
 *   zero blockers, which is what a "never blocks" test needs. `governedDiamondCutConvention()` also exists for
 *   the literal facet name, but it always carries an extra INIT-04 blocker (no init step wired for it), so
 *   `blankConvention()` is what "Deploy enables" tests use.
 * - Flow 6's seam example (spec L441, L453) is the real catalog's: GovernedVault ships ERC20Votes's seam over
 *   `transfer`/`transferFrom`; placing ERC20Pausable next to it raises no choice for those two selectors and
 *   SEL-03 says ERC20Pausable cuts nothing (spec L442). The catalog's seam reason is "updates vote checkpoints",
 *   not the spec prose's paraphrase "moves vote checkpoints" (Interpretations in the WP-Q1b report).
 * - Governor and Votes collide on two selectors with no other requirement and no init step: the "clean" fixture
 *   for "Deploy enables once no blockers remain" (spec L438), where Axelar/Hyperlane's own INIT-04 would get in
 *   the way.
 */
import {
  blankDiamond, loadTemplate, type Catalog, type Project, type Recipe,
} from "@lattice-studio/core";
import { catalog as builtCatalog } from "../_support/catalog.ts";
import { projectFor, type ProjectOptions } from "../_support/projects.ts";

const CATALOG: Catalog = builtCatalog();

function recipeWith(names: readonly string[], owners: Record<string, string> = {}, exclude: readonly `0x${string}`[] = []): Recipe {
  const blank = blankDiamond(CATALOG);
  return { ...blank, facets: [...new Set([...blank.facets, ...names])], owners, exclude: [...exclude] };
}

function toProject(recipe: Recipe, name: string, options: ProjectOptions = {}): Project {
  return projectFor(recipe, name, options, CATALOG);
}

// ── Flow 4: collisions ──────────────────────────────────────────────────────────────────────────────────────

/** SEL-01 for `sendMessage` and `supportsAttribute`; two contenders (spec L432-L438). Also carries INIT-04 for
 * both adapters (neither has an init step in the catalog), which is why this fixture never reaches zero blockers. */
export function twoWayCollision(): Project {
  return toProject(recipeWith(["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"]), "Two-way collision");
}

/** The same collision with only Axelar placed, for seeding the "before" state and placing Hyperlane in-test to
 * see the Collision console line narrate (narration only fires on a change, never on load). */
export function beforeTwoWayCollision(): Project {
  return toProject(recipeWith(["AxelarGatewayAdapter"]), "Before two-way collision");
}

/** SEL-01 for the same pair, three contenders: Axelar, Hyperlane and LayerZero all export both selectors
 * (spec L434's "Owner: {A} ▾" menu). */
export function threeWayCollision(): Project {
  return toProject(recipeWith(["AxelarGatewayAdapter", "HyperlaneGatewayAdapter", "LayerZeroGatewayAdapter"]), "Three-way collision");
}

/** Governor and Votes collide on `CLOCK_MODE()` and `clock()`, with no other requirement and no init step: the
 * only blockers are the two SEL-01s, so resolving both leaves zero blockers (spec L438's "Deploy enables"). */
export function cleanCollision(): Project {
  return toProject(recipeWith(["Governor", "Votes"]), "Clean collision");
}

/** `cleanCollision` with both selectors already routed to Governor: zero blockers, Deploy should be enabled. */
export function cleanCollisionResolved(): Project {
  return toProject(recipeWith(["Governor", "Votes"], { "0x4bf5d7e9": "Governor", "0x91ddadf4": "Governor" }), "Clean collision, resolved");
}

// ── Flow 5: dependencies ────────────────────────────────────────────────────────────────────────────────────

/** DEP-01: VaultCore requires ERC4626, one option (spec L443-L445's own example, verbatim in the real catalog). */
export function missingDependency(): Project {
  return toProject(recipeWith(["VaultCore"]), "Missing dependency");
}

/** `missingDependency` with ERC4626 already placed: the dependency is met, nothing missing. */
export function metDependency(): Project {
  return toProject(recipeWith(["VaultCore", "ERC4626"]), "Met dependency");
}

/** The real catalog's blank diamond: DEP-02 companion (AccessControlDiamondCut ships with EmergencyStop, spec
 * L449's pattern) with zero blockers — what "a convention never blocks" needs. */
export function blankConvention(): Project {
  return toProject(recipeWith([]), "Blank convention");
}

/** `blankConvention` with EmergencyStop already placed: the convention note is gone. */
export function blankConventionMet(): Project {
  return toProject(recipeWith(["EmergencyStop"]), "Blank convention met");
}

// ── Flow 6: routing and excluding by hand ───────────────────────────────────────────────────────────────────

/** GovernedVault, filled, plus ERC20Pausable: a live seam over `transfer`/`transferFrom` (spec L441-L442,
 * L453), and ERC20Votes's own uncontested selectors to exclude and bring back by hand (Flow 6). */
export function seamRecipe(): Project {
  const loaded = loadTemplate(CATALOG, "GovernedVault");
  if (!loaded.ok) throw new Error(loaded.error);
  const recipe: Recipe = { ...loaded.value, facets: [...loaded.value.facets, "ERC20Pausable"] };
  return toProject(recipe, "Seam recipe");
}

/** `seamRecipe` with `transfer` forced onto ERC20Pausable before the seam applied: SEM-01 blocks it (spec
 * L442's "an owner chosen before the seam applied routes it outside its allowed facets"). */
export function seamOverrideRecipe(): Project {
  const loaded = loadTemplate(CATALOG, "GovernedVault");
  if (!loaded.ok) throw new Error(loaded.error);
  const recipe: Recipe = {
    ...loaded.value,
    facets: [...loaded.value.facets, "ERC20Pausable"],
    owners: { ...loaded.value.owners, "0xa9059cbb": "ERC20Pausable" },
  };
  return toProject(recipe, "Seam override");
}

export { CATALOG as catalog };
