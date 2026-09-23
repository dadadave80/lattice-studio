/**
 * S8a's commands (contracts §5.3): choose the chain readiness runs on (`chain <name or id>`, IR L155), read it
 * again, use another RPC, connect a wallet and switch its network (IR L225-L236, Flow 14). Definitions only;
 * `commands.ts` registers them. Light: they reach the chain module through `chainService()`, which loads it.
 */
import type { Result } from "@lattice-studio/core";
import { formatAddress } from "@lattice-studio/core";
import {
  announce, chainService, command, dialogComponent, env, log, openDialog, session, type CommandArgsOf, type CommandContext,
  type Enablement,
} from "@/contracts";
import { chainFromText, chainName, findChain, pickerChains } from "./chains";
import { CHOOSE_A_CHAIN, CONNECT_A_WALLET, unsupportedChain, walletOn } from "./copy";

type SelectArgs = CommandArgsOf<"chain.select">;
/** `wallet.connect` takes an optional connector id (a CCR adds the row to `CommandArgsMap`). */
type ConnectArgs = { connector?: string };

const OK: Enablement = { ok: true };

/** Disabled with the chain rows' offline wording (spec L697). */
export const CHAIN_CHECKS_OFFLINE = "Chain checks need a connection";

function names(): string[] {
  return pickerChains(env.e2e).map((chain) => chain.name);
}

function say(tag: "Note" | "Error", text: string): void {
  log({ tag, text });
  announce(text, tag === "Error" ? { politeness: "assertive" } : {});
}

function bare(verb: string, syntax = verb) {
  return {
    verb,
    syntax,
    parse: (argv: string[]): Result<Record<string, never>, string> =>
      argv.length === 0 ? { ok: true, value: {} } : { ok: false, error: `${verb} takes no arguments.` },
  };
}

function selectedName(ctx: CommandContext): string | null {
  return ctx.session.chainId === null ? null : chainName(ctx.session.chainId, env.e2e);
}

export const selectChainCommand = command<SelectArgs>({
  id: "chain.select",
  title: ({ chainId }) => (typeof chainId === "number" ? `Select ${chainName(chainId, env.e2e)}` : "Select a chain"),
  category: "Chain",
  console: {
    verb: "chain",
    syntax: "chain <name or id>",
    parse(argv) {
      const text = argv.join(" ").trim();
      if (text === "") return { ok: false, error: `chain takes a chain: ${names().join(" or ")}.` };
      const chain = chainFromText(text, env.e2e);
      return chain ? { ok: true, value: { chainId: chain.id } } : { ok: false, error: unsupportedChain(text, names()) };
    },
  },
  enabled(_ctx, { chainId }) {
    if (typeof chainId !== "number") return { ok: false, reason: CHOOSE_A_CHAIN };
    if (!findChain(chainId, env.e2e)) return { ok: false, reason: unsupportedChain(chainName(chainId, env.e2e), names()) };
    return OK;
  },
  async run(ctx, { chainId }) {
    const name = chainName(chainId, env.e2e);
    if (ctx.session.chainId === chainId) {
      say("Note", `${name} is already selected. Checking it again.`);
    } else {
      session.set({ chainId });
      say("Note", `Selected ${name}.`);
    }
    // Loading the module starts its readiness probes for the selected chain (spec L842).
    const service = await chainService();
    await service.probe(chainId, { path: ctx.project.deploy.path });
  },
});

export const retryReadCommand = command({
  id: "chain.retryRead",
  title: (): string => {
    const chainId = session.get().chainId;
    return chainId === null ? "Retry reading the chain" : `Retry reading ${chainName(chainId, env.e2e)}`;
  },
  category: "Chain",
  palette: true,
  enabled(ctx) {
    if (ctx.session.chainId === null) return { ok: false, reason: CHOOSE_A_CHAIN };
    if (!ctx.online) return { ok: false, reason: CHAIN_CHECKS_OFFLINE };
    return OK;
  },
  async run(ctx) {
    const chainId = ctx.session.chainId;
    if (chainId === null) return;
    const service = await chainService();
    const result = await service.probe(chainId, { refresh: true, path: ctx.project.deploy.path });
    if (result.ok) say("Note", `Read ${selectedName(ctx) ?? chainName(chainId, env.e2e)} again.`);
    else say("Error", result.error);
  },
});

export const useAnotherRpcCommand = command({
  id: "chain.useAnotherRpc",
  title: () => "Use another RPC…",
  category: "Chain",
  palette: true,
  enabled: () => OK,
  run() {
    if (!dialogComponent("settings")) {
      say("Note", "Settings aren't built yet · WP-S10");
      return;
    }
    openDialog("settings", { group: "networks" });
  },
});

export const connectWalletCommand = command<ConnectArgs>({
  id: "wallet.connect",
  title: () => "Connect wallet",
  category: "Chain",
  palette: true,
  console: bare("connect"),
  enabled: () => OK,
  async run(_ctx, args) {
    const service = await chainService();
    const result = await service.connect(typeof args.connector === "string" ? args.connector : undefined);
    if (!result.ok) {
      say("Error", result.error);
      return;
    }
    const wallet = service.connectors().find((c) => c.id === result.value.connector)?.name;
    say("Note", `Connected ${formatAddress(result.value.address)}${wallet ? ` through ${wallet}` : ""}.`);
  },
});

export const switchNetworkCommand = command({
  id: "wallet.switchNetwork",
  title: () => "Switch network",
  category: "Chain",
  palette: true,
  enabled(ctx) {
    if (ctx.session.chainId === null) return { ok: false, reason: CHOOSE_A_CHAIN };
    return OK;
  },
  async run(ctx) {
    const chainId = ctx.session.chainId;
    if (chainId === null) return;
    const name = chainName(chainId, env.e2e);
    const service = await chainService();
    const account = service.account();
    if (!account) {
      say("Note", CONNECT_A_WALLET);
      return;
    }
    if (account.chainId === chainId) {
      say("Note", `${walletOn(name)} Nothing to switch.`);
      return;
    }
    const result = await service.switchNetwork(chainId);
    if (result.ok) say("Note", `Switched your wallet to ${name}.`);
    else say("Error", result.error);
  },
});

/** In registration order. */
export const CHAIN_COMMANDS = [
  selectChainCommand,
  retryReadCommand,
  useAnotherRpcCommand,
  connectWalletCommand,
  switchNetworkCommand,
];
