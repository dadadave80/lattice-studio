/**
 * S5d's commands (contracts §5.3): open the init plan, focus a field in it (INIT-01, AUTH-02 and LINK-01's
 * Edit field, and Fill in), Confirm address… (LINK-01) and Choose an upgrade mechanism… (Flow 17). Registration
 * only: the editor and the dialog load in their own chunk (spec L822).
 */
import { isNotImplemented, mechanismOptions } from "@lattice-studio/core";
import {
  command, defineCommands, openDialog, type CommandArgsOf, type CommandContext, type Enablement,
} from "@/contracts";
import { openConfirm } from "./init-ui-store";
import { planField, planOf, showInitPlan } from "./navigation";

const OK: Enablement = { ok: true };
const CATALOG_NOT_LOADED = "The catalog hasn't loaded yet · Wait for it to finish";

function disabled(reason: string): Enablement {
  return { ok: false, reason };
}

function isPath(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** The title of `init.open` for where it lands: INIT-05's Review fields, INIT-02's Move step (spec L328, L331). */
export function openTitle(focus: string | undefined): string {
  if (focus === "examples") return "Review fields";
  if (focus !== undefined && /^steps\[\d+\]$/.test(focus)) return "Move step";
  if (focus !== undefined && focus !== "authority") return "Edit field";
  return "Open init plan";
}

/** Titles of Choose an upgrade mechanism… and AUTH-01's presets (spec L332, L642). */
export function mechanismTitle(preset: "safe" | "governance" | undefined): string {
  if (preset === "safe") return "Use a Safe…";
  if (preset === "governance") return "Use governance…";
  return "Choose an upgrade mechanism…";
}

function fieldEnabled(ctx: CommandContext, path: unknown): Enablement {
  if (!isPath(path)) return disabled("Name an init field");
  if (!ctx.catalog) return disabled(CATALOG_NOT_LOADED);
  return planField(planOf(ctx.project.recipe, ctx.catalog), path) ? OK : disabled(`The init plan has no field ${path}`);
}

/** LINK-01's scope (spec L334): only an address that receives authority needs confirming. */
function isAuthorityAddress(ctx: CommandContext, path: string): boolean {
  if (!ctx.catalog) return false;
  const field = planField(planOf(ctx.project.recipe, ctx.catalog), path);
  return field?.kind === "address" && field.authority;
}

const open = command<CommandArgsOf<"init.open">>({
  id: "init.open",
  title: ({ focus }) => openTitle(focus),
  category: "Build",
  palette: true,
  enabled: () => OK,
  run: (_ctx, { focus }) => showInitPlan(focus),
});

const focusField = command<CommandArgsOf<"init.focusField">>({
  id: "init.focusField",
  // INIT-01, AUTH-02 and LINK-01's "Edit field" (spec L327, L333, L334).
  title: () => "Edit field",
  category: "Build",
  enabled: (ctx, { path }) => fieldEnabled(ctx, path),
  run: (_ctx, { path }) => showInitPlan(path),
});

const confirmAddress = command<CommandArgsOf<"init.confirmAddress">>({
  id: "init.confirmAddress",
  // LINK-01's fix (spec L334): the field opens with the address in full and any ENS name; its own button confirms.
  title: () => "Confirm address…",
  category: "Build",
  enabled(ctx, { path }) {
    if (ctx.session.readOnly !== null) return disabled(ctx.session.readOnly);
    const field = fieldEnabled(ctx, path);
    if (!field.ok) return field;
    if (!isAuthorityAddress(ctx, path)) return disabled("Only an address that receives authority needs confirming");
    const source = ctx.project.provenance[path];
    if (source === "confirmed") return disabled("This address is already confirmed");
    if (source !== "link" && source !== "file") return disabled("This address didn't come from a link or a file");
    return OK;
  },
  run(ctx, { path }) {
    openConfirm(ctx.project.id, path);
    showInitPlan(path);
  },
});

const chooseMechanism = command<CommandArgsOf<"authority.chooseMechanism">>({
  id: "authority.chooseMechanism",
  title: ({ preset }) => mechanismTitle(preset),
  category: "Build",
  palette: true,
  enabled(ctx, { preset }) {
    // The dialog edits the document (spec L389): it isn't offered while the session is read-only.
    if (ctx.session.readOnly !== null) return disabled(ctx.session.readOnly);
    if (!ctx.catalog) return disabled(CATALOG_NOT_LOADED);
    if (preset !== undefined && preset !== "safe" && preset !== "governance") return disabled(`There's no preset called "${String(preset)}"`);
    if (preset === "governance") {
      try {
        const governance = mechanismOptions(ctx.project.recipe, ctx.catalog).options.find((o) => o.id === "governance");
        if (governance && !governance.enabled && governance.reason) return disabled(governance.reason);
      } catch (error) {
        if (isNotImplemented(error)) return disabled(error.message);
        throw error;
      }
    }
    return OK;
  },
  run: (_ctx, { preset }) => {
    openDialog("choose-mechanism", preset === undefined ? {} : { preset });
  },
});

defineCommands([open, focusField, confirmAddress, chooseMechanism]);
