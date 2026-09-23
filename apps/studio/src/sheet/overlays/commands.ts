/**
 * S4c's commands (contracts §5.3): F8 and ⇧F8 through the problems, going to one problem, Resolve collision…
 * and Choose per selector…. Registration only: this file is in the entry chunk (contracts/discover.ts), so the
 * work loads with the first run (`navigate.ts`).
 */
import type { Hex4 } from "@lattice-studio/core";
import {
  command, defineCommands, KEY_CONTEXTS, openDialog, type CommandArgsOf, type CommandContext, type Enablement, type KeyContext,
} from "@/contracts";

const OK: Enablement = { ok: true };

/** F8 and ⇧F8 work everywhere (IR L17) but inside a dialog or the palette, which keep their own focus. */
const EVERYWHERE_BUT_MODALS: KeyContext[] = KEY_CONTEXTS.filter((c) => c !== "dialog" && c !== "palette");

const navigate = () => import("./lazy");

function anyProblem(ctx: CommandContext): Enablement {
  return ctx.analysis.problems.length > 0 ? OK : { ok: false, reason: "No problems" };
}

function isHex4(value: unknown): value is Hex4 {
  return typeof value === "string" && /^0x[0-9a-f]{8}$/.test(value);
}

/** Why owners can't be chosen for `selectors` now, or null (read-only first, like every editing command). */
export function chooseReason(ctx: CommandContext, selectors: unknown): string | null {
  if (ctx.session.readOnly !== null) return ctx.session.readOnly;
  if (!ctx.catalog) return "The catalog hasn't loaded yet";
  const list = Array.isArray(selectors) ? selectors.filter(isHex4) : [];
  if (list.length === 0) return "Name the selectors to choose owners for";
  const lone = list.find((s) => (ctx.analysis.routing[s]?.contenders.length ?? 0) < 2);
  if (lone !== undefined) return "Only one facet on the sheet exports this selector";
  return null;
}

defineCommands([
  command({
    id: "problem.next",
    title: () => "Next problem",
    category: "Build",
    keys: ["F8"],
    keyContext: EVERYWHERE_BUT_MODALS,
    palette: true,
    console: { verb: "next", syntax: "next", parse: () => ({ ok: true, value: {} }) },
    enabled: anyProblem,
    run: async (ctx) => (await navigate()).stepToProblem(1, ctx.source),
  }),
  command({
    id: "problem.prev",
    title: () => "Previous problem",
    category: "Build",
    keys: ["Shift+F8"],
    keyContext: EVERYWHERE_BUT_MODALS,
    palette: true,
    enabled: anyProblem,
    run: async (ctx) => (await navigate()).stepToProblem(-1, ctx.source),
  }),
  command<CommandArgsOf<"problem.focus">>({
    id: "problem.focus",
    title: () => "Show problem",
    category: "Build",
    enabled: (ctx, { problemId }) =>
      ctx.analysis.problems.some((p) => p.id === problemId) ? OK : { ok: false, reason: "This problem no longer applies." },
    run: async (ctx, { problemId }) => {
      (await navigate()).focusProblem(problemId, { source: ctx.source });
    },
  }),
  command({
    id: "collision.resolve",
    title: () => "Resolve collision…",
    category: "Build",
    palette: true,
    enabled: () => OK,
    run: async (ctx) => (await navigate()).resolveCollision(ctx.source),
  }),
  command<CommandArgsOf<"collision.choosePerSelector">>({
    id: "collision.choosePerSelector",
    // One selector with three or more contenders is SEL-01's Choose owner… (spec L311); a set is Flow 4's.
    title: ({ selectors }) => (Array.isArray(selectors) && selectors.length === 1 ? "Choose owner…" : "Choose per selector…"),
    category: "Build",
    enabled: (ctx, { selectors }) => {
      const reason = chooseReason(ctx, selectors);
      return reason === null ? OK : { ok: false, reason };
    },
    run: (_ctx, { selectors }) => {
      openDialog("choose-per-selector", { selectors: [...selectors] });
    },
  }),
]);
