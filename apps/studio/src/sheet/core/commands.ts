/**
 * `core.select` (contracts §5.3): selects the core, the diamond's fixed part. The core and the cards are never
 * selected together: `session.set` drops `coreSelected` on any selection write, and this command empties the
 * selection. Typed in the console (`core`) it also prints the core's readout as one Note line.
 */
import { coreStatus, mechanismOptions, type CoreStatus } from "@lattice-studio/core";
import { announce, command, defineCommands, log, session, type Enablement } from "@/contracts";
import { SELECTED_THE_CORE } from "./copy";
import { cutRow } from "./model";

const OK: Enablement = { ok: true };

/**
 * The cell's readout as one line, its cut row in the cell's words: "Core: fallback 14 routed · loupe 4/4 ·
 * ERC-165 IDiamondLoupe, IDiamondCut · cut AccessControlDiamondCut · Admin role."
 */
export function coreLine(status: CoreStatus, mode?: string): string {
  const ids = status.erc165.interfaceIds.map((entry) => entry.name).join(", ") || "none registered";
  const loupe = `${status.loupe.covered.length}/${status.loupe.selectors.length}`;
  return `Core: fallback ${status.fallback.routed} routed · loupe ${loupe} · ERC-165 ${ids} · cut ${cutRow(status, mode).text}.`;
}

const select = command({
  id: "core.select",
  title: () => "Select the core",
  category: "Sheet",
  palette: true,
  console: {
    verb: "core",
    syntax: "core",
    parse: (argv) => (argv.length === 0 ? { ok: true, value: {} } : { ok: false, error: "core takes no arguments." }),
  },
  enabled: () => OK,
  run(ctx) {
    session.set({ selection: [], coreSelected: true });
    if (ctx.source === "api") return;
    if (ctx.source === "console") {
      const catalog = ctx.catalog;
      if (catalog) {
        const options = mechanismOptions(ctx.project.recipe, catalog);
        const mode = options.options.find((option) => option.id === options.current)?.label;
        log({ tag: "Note", text: coreLine(coreStatus(ctx.project.recipe, catalog, ctx.analysis), mode) });
      } else log({ tag: "Note", text: SELECTED_THE_CORE });
    }
    announce(SELECTED_THE_CORE);
  },
});

defineCommands([select]);
