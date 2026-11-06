import { isAddress } from "@lattice-studio/core";
import { announce, command, defineCommands, log, type CommandArgsOf, type CommandContext, type Enablement } from "@/contracts";

/** Also used by the existing Deploy/Mod+Enter entry before any fresh-deployment prediction work. */
export function upgradeEnablement(ctx: CommandContext): Enablement {
  const origin = ctx.project.upgrade;
  if (ctx.project.recipe.mode !== "upgrade" || !origin) return { ok: false, reason: "Open an upgrade plan first." };
  if (ctx.session.readOnly !== null) return { ok: false, reason: ctx.session.readOnly };
  if (!ctx.online) return { ok: false, reason: "Upgrade review needs a connection." };
  if (!ctx.catalog || ctx.catalog.hash.toLowerCase() !== ctx.project.recipe.catalog.hash.toLowerCase()) return { ok: false, reason: "Load this plan's pinned catalog before upgrading." };
  if (ctx.catalog.lattice.tag === "fixture" || ctx.catalog.lattice.tag.startsWith("fixture-")) return { ok: false, reason: "The fixture catalog is for demonstrations and cannot send upgrades." };
  if (ctx.session.chainId !== origin.chainId) return { ok: false, reason: "Select the upgrade plan's original chain.", fix: { id: "chain.select", args: { chainId: origin.chainId } } };
  if (ctx.analysis.recipeHash.length !== 66) return { ok: false, reason: "Wait for the upgrade plan's analysis." };
  if (ctx.analysis.problems.some((problem) => problem.severity === "blocker")) return { ok: false, reason: "Resolve the plan's blockers before upgrading.", fix: { id: "problem.next" } };
  const unacknowledged = ctx.analysis.problems.find((problem) => problem.ack && !(ctx.session.acks[ctx.analysis.recipeHash] ?? []).includes(problem.id));
  if (unacknowledged) return { ok: false, reason: "Acknowledge the plan's warnings before upgrading.", fix: { id: "ack.set", args: { problemId: unacknowledged.id } } };
  return { ok: true };
}

function say(text: string, error: boolean): void { log({ tag: error ? "Error" : "Note", text }); announce(text, error ? { politeness: "assertive" } : {}); }

export const UPGRADE_COMMANDS = [
  command<CommandArgsOf<"inspect.editAsPlan">>({
    id: "inspect.editAsPlan", title: () => "Edit as upgrade plan", category: "Session",
    enabled: (ctx, args) => !ctx.online ? { ok: false, reason: "Creating an upgrade plan needs a connection." }
      : ctx.session.readOnly !== null ? { ok: false, reason: ctx.session.readOnly }
        : !Number.isSafeInteger(args.chainId) || args.chainId <= 0 || !isAddress(args.address) ? { ok: false, reason: "Choose a chain and deployed diamond address." } : { ok: true },
    run: async (_ctx, args) => {
      const result = await (await import("../upgrade-runtime")).editInspectedDiamondAsPlan(args);
      say(result.ok ? `Created ${result.value.name}.` : result.error, !result.ok);
    },
  }),
  command({
    id: "deploy.upgrade", title: () => "Upgrade…", category: "Deploy", palette: true,
    enabled: upgradeEnablement,
    run: async () => {
      const result = await (await import("../upgrade-runtime")).reviewCurrentUpgrade();
      say(result.ok ? "Opened the upgrade transaction review." : result.error, !result.ok && !result.error.includes("canceled"));
    },
  }),
];

defineCommands(UPGRADE_COMMANDS);
