/**
 * S4e's commands (contracts §5.3): selecting, moving, nudging and reaching cards from the keyboard (IR L14-L31,
 * spec L749-L766), removing the selection, Add facet here…, and the pin menu's copies and Show owner (IR L195).
 *
 * Here: ids, titles, keys and `enabled`, in the first load. What each one does is in `runs.ts`, part of the
 * interactions runtime (`runtime.ts`). Every command says what it did or why it didn't (contracts §6). Moves,
 * nudges, Move to… and removes edit the document, so they return the session's read-only reason from `enabled()`
 * while one is set.
 */
import type { CommandId, Hex4 } from "@lattice-studio/core";
import { plural } from "@lattice-studio/core";
import {
  command, defineCommands, doc, session, type Command, type CommandArgs, type CommandContext, type Direction,
  type Enablement, type KeyBinding, type KeyContext,
} from "@/contracts";
import type { Runs } from "./runs";
import { loadedRuntime, loadRuntime, type Runtime } from "./runtime";

const SHEET: KeyContext[] = ["sheet"];
const SHEET_AND_ROWS: KeyContext[] = ["sheet", "card-rows"];
const OK: Enablement = { ok: true };

export const EMPTY_SHEET = "The sheet is empty";
export const NO_SELECTION = "Select a card first";
export const NOTHING_SELECTED = "Nothing is selected";
export const NAME_A_SELECTOR = "Name a selector";

const DIRECTIONS: readonly Direction[] = ["left", "right", "up", "down"];
const ARROW_KEYS: Readonly<Record<Direction, string>> = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown" };
const DIRECTION_WORDS: Readonly<Record<Direction, string>> = {
  left: "to the left of", right: "to the right of", up: "above", down: "below",
};

function refuse(reason: string): Enablement {
  return { ok: false, reason };
}

function readOnly(ctx: CommandContext): Enablement | null {
  return ctx.session.readOnly === null ? null : refuse(ctx.session.readOnly);
}

function hasCards(ctx: CommandContext): boolean {
  return Object.keys(ctx.project.layout).length > 0;
}

function placed(layout: Readonly<Record<string, unknown>>, selection: readonly string[]): string[] {
  return selection.filter((name) => Object.hasOwn(layout, name));
}

function selected(ctx: CommandContext): string[] {
  return placed(ctx.project.layout, ctx.session.selection);
}

function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && (DIRECTIONS as readonly string[]).includes(value);
}

function isHex4(value: unknown): value is Hex4 {
  return typeof value === "string" && /^0x[0-9a-f]{8}$/.test(value);
}

/** The command's run, in the runtime: at once when it has loaded, else once it has. */
function run<I extends keyof Runs & CommandId>(id: I): Command["run"] {
  return (ctx: CommandContext, args: CommandArgs) => {
    const call = (r: Runtime) => (r.runs[id] as (ctx: CommandContext, args: CommandArgs) => void | Promise<void>)(ctx, args);
    const r = loadedRuntime();
    return r ? call(r) : loadRuntime().then(async (loaded) => {
      await call(loaded);
    });
  };
}

// ── Selection ─────────────────────────────────────────────────────────────────────────────────────────

const selectAll = command({
  id: "sheet.selectAll",
  title: () => "Select all cards",
  category: "Sheet",
  keys: ["Mod+a"],
  keyContext: SHEET_AND_ROWS,
  palette: true,
  enabled: (ctx) => (hasCards(ctx) ? OK : refuse(EMPTY_SHEET)),
  run: run("sheet.selectAll"),
});

const clearSelection = command({
  id: "sheet.clearSelection",
  title: () => "Clear the selection",
  category: "Sheet",
  palette: true,
  enabled: (ctx) => (ctx.session.selection.length > 0 ? OK : refuse(NOTHING_SELECTED)),
  run: run("sheet.clearSelection"),
});

// ── Moving ────────────────────────────────────────────────────────────────────────────────────────────

const moveTo = command({
  id: "sheet.moveTo",
  // A verb and its object (contracts §6); menus show "Move to…" through their label.
  title: () => "Move the selection to…",
  category: "Sheet",
  keys: ["m"],
  keyContext: SHEET,
  palette: true,
  enabled(ctx) {
    // On while it's on: M again leaves it, as Esc does.
    if (ctx.session.modes.moveTo) return OK;
    return readOnly(ctx) ?? (selected(ctx).length > 0 ? OK : refuse(NO_SELECTION));
  },
  run: run("sheet.moveTo"),
});

/** "Nudge the selection left", "Nudge the selection left, large step". */
function nudgeTitle(dir: Direction, step: unknown): string {
  return `Nudge the selection ${dir}${step === "large" ? ", large step" : ""}`;
}

function nudgeBindings(): KeyBinding[] {
  return DIRECTIONS.flatMap((dir) => [
    { name: dir, keys: [ARROW_KEYS[dir]], args: { dir, step: "small" }, label: nudgeTitle(dir, "small") },
    { name: `${dir}-large`, keys: [`Shift+${ARROW_KEYS[dir]}`], args: { dir, step: "large" }, label: nudgeTitle(dir, "large") },
  ]);
}

const nudge = command({
  id: "sheet.nudge",
  title: ({ dir, step }) => (isDirection(dir) ? nudgeTitle(dir, step) : "Nudge the selection"),
  category: "Sheet",
  bindings: nudgeBindings(),
  keyContext: SHEET,
  enabled(ctx, { dir }) {
    if (!isDirection(dir)) return refuse("Nudge takes left, right, up or down");
    // With nothing selected the arrows scroll the sheet (spec L766), which read-only allows.
    if (selected(ctx).length === 0) return OK;
    return readOnly(ctx) ?? OK;
  },
  run: run("sheet.nudge"),
});

// ── Focus ─────────────────────────────────────────────────────────────────────────────────────────────

function focusBindings(): KeyBinding[] {
  return DIRECTIONS.map((dir) => ({ name: dir, keys: [`Mod+${ARROW_KEYS[dir]}`], args: { dir } }));
}

const focusDirection = command({
  id: "sheet.focusDirection",
  title: ({ dir }) => (isDirection(dir) ? `Focus the card ${DIRECTION_WORDS[dir]} this one` : "Focus the nearest card"),
  category: "Sheet",
  bindings: focusBindings(),
  keyContext: SHEET_AND_ROWS,
  enabled(ctx, { dir }) {
    if (!isDirection(dir)) return refuse("Focus moves left, right, up or down");
    return hasCards(ctx) ? OK : refuse(EMPTY_SHEET);
  },
  run: run("sheet.focusDirection"),
});

const focusFirst = command({
  id: "sheet.focusFirst",
  title: () => "Focus the first card",
  category: "Sheet",
  keys: ["Home"],
  keyContext: SHEET,
  enabled: (ctx) => (hasCards(ctx) ? OK : refuse(EMPTY_SHEET)),
  run: run("sheet.focusFirst"),
});

const focusLast = command({
  id: "sheet.focusLast",
  title: () => "Focus the last card",
  category: "Sheet",
  keys: ["End"],
  keyContext: SHEET,
  enabled: (ctx) => (hasCards(ctx) ? OK : refuse(EMPTY_SHEET)),
  run: run("sheet.focusLast"),
});

const enterRows = command({
  id: "sheet.enterRows",
  title: () => "Go into the card's rows",
  category: "Sheet",
  keys: ["Enter"],
  keyContext: SHEET,
  enabled: (ctx) => (hasCards(ctx) ? OK : refuse(EMPTY_SHEET)),
  run: run("sheet.enterRows"),
});

// ── Removing and placing ──────────────────────────────────────────────────────────────────────────────

const removeSelected = command({
  id: "facet.removeSelected",
  title: () => {
    const names = placed(doc.get().layout, session.get().selection);
    if (names.length === 1) return `Remove ${names[0] ?? ""}`;
    return names.length > 1 ? `Remove ${plural(names.length, "facet")}` : "Remove the selected facets";
  },
  category: "Build",
  keys: ["Delete", "Backspace"],
  keyContext: SHEET_AND_ROWS,
  palette: true,
  enabled: (ctx) => readOnly(ctx) ?? (selected(ctx).length > 0 ? OK : refuse("Select a facet to remove")),
  run: run("facet.removeSelected"),
});

const addFacetHere = command({
  id: "sheet.addFacetHere",
  title: () => "Add facet here…",
  category: "Sheet",
  enabled: (ctx) => readOnly(ctx) ?? OK,
  run: run("sheet.addFacetHere"),
});

// ── Pins ──────────────────────────────────────────────────────────────────────────────────────────────

/** Whether a facet in the catalog (the named one first) exports the selector. */
function known(ctx: CommandContext, selector: Hex4, facet: unknown): boolean {
  const facets = ctx.catalog?.facets ?? [];
  const exports = (f: (typeof facets)[number]) => f.selectors.some((s) => s.hex === selector);
  return facets.some((f) => (typeof facet === "string" && f.name === facet && exports(f)) || exports(f));
}

const copySelector = command({
  id: "selector.copy",
  title: () => "Copy selector",
  category: "Build",
  enabled: (_ctx, { selector }) => (isHex4(selector) ? OK : refuse(NAME_A_SELECTOR)),
  run: run("selector.copy"),
});

const copySignature = command({
  id: "selector.copySignature",
  title: () => "Copy signature",
  category: "Build",
  enabled(ctx, { selector, facet }) {
    if (!isHex4(selector)) return refuse(NAME_A_SELECTOR);
    if (!ctx.catalog) return refuse("The catalog hasn't loaded yet");
    return known(ctx, selector, facet) ? OK : refuse(`No facet in the catalog exports ${selector}`);
  },
  run: run("selector.copySignature"),
});

const showOwner = command({
  id: "selector.showOwner",
  title: () => "Show owner",
  category: "Build",
  enabled(ctx, { selector }) {
    if (!isHex4(selector)) return refuse(NAME_A_SELECTOR);
    const owner = ctx.analysis.routing[selector]?.owner;
    if (owner === undefined) return refuse(`No facet serves \`${selector}\` now`);
    return ctx.project.layout[owner] ? OK : refuse(`${owner} isn't on the sheet`);
  },
  run: run("selector.showOwner"),
});

export const interactCommands = [
  selectAll, clearSelection, moveTo, nudge, focusDirection, focusFirst, focusLast, enterRows, removeSelected,
  addFacetHere, copySelector, copySignature, showOwner,
];

defineCommands(interactCommands);
