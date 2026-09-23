/**
 * S4b's commands (contracts §5.3): the tools, every zoom, Locate, Back to content and the minimap (Flow 8,
 * IR L28-L30). They move the project's viewport through `sheet-view.ts`, so they work whether or not the
 * sheet is showing.
 *
 * Every command says what it did or why it didn't (contracts §6). Why it can't is its `enabled()` reason
 * (no period, like every disabled reason: "Already at 200%"), which `runCommand` logs and announces; a no-op
 * found while running (a tool that's already on) is said the same way. What it did is a sentence with a
 * period ("Zoom 75%."), announced, and logged too when typed in the console; a command another module runs
 * (`api`, after Tidy or a recipe load) says only why it didn't, since that module narrates what happened.
 */
import type { Hex4, Result } from "@lattice-studio/core";
import {
  announce, command, defineCommands, log, settings, session, type CommandArgsOf, type CommandContext, type Enablement,
} from "@/contracts";
import { focusCard } from "@/a11y/focus";
import { tabStopOf } from "./nodes";
import { fitCards, locateCard, sheetViewport, zoomSheet } from "./sheet-view";
import { MAX_ZOOM, MIN_ZOOM, percent, zoomStep } from "./viewport-math";

type ZoomToArgs = CommandArgsOf<"sheet.zoomTo">;
type LocateArgs = CommandArgsOf<"sheet.locate">;

const SHEET = ["sheet"] as const;
const OK: Enablement = { ok: true };
const EPSILON = 1e-3;

export const EMPTY_SHEET = "The sheet is empty";
export const NO_SELECTION = "Select a card first";
/** Why a zoom was refused, for `zoom <percent>` and `sheet.zoomTo` alike. */
export const ZOOM_RANGE = "Zoom takes a percent from 10 to 200";
export const NAME_A_FACET = "Name a facet to locate";

function refuse(reason: string): Enablement {
  return { ok: false, reason };
}

export function alreadyAt(zoom: number): string {
  return `Already at ${percent(zoom)}`;
}

/** Says what a command did: announced; also logged when typed in the console; silent for `api` callers. */
function say(ctx: CommandContext, text: string): void {
  if (ctx.source === "api") return;
  if (ctx.source === "console") log({ tag: "Note", text });
  announce(text, { merge: "sheet-view" });
}

/** Says why a command that passed `enabled()` still did nothing, the way `runCommand` says a reason. */
function sayReason(reason: string): void {
  log({ tag: "Note", text: reason });
  announce(reason);
}

function storedZoom(ctx: CommandContext): number {
  return ctx.session.viewports[ctx.project.id]?.zoom ?? 1;
}

function same(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

function hasCards(ctx: CommandContext): boolean {
  return Object.keys(ctx.project.layout).length > 0;
}

function placedSelection(ctx: CommandContext): string[] {
  return ctx.session.selection.filter((name) => ctx.project.layout[name] !== undefined);
}

function noArgs(argv: string[]): Result<Record<string, never>, string> {
  return argv.length === 0 ? { ok: true, value: {} } : { ok: false, error: `Unexpected “${argv.join(" ")}”` };
}

function inRange(zoom: unknown): zoom is number {
  return typeof zoom === "number" && Number.isFinite(zoom) && zoom >= MIN_ZOOM - EPSILON && zoom <= MAX_ZOOM + EPSILON;
}

/** "75" or "75%" is 0.75; 10-200% only. */
export function parseZoom(argv: string[]): Result<ZoomToArgs, string> {
  const [word, ...rest] = argv;
  if (word === undefined || rest.length) return { ok: false, error: ZOOM_RANGE };
  const match = /^(\d+(?:\.\d+)?)%?$/.exec(word);
  const zoom = match ? Number(match[1]) / 100 : Number.NaN;
  return inRange(zoom) ? { ok: true, value: { zoom } } : { ok: false, error: ZOOM_RANGE };
}

/** Refuses a zoom the view is already at. */
function zoomEnabled(ctx: CommandContext, zoom: number): Enablement {
  return same(storedZoom(ctx), zoom) ? refuse(alreadyAt(zoom)) : OK;
}

function zoomed(ctx: CommandContext, zoom: number): void {
  if (same(sheetViewport().zoom, zoom)) {
    sayReason(alreadyAt(zoom));
    return;
  }
  zoomSheet(zoom);
  say(ctx, `Zoom ${percent(zoom)}.`);
}

const toolSelect = command({
  id: "tool.select",
  title: () => "Select",
  category: "Sheet",
  keys: ["v"],
  keyContext: [...SHEET],
  palette: true,
  // Enabled while it's on too: the tool strip and the Tools menu show the tool in use as pressed, not disabled.
  enabled: () => OK,
  run(ctx) {
    if (ctx.session.tool === "select") {
      sayReason("The Select tool is already on");
      return;
    }
    session.set({ tool: "select" });
    say(ctx, "Select tool.");
  },
});

const toolHand = command({
  id: "tool.hand",
  title: () => "Hand",
  category: "Sheet",
  keys: ["h"],
  keyContext: [...SHEET],
  palette: true,
  // Enabled while it's on too: the tool strip and the Tools menu show the tool in use as pressed, not disabled.
  enabled: () => OK,
  run(ctx) {
    if (ctx.session.tool === "hand") {
      sayReason("The Hand tool is already on");
      return;
    }
    session.set({ tool: "hand" });
    say(ctx, "Hand tool. Drag to pan.");
  },
});

const zoomIn = command({
  id: "sheet.zoomIn",
  title: () => "Zoom in",
  category: "Sheet",
  keys: ["=", "+"],
  keyContext: [...SHEET],
  palette: true,
  enabled: (ctx) => (storedZoom(ctx) < MAX_ZOOM - EPSILON ? OK : refuse(alreadyAt(MAX_ZOOM))),
  run: (ctx) => zoomed(ctx, zoomStep(sheetViewport().zoom, 1)),
});

const zoomOut = command({
  id: "sheet.zoomOut",
  title: () => "Zoom out",
  category: "Sheet",
  keys: ["-"],
  keyContext: [...SHEET],
  palette: true,
  enabled: (ctx) => (storedZoom(ctx) > MIN_ZOOM + EPSILON ? OK : refuse(alreadyAt(MIN_ZOOM))),
  run: (ctx) => zoomed(ctx, zoomStep(sheetViewport().zoom, -1)),
});

const zoom100 = command({
  id: "sheet.zoom100",
  title: () => "Zoom to 100%",
  category: "Sheet",
  keys: ["Shift+[Digit0]"],
  keyContext: [...SHEET],
  palette: true,
  enabled: (ctx) => zoomEnabled(ctx, 1),
  run: (ctx) => zoomed(ctx, 1),
});

const zoomTo = command<ZoomToArgs>({
  id: "sheet.zoomTo",
  title: ({ zoom }) => (inRange(zoom) ? `Zoom to ${percent(zoom)}` : "Zoom to"),
  category: "Sheet",
  bindings: [
    { name: "50", keys: [], args: { zoom: 0.5 }, palette: true },
    { name: "200", keys: [], args: { zoom: 2 }, palette: true },
  ],
  keyContext: [...SHEET],
  console: { verb: "zoom", syntax: "zoom <percent>", parse: parseZoom },
  enabled: (ctx, { zoom }) => (inRange(zoom) ? zoomEnabled(ctx, zoom) : refuse(ZOOM_RANGE)),
  run: (ctx, { zoom }) => zoomed(ctx, zoom),
});

function fit(ctx: CommandContext): void {
  const viewport = fitCards();
  const count = Object.keys(ctx.project.layout).length;
  if (viewport) say(ctx, `Fit ${count} ${count === 1 ? "card" : "cards"} · ${percent(viewport.zoom)}.`);
}

const zoomFit = command({
  id: "sheet.zoomFit",
  title: () => "Fit",
  category: "Sheet",
  keys: ["Shift+[Digit1]"],
  keyContext: [...SHEET],
  palette: true,
  console: { verb: "fit", syntax: "fit", parse: noArgs },
  enabled: (ctx) => (hasCards(ctx) ? OK : refuse(EMPTY_SHEET)),
  run: fit,
});

const zoomSelection = command({
  id: "sheet.zoomSelection",
  title: () => "Zoom to selection",
  category: "Sheet",
  keys: ["Shift+[Digit2]"],
  keyContext: [...SHEET],
  palette: true,
  console: { verb: "zoom", sub: "selection", syntax: "zoom selection", parse: noArgs },
  enabled: (ctx) => (placedSelection(ctx).length ? OK : refuse(NO_SELECTION)),
  run(ctx) {
    const names = placedSelection(ctx);
    const viewport = fitCards(names);
    if (viewport) say(ctx, `Zoomed to ${names.length === 1 ? names[0] : `${names.length} cards`} · ${percent(viewport.zoom)}.`);
  },
});

const locate = command<LocateArgs>({
  id: "sheet.locate",
  title: ({ facet }) => (typeof facet === "string" ? `Locate ${facet}` : "Locate"),
  category: "Sheet",
  enabled(ctx, { facet }) {
    if (typeof facet !== "string" || facet === "") return refuse(NAME_A_FACET);
    return ctx.project.layout[facet] ? OK : refuse(`${facet} isn't on the sheet`);
  },
  run(ctx, { facet, selector }) {
    if (locateCard(facet, selector as Hex4 | undefined)) say(ctx, `Located ${facet}.`);
  },
});

/** Back to content: fits the view, and keeps focus on the sheet when the button that ran it goes away. */
const backToContent = command({
  id: "sheet.backToContent",
  title: () => "Back to content",
  category: "Sheet",
  console: { verb: "zoom", sub: "fit", syntax: "zoom fit", parse: noArgs },
  enabled: (ctx) => (hasCards(ctx) ? OK : refuse(EMPTY_SHEET)),
  run(ctx) {
    const hadFocus = Boolean(document.activeElement?.closest("[data-back-to-content]"));
    fit(ctx);
    const target = tabStopOf(ctx.project.layout, ctx.session.focus, ctx.session.selection);
    if (hadFocus && target !== null) void focusCard(target);
  },
});

const minimapToggle = command({
  id: "sheet.minimapToggle",
  title: () => "Minimap",
  category: "Sheet",
  palette: true,
  enabled: () => OK,
  run(ctx) {
    const on = !ctx.settings.minimap;
    settings.set({ minimap: on });
    say(ctx, on ? "Minimap on." : "Minimap off.");
  },
});

export const canvasCommands = [
  toolSelect, toolHand, zoomIn, zoomOut, zoom100, zoomTo, zoomFit, zoomSelection, locate, backToContent, minimapToggle,
];

defineCommands(canvasCommands);
