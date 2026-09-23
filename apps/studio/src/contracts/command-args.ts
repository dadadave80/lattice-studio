/**
 * The argument shapes of commands that one module runs and another registers (contracts §5.3), so work
 * packages built in parallel agree without guessing. Problem fixes (contracts §3.3, `PROBLEMS`) use the same
 * shapes. The owner's `command<CommandArgsOf<"facet.place">>({ … })` and a caller's
 * `commandRef("facet.place", { facet: "ERC20" })` both check against this table.
 *
 * Commands not listed take no arguments (`{}`), unless their owner adds a row through a CCR.
 */
import type {
  Address, Arg, CommandId, CommandRef, DeployPath, Hex4, Json, ProblemCode, Scope,
} from "@lattice-studio/core";
import type { ThemeChoice } from "./stores";
import type { RegionId } from "./regions";

/** A point on the sheet, in sheet units. */
export type SheetPoint = { x: number; y: number };
export type Direction = "left" | "right" | "up" | "down";

export type CommandArgsMap = {
  // S1: document edits
  /** Place at `at` (else beside the selection, else the view center). */
  "facet.place": { facet: string; at?: SheetPoint };
  "facet.remove": { facets: string[] };
  /** Route all of `facet`'s contested selectors to it (`route <facet>`). */
  "facet.routeContested": { facet: string };
  /** `verb: "keep"` titles it Keep {facet} instead of Route to {facet} (SEL-01). */
  "selector.route": { selector: Hex4; facet: string; verb?: "keep" };
  "selector.clearOwner": { selector: Hex4 };
  "selector.exclude": { selector: Hex4 };
  /** `facet` routes it when it's contested. */
  "selector.include": { selector: Hex4; facet?: string };
  /** A template name from the catalog ("GovernedVault"). */
  "recipe.load": { name: string };
  "recipe.replace": { name: string };
  /** `path` as C4a's field paths: "bundle.p.asset", "steps[2].admin". `value` is a recipe `Arg`. */
  "init.setArg": { path: string; value: Arg };
  "init.addStep": { spec: string };
  /** A step path: "steps[2]". */
  "init.removeStep": { path: string };
  /** Moves the step at `path` to index `to` (0-based). */
  "init.moveStep": { path: string; to: number };
  "ack.set": { problemId: string };
  /** Without `facets`, the selection. */
  "layout.flipPins": { facets?: string[] };
  "layout.toggleExpand": { facet: string };
  "project.rename": { name: string };
  // S3
  "pane.toggle": { pane: "left" | "inspector" | "console" };
  "pane.show": { pane: "sheet" | "catalog" | "structure" | "inspector" | "console" };
  // S4b
  /** `zoom` as a factor: 1 is 100%. */
  "sheet.zoomTo": { zoom: number };
  /** Selects and centers the card, and the pin when `selector` is given. */
  "sheet.locate": { facet: string; selector?: Hex4 };
  // S4e
  /** Nudge the selection by the Nudge step setting (IR L23). */
  "sheet.nudge": { dir: Direction; step: "small" | "large" };
  "sheet.focusDirection": { dir: Direction };
  "sheet.addFacetHere": { at?: SheetPoint };
  /** S6. `mode: "facets"` is Add facet here…: facets only, placed at `at` (CCR from S6). */
  "palette.open": { mode?: "facets"; at?: SheetPoint };
  "selector.copy": { selector: Hex4; facet?: string };
  "selector.copySignature": { selector: Hex4; facet?: string };
  "selector.showOwner": { selector: Hex4 };
  // S4c
  "problem.focus": { problemId: string };
  "collision.choosePerSelector": { selectors: Hex4[] };
  // S5a
  "catalog.preview": { facet: string };
  // S5c
  "inspector.show": { facet?: string };
  "inspector.focusSelectors": { facet: string };
  "dependency.compare": { options: string[] };
  "deploy.compare": { chainId: number; address: Address };
  // S5d
  /** `focus`: an argument path, a step path ("steps[0]"), "examples" or "authority". */
  "init.open": { focus?: string };
  "init.focusField": { path: string };
  "init.confirmAddress": { path: string };
  "authority.chooseMechanism": { preset?: "safe" | "governance" };
  // S5e
  "export.safe": { safe?: Address; chainId?: number };
  // S7b
  /** No id: pick a file (⌘O, App menu Open…). */
  "project.open": { id?: string };
  "project.duplicate": { id: string };
  "project.delete": { id: string };
  "project.restore": { id: string };
  "project.deleteForGood": { id: string };
  // S8a
  "chain.select": { chainId: number };
  // S8b
  "deploy.open": { chainId?: number };
  "deploy.usePath": { path: DeployPath };
  "deploy.setScope": { scope: Scope };
  "deploy.previewFor": { address: Address };
  // S8c
  "deploy.missingContracts": { names?: string[] };
  // S8d
  "deploy.retryVerification": { chainId: number; address: Address };
  // S9
  /** "Go to inspector" (IR L16). */
  "region.focus": { region: RegionId };
  // S10
  "theme.set": { theme: ThemeChoice };
  // S12
  /** Without `code`, the help index. */
  "help.open": { code?: ProblemCode };
  // S13
  "catalog.migrate": { target?: string };
};

/** The arguments `id` takes: its row above, else none. */
export type CommandArgsOf<I extends CommandId> = I extends keyof CommandArgsMap ? CommandArgsMap[I] : Record<string, never>;

/** A typed `CommandRef`: `commandRef("region.focus", { region: "inspector" })`. */
export function commandRef<I extends CommandId>(
  id: I,
  ...args: Record<string, never> extends CommandArgsOf<I> ? [args?: CommandArgsOf<I>] : [args: CommandArgsOf<I>]
): CommandRef {
  const [given] = args;
  return given === undefined ? { id } : { id, args: given as Record<string, Json> };
}
