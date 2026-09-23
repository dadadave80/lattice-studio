/**
 * S4d's commands (contracts §5.3): init order mode on and off (I, the tool strip, `init`; Flow 7 step 5) and
 * Browse all recipes (the Start block, Flow 2). In the entry chunk: registration and reasons only; the dialog
 * and everything the mode draws load with the sheet's chrome.
 */
import type { Result } from "@lattice-studio/core";
import {
  announce, command, defineCommands, isPlaceholder, log, openDialog, runCommand, session, type CommandContext,
  type Enablement,
} from "@/contracts";
import { currentTier } from "@/shell/layout-tier";
import { NO_INIT_STEPS, PLACE_FACETS_FIRST } from "./copy";
import { initOrderModel } from "./init-order-model";

const OK: Enablement = { ok: true };
export const CATALOG_LOADING = "The catalog hasn't loaded yet";

function refuse(reason: string): Enablement {
  return { ok: false, reason };
}

function noArgs(argv: string[]): Result<Record<string, never>, string> {
  return argv.length === 0 ? { ok: true, value: {} } : { ok: false, error: `Unexpected “${argv.join(" ")}”` };
}

/** Says what a command did: announced, and logged too when typed in the console (S4b's convention). */
function say(ctx: CommandContext, text: string): void {
  if (ctx.source === "api") return;
  if (ctx.source === "console") log({ tag: "Note", text });
  announce(text);
}

/** Why init order mode can't open now, or null. Leaving it is always possible. */
export function initOrderBlock(ctx: Pick<CommandContext, "project" | "catalog" | "session">): string | null {
  if (ctx.session.modes.initOrder) return null;
  if (ctx.project.recipe.facets.length === 0) return PLACE_FACETS_FIRST;
  if (!ctx.catalog) return CATALOG_LOADING;
  return initOrderModel(ctx.project.recipe, ctx.catalog).kind === "none" ? NO_INIT_STEPS : null;
}

export const INIT_ORDER_ON = "Init order mode on.";
export const INIT_ORDER_OFF = "Init order mode off.";

const initOrderToggle = command({
  id: "initOrder.toggle",
  title: () => (session.get().modes.initOrder ? "Hide init order" : "Show init order"),
  category: "Sheet",
  keys: ["i"],
  keyContext: ["sheet"],
  palette: true,
  console: { verb: "init", syntax: "init", parse: noArgs },
  enabled(ctx) {
    const block = initOrderBlock(ctx);
    return block === null ? OK : refuse(block);
  },
  run(ctx) {
    const on = !ctx.session.modes.initOrder;
    session.set((s) => ({ modes: { ...s.modes, initOrder: on } }));
    // The inspector shows the init plan while the mode is on (spec L383, Flow 7 step 1). Under 768 px the
    // sheet is its own pane, so the plan stays a tap away instead of replacing it.
    if (on && currentTier() !== "phone" && !isPlaceholder("init.open")) void runCommand({ id: "init.open" }, "api");
    say(ctx, on ? INIT_ORDER_ON : INIT_ORDER_OFF);
  },
});

const browse = command({
  id: "recipe.browse",
  title: () => "Browse all recipes",
  category: "Build",
  palette: true,
  enabled: (ctx) => (ctx.catalog ? OK : refuse(CATALOG_LOADING)),
  run() {
    openDialog("browse-recipes");
  },
});

export const chromeCommands = [initOrderToggle, browse];

defineCommands(chromeCommands);
