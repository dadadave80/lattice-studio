/**
 * S5e's commands (contracts §5.3): the console drawer, the console's own verbs (`clear`, `help`, `find`,
 * `problems`) and the exports (`export foundry | brief | json | safe`; `export project` is S7b's). Run bodies
 * reach exporters only through their lazy chunks.
 */
import type { Address, CommandRef, Result } from "@lattice-studio/core";
import { isAddress, toChecksum } from "@lattice-studio/core";
import {
  announce, command, env, getCommand, log, openDialog, subscribeCommands, type Command, type CommandArgsOf, type Enablement,
} from "@/contracts";
import { helpLines, listVerbs } from "@/commands/console/router";
import {
  alwaysExportable, briefFile, CATALOG_NOT_LOADED, deployableExport, exportFailed, exportSafe, saveExport,
} from "./actions";
import { chainFromText, pickerChains } from "@/chain/infra/chains";
import { setConsoleMaximized, setConsoleOpen, showConsoleTab } from "./drawer";
import { findOnSheet, findSummary, firstAnchor, foundFacets } from "./find";
import { locatable, selectAndLocate } from "./locate";
import { clearLog } from "./log-store";
import { problemLines } from "./problem-lines";
import { nearestVerb, type VerbWords } from "./suggest";

const OK: Enablement = { ok: true };

function ok<T>(value: T): Result<T, string> {
  return { ok: true, value };
}

function err<T>(error: string): Result<T, string> {
  return { ok: false, error };
}

type NoArgs = Record<string, never>;

/** A verb that takes nothing after it (or after its sub): `error` for anything more. */
function noArgs(error: string): (argv: string[]) => Result<NoArgs, string> {
  return (argv) => (argv.length ? err<NoArgs>(error) : ok<NoArgs>({}));
}

type HelpArgs = CommandArgsOf<"console.help">;
type FindArgs = CommandArgsOf<"console.find">;
type SafeArgs = CommandArgsOf<"export.safe">;

function say(text: string): void {
  log({ tag: "Note", text });
  announce(text);
}

/** "sepolia, base-sepolia": the picker's chains as `export safe` takes them. */
function chainWords(): string {
  return pickerChains(env.e2e).map((c) => c.name.toLowerCase().replace(/\s+/g, "-")).join(", ");
}

let verbCache: VerbWords[] | null = null;
subscribeCommands(() => {
  verbCache = null;
});

/** The verbs as the suggestion and help list them; the same array until a registration changes them. */
export function verbWords(): VerbWords[] {
  verbCache ??= listVerbs().map((v) => ({
    verb: v.verb,
    aliases: v.aliases,
    subs: v.forms.flatMap((f) => (f.sub === undefined ? [] : [f.sub])),
  }));
  return verbCache;
}

/** "“plce” isn't a command. Did you mean place? Type help for commands." */
export function unknownVerb(word: string): string {
  const near = nearestVerb(word, verbWords());
  return near ? `“${word}” isn't a command. Did you mean ${near}? Type help for commands.` : `“${word}” isn't a command. Type help for commands.`;
}

function safeTitle(ref: CommandRef): string | null {
  try {
    const title = getCommand(ref.id).title(ref.args ?? {});
    return /undefined|\{|\[object/.test(title) ? null : title;
  } catch {
    return null;
  }
}

function help(verb: string | undefined): void {
  if (verb === undefined) {
    const verbs = listVerbs().map((v) => v.verb);
    say(`Commands: ${verbs.join(", ")}. Type help <verb> for one.`);
    return;
  }
  const found = helpLines(verb);
  if (!found) {
    say(unknownVerb(verb));
    return;
  }
  for (const line of found) {
    const title = safeTitle({ id: line.id });
    const also = line.aliases.length ? ` · also ${line.aliases.join(", ")}` : "";
    log({ tag: "Note", text: `${line.syntax}${title ? ` · ${title}` : ""}${also}` });
  }
  announce(`${found.length} ${found.length === 1 ? "form" : "forms"} of ${verb}.`);
}

export const S5E_COMMANDS: readonly Command[] = [
  command({
    id: "console.toggle",
    title: () => "Collapse or expand console",
    category: "Console",
    palette: true,
    enabled: () => OK,
    run: (ctx) => {
      const open = !ctx.session.panes.console.open;
      setConsoleOpen(open);
      announce(open ? "Console expanded." : "Console collapsed.");
    },
  }),
  command({
    id: "console.maximize",
    title: () => "Maximize or restore console",
    category: "Console",
    palette: true,
    enabled: () => OK,
    run: (ctx) => {
      const maximized = !ctx.session.panes.console.maximized;
      setConsoleMaximized(maximized);
      announce(maximized ? "Console maximized." : "Console restored.");
    },
  }),
  command({
    id: "console.clear",
    title: () => "Clear the log",
    category: "Console",
    // Ctrl L on macOS, as in DevTools; elsewhere Ctrl L is the address bar (IR L35).
    keys: [{ keys: "Ctrl+l", platform: "mac" }],
    keyContext: ["console"],
    palette: true,
    console: { verb: "clear", syntax: "clear", parse: noArgs("clear takes no arguments: clear") },
    enabled: () => OK,
    run: () => {
      clearLog();
      announce("Cleared the log.");
    },
  }),
  command<HelpArgs>({
    id: "console.help",
    title: () => "Console help",
    category: "Console",
    console: {
      verb: "help",
      syntax: "help [verb]",
      parse: (argv) => {
        if (argv.length > 1) return err("help takes one verb: help [verb]");
        const [verb] = argv;
        return ok(verb === undefined ? {} : { verb });
      },
    },
    enabled: () => OK,
    run: (_ctx, args) => help(args.verb),
  }),
  command<FindArgs>({
    id: "console.find",
    title: (args) => (args.query ? `Find ${args.query}` : "Find on the sheet"),
    category: "Console",
    console: {
      verb: "find",
      syntax: "find <text or 0x…>",
      parse: (argv) => (argv.length ? ok({ query: argv.join(" ") }) : err("Name what to find: find <text or 0x…>")),
    },
    enabled: (ctx) => (ctx.catalog ? OK : { ok: false, reason: CATALOG_NOT_LOADED }),
    run: (ctx, args) => {
      if (!ctx.catalog) return;
      const placed = ctx.project.recipe.facets;
      const result = findOnSheet(args.query ?? "", placed, ctx.catalog);
      const anchor = firstAnchor(result);
      const text = findSummary(result, placed);
      log(anchor ? { tag: "Note", text, anchor } : { tag: "Note", text });
      announce(text);
      selectAndLocate(foundFacets(result, placed), locatable(anchor ?? undefined, ctx.analysis), "console");
    },
  }),
  command({
    id: "problem.list",
    title: () => "List problems",
    category: "Build",
    palette: true,
    console: { verb: "problems", syntax: "problems", parse: noArgs("problems takes no arguments: problems") },
    enabled: () => OK,
    run: (ctx) => {
      const out = problemLines(ctx.analysis.problems);
      for (const line of out) log(line);
      announce(out[0]?.text ?? "");
    },
  }),
  command({
    id: "export.foundry",
    title: () => "Export Foundry script",
    category: "Export",
    palette: true,
    console: { verb: "export", sub: "foundry", syntax: "export foundry", parse: noArgs("export foundry takes no arguments") },
    enabled: (ctx) => deployableExport(ctx),
    run: () => {
      // Flow 11: the Script tab, maximized, with Copy and Download (spec L513).
      showConsoleTab("script", true);
      announce("Opened the Script tab. Copy or download the script there.");
    },
  }),
  command({
    id: "export.brief",
    title: () => "Export agent brief",
    category: "Export",
    palette: true,
    console: { verb: "export", sub: "brief", syntax: "export brief", parse: noArgs("export brief takes no arguments") },
    enabled: (ctx) => alwaysExportable(ctx),
    run: async () => {
      const file = await briefFile();
      if (!file.ok) {
        exportFailed(file.error);
        return;
      }
      saveExport(file.value);
    },
  }),
  command({
    id: "export.recipeJson",
    title: () => "Export recipe JSON",
    category: "Export",
    palette: true,
    console: { verb: "export", sub: "json", syntax: "export json", parse: noArgs("export json takes no arguments") },
    enabled: (ctx) => alwaysExportable(ctx),
    run: () => {
      showConsoleTab("recipe");
      announce("Opened the Recipe JSON tab. Copy or download recipe.json there.");
    },
  }),
  command<SafeArgs>({
    id: "export.safe",
    title: () => "Export Safe batch…",
    category: "Export",
    palette: true,
    console: {
      verb: "export",
      sub: "safe",
      syntax: "export safe [Safe address] [chain]",
      parse: (argv) => {
        if (argv.length === 0) return ok({});
        const [address, chain] = argv;
        if (argv.length !== 2 || address === undefined || chain === undefined) {
          return err("export safe takes a Safe address and a chain: export safe 0x71C7…976F sepolia");
        }
        if (!isAddress(address)) return err(`${address} isn't an address. Enter the Safe's full address.`);
        const picked = chainFromText(chain, env.e2e);
        if (!picked) return err(`${chain} isn't a chain Studio deploys to. Name one: ${chainWords()}.`);
        return ok({ safe: toChecksum(address as Address), chainId: picked.id });
      },
    },
    enabled: (ctx) => deployableExport(ctx),
    run: async (_ctx, args) => {
      if (args.safe === undefined || args.chainId === undefined) {
        openDialog("safe-batch", {
          ...(args.safe === undefined ? {} : { safe: args.safe }),
          ...(args.chainId === undefined ? {} : { chainId: args.chainId }),
        });
        return;
      }
      const done = await exportSafe(args.safe, args.chainId);
      if (!done.ok) exportFailed(done.error);
    },
  }),
];
