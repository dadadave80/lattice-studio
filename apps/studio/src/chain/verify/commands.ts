/**
 * S8d's command (contracts §5.3): Retry verification, from a failed record's row (S5c's Deployments list) or the
 * review's progress view. Registration only; the retry itself loads the verify engine's chunk. Light: entry chunk.
 */
import { command, defineCommands, type CommandArgsMap } from "@/contracts";

defineCommands([
  command<CommandArgsMap["deploy.retryVerification"]>({
    id: "deploy.retryVerification",
    title: () => "Retry verification",
    category: "Deploy",
    // Reached from a deployment record's own row, which shows it only when Sourcify or Etherscan couldn't verify it.
    palette: false,
    enabled: () => ({ ok: true }),
    async run(_ctx, { chainId, address }) {
      const { retryVerification } = await import("./engine");
      await retryVerification({ chainId, address });
    },
  }),
]);
