/**
 * S5c's commands (contracts §5.3): routing the inspector and copying the cut plan. Registration and session
 * writes only: this file is in the entry chunk and in every browser test (contracts/discover.ts).
 */
import type { InspectorView, SessionState } from "@/contracts";
import { command, defineCommands, session, type CommandArgsMap, type Enablement } from "@/contracts";
import { requestInspectorFocus, type FocusTarget } from "./focus-request";
import { planJson } from "./plan/plan-json";

/** Opens the inspector on `view`; `selection` replaces the selection in the same update. */
function show(view: InspectorView, focus: FocusTarget, selection?: string[]): void {
  session.set((s: SessionState) => ({
    ...(selection ? { selection } : {}),
    panes: { ...s.panes, inspector: { ...s.panes.inspector, open: true, view } },
  }));
  requestInspectorFocus(focus);
}

const OK: Enablement = { ok: true };

function onSheet(placed: readonly string[], facet: string): Enablement {
  return placed.includes(facet) ? OK : { ok: false, reason: `${facet} isn't on the sheet.` };
}

defineCommands([
  command<CommandArgsMap["inspector.show"]>({
    id: "inspector.show",
    title: ({ facet }) => (facet ? `Open ${facet} in inspector` : "Open in inspector"),
    category: "Build",
    enabled: (ctx, { facet }) => (facet === undefined ? OK : onSheet(ctx.project.recipe.facets, facet)),
    run: (ctx, { facet }) => {
      if (facet === undefined) {
        show(ctx.session.panes.inspector.view, { kind: "heading" });
        return;
      }
      // An explicit facet view, so narrow layouts that open the inspector on a routed view show it; a later
      // selection change elsewhere still moves the inspector on (services.ts).
      show({ kind: "facet", facet }, { kind: "heading" }, [facet]);
    },
  }),
  command<CommandArgsMap["inspector.focusSelectors"]>({
    id: "inspector.focusSelectors",
    title: ({ facet }) => `Show ${facet}'s selectors`,
    category: "Build",
    enabled: (ctx, { facet }) => onSheet(ctx.project.recipe.facets, facet),
    run: (_ctx, { facet }) => {
      show({ kind: "facet", facet, focus: "selectors" }, { kind: "selectors", facet }, [facet]);
    },
  }),
  command<CommandArgsMap["dependency.compare"]>({
    id: "dependency.compare",
    title: () => "Compare options…",
    category: "Build",
    enabled: (ctx, { options }) => {
      if (!ctx.catalog) return { ok: false, reason: "The catalog hasn't loaded." };
      if (options.length < 2) return { ok: false, reason: "Compare needs two or more options." };
      const known = new Set(ctx.catalog.facets.map((facet) => facet.name));
      const missing = options.find((name) => !known.has(name));
      return missing === undefined ? OK : { ok: false, reason: `${missing} isn't in the catalog.` };
    },
    run: (_ctx, { options }) => {
      const [first] = options;
      if (first === undefined) return;
      show({ kind: "preview", facet: first, compare: [...options] }, { kind: "heading" });
    },
  }),
  command<CommandArgsMap["deploy.compare"]>({
    id: "deploy.compare",
    title: () => "Compare with the sheet…",
    category: "Deploy",
    enabled: () => OK,
    run: (_ctx, { chainId, address }) => {
      show({ kind: "comparison", chainId, address }, { kind: "heading" });
    },
  }),
  command({
    id: "deployments.show",
    title: () => "Show deployments",
    category: "Deploy",
    palette: true,
    enabled: () => OK,
    run: () => {
      show({ kind: "diamond", section: "deployments" }, { kind: "section", section: "deployments" });
    },
  }),
  command({
    id: "plan.copyJson",
    title: () => "Copy plan as JSON",
    category: "Build",
    palette: true,
    enabled: (ctx) => (ctx.analysis.plan.length === 0 ? { ok: false, reason: "Place facets first" } : OK),
    run: async (ctx) => {
      const text = planJson(ctx.analysis);
      // Loaded on use: the copy helper brings the toast and fallback styles, which the entry chunk doesn't need.
      const { copyText } = await import("@/ui/copy/copy-text");
      await copyText(text, { label: "plan" });
    },
  }),
]);
