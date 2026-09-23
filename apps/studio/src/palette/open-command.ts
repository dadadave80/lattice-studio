/**
 * `palette.open`: ⌘/Ctrl K opens or closes the palette everywhere except inside a modal dialog (IR L9, L73),
 * and never opens over one (IR L168, PA bug 4). With `{ mode: "facets", at }` it opens as Add facet here…
 * (spec L423): filtered to facets, placing at `at`.
 */
import { command, type CommandArgsOf, type Enablement, type KeyContext, type SheetPoint } from "@/contracts";
import { EVERYWHERE } from "@/commands";
import { closePalette, openPalette, paletteState } from "./palette-state";

/** Live in every key context but a modal dialog's (IR L9). Text included: ⌘K works from the palette's own input. */
export const PALETTE_KEY_CONTEXTS: KeyContext[] = EVERYWHERE.filter((c) => c !== "dialog");

export const DIALOG_OPEN = "A dialog is open. Close it to use the command palette.";

function isPoint(value: unknown): value is SheetPoint {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y);
}

export const paletteOpenCommand = command<CommandArgsOf<"palette.open">>({
  id: "palette.open",
  title: (args) => (args.mode === "facets" ? "Add facet here…" : "Command palette"),
  category: "Session",
  keys: ["Mod+k"],
  keyContext: PALETTE_KEY_CONTEXTS,
  enabled(ctx): Enablement {
    // Closing is always possible; opening never happens over a modal dialog.
    if (paletteState().open) return { ok: true };
    return ctx.session.dialogs.length > 0 ? { ok: false, reason: DIALOG_OPEN } : { ok: true };
  },
  run(_ctx, args) {
    const facets = args.mode === "facets";
    // ⌘K toggles; Add facet here… always opens (again) at its own place.
    if (paletteState().open && !facets) {
      closePalette();
      return;
    }
    openPalette(facets ? { mode: "facets", at: isPoint(args.at) ? args.at : null } : { mode: "all" });
  },
});
