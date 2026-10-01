/**
 * `core.select` (contracts §5.3): selects the core, the diamond's fixed part. The core and the cards are never
 * selected together: `session.set` drops `coreSelected` on any selection write, and this command empties the
 * selection. Typed in the console (`core`) it also prints the core's readout as one Note line.
 */
import { coreStatus, type CoreStatus } from "@lattice-studio/core";
import { announce, command, defineCommands, log, session, type Enablement } from "@/contracts";

const OK: Enablement = { ok: true };
export const SELECTED_THE_CORE = "Selected the core.";

/** "Core: fallback 14 routed · loupe 4/4 · ERC-165 IERC165, IDiamondLoupe · cut AccessControlDiamondCut". */
export function coreLine(status: CoreStatus): string {
  const ids = status.erc165.interfaceIds.map((entry) => entry.name).join(", ") || "none";
  const cut = status.cut.facet ?? (status.cut.immutable ? "none, immutable" : "none");
  const loupe = `${status.loupe.covered.length}/${status.loupe.selectors.length}`;
  return `Core: fallback ${status.fallback.routed} routed · loupe ${loupe} · ERC-165 ${ids} · cut ${cut}`;
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
      log({ tag: "Note", text: ctx.catalog ? coreLine(coreStatus(ctx.project.recipe, ctx.catalog, ctx.analysis)) : SELECTED_THE_CORE });
    }
    announce(SELECTED_THE_CORE);
  },
});

defineCommands([select]);
