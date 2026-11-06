import { isAddress } from "@lattice-studio/core";
import { command, defineCommands, type CommandArgsOf, type Enablement } from "@/contracts";
import { hasTransactionReview } from "./transaction-review-state";

const OK: Enablement = { ok: true };
const runs = () => import("./command-runs");
const target = ({ chainId, address }: { chainId: number; address: string }): Enablement =>
  Number.isSafeInteger(chainId) && chainId > 0 && isAddress(address) ? OK : { ok: false, reason: "Choose a chain and valid diamond address." };

export const INSPECTION_COMMANDS = [
  command({
    id: "inspect.showProgress", title: () => "Transaction progress", category: "Chain", palette: true,
    enabled: () => hasTransactionReview() ? OK : { ok: false, reason: "No transaction has been reviewed in this session." },
    run: async () => (await import("./transaction-review-actions")).showTransactionProgress(),
  }),
  command<CommandArgsOf<"inspect.open">>({
    id: "inspect.open", title: () => "Open deployed diamond…", category: "Session", palette: true,
    console: { verb: "open", syntax: "open <chainId:address-or-name>", parse: (argv) => argv.length === 1 ? { ok: true, value: { target: argv[0]! } } : { ok: false, error: "Open takes a diamond link, or chain id and address separated by a colon." } },
    enabled: () => OK,
    run: async (_ctx, args) => (await runs()).runOpen(args),
  }),
  command({
    id: "inspect.close", title: () => "Back to composition", category: "Session",
    enabled: (ctx) => ctx.session.panes.inspector.view?.kind === "deployed" ? OK : { ok: false, reason: "No deployed diamond is open." },
    run: async () => (await runs()).runClose(),
  }),
  command<CommandArgsOf<"inspect.refresh">>({
    id: "inspect.refresh", title: () => "Refresh inspection", category: "Chain",
    enabled: (ctx, args) => !ctx.online ? { ok: false, reason: "Inspection needs a connection." } : target(args),
    run: async (_ctx, args) => (await runs()).runRefresh(args),
  }),
  command<CommandArgsOf<"inspect.copyAddress">>({
    id: "inspect.copyAddress", title: () => "Copy diamond address", category: "Session",
    enabled: (_ctx, args) => target(args),
    run: async (_ctx, args) => (await runs()).runCopyAddress(args),
  }),
  command<CommandArgsOf<"inspect.exportPassport">>({
    id: "inspect.exportPassport", title: () => "Download passport JSON", category: "Export",
    enabled: (_ctx, args) => target(args),
    run: async (_ctx, args) => (await runs()).runExportPassport(args),
  }),
  command<CommandArgsOf<"inspect.selectFacet">>({
    id: "inspect.selectFacet", title: () => "Inspect deployed facet", category: "Session",
    enabled: (_ctx, args) => args.facetAddress !== undefined && !isAddress(args.facetAddress)
      ? { ok: false, reason: "Choose a valid facet address." } : target(args),
    run: async (_ctx, args) => (await runs()).runSelectFacet(args),
  }),
];

defineCommands(INSPECTION_COMMANDS);
