/**
 * The command registry's contract (contracts §5.3). Every `CommandId` starts as a placeholder, disabled with
 * `Not built yet · WP-<owner>`. Each module registers its real commands in its own `commands.ts` with
 * `defineCommands`; a real registration replaces the placeholder, and a second real registration throws.
 * S2 builds the keymap, console router and palette on `listCommands`, `commandState` and `runCommand`.
 */
import type { Analysis, Catalog, CommandId, CommandRef, Json, Project, Result } from "@lattice-studio/core";
import { COMMAND_IDS, COMMAND_OWNERS, isCommandId, isNotImplemented } from "@lattice-studio/core";
import { getAnalysis } from "./analysis";
import { getCatalog } from "./catalog";
import type { KeyContext, KeySpec } from "./keys";
import { announce, isOnline, log } from "./services";
import { doc, session, settings, type SessionState, type SettingsState } from "./stores";

export type CommandArgs = Record<string, Json>;

export type CommandCategory = "Sheet" | "Build" | "Session" | "Export" | "Deploy" | "Console" | "Chain";

/** Whether a command can run now; when it can't, the reason every surface shows (spec L661). */
export type Enablement = { ok: true } | { ok: false; reason: string; fix?: CommandRef };

/** Where a command was run from. */
export type CommandSource = "keys" | "palette" | "console" | "menu" | "button" | "fix" | "toast" | "api";

/** What `enabled` and `run` see: snapshots of the stores when the command was invoked. */
export type CommandContext = {
  project: Project;
  session: SessionState;
  settings: SettingsState;
  /** Null while the catalog loads or after it failed. */
  catalog: Catalog | null;
  analysis: Analysis;
  online: boolean;
  source: CommandSource;
};

/** A console verb. Several commands can share a verb, told apart by `sub` or by whose `parse` accepts. */
export type CommandConsole<A> = {
  verb: string;
  /** A fixed first argument: `export foundry` is `export.foundry`. */
  sub?: string;
  aliases?: string[];
  /** Shown in help and palette rows: "place <facet>". */
  syntax: string;
  parse(argv: string[]): Result<A, string>;
};

export type Command<A = CommandArgs> = {
  id: CommandId;
  /** "Place ERC20", "Route to HyperlaneGatewayAdapter". */
  title: (args: A) => string;
  category: CommandCategory;
  /** Default shortcut(s); remappable. */
  keys?: KeySpec[];
  /** Where the shortcut is live. */
  keyContext?: KeyContext[];
  console?: CommandConsole<A>;
  /** Listed in the palette's Commands group. */
  palette?: boolean;
  enabled(ctx: CommandContext, args: A): Enablement;
  run(ctx: CommandContext, args: A): void | Promise<void>;
};

/** Erases a command's argument type for registration: `defineCommands([command<PlaceArgs>({ … })])`. */
export function command<A extends CommandArgs>(definition: Command<A>): Command {
  return definition as unknown as Command;
}

// ---------------------------------------------------------------------------------------------------------
// Registry

type Entry = { command: Command; placeholder: boolean };

function placeholderCategory(id: CommandId): CommandCategory {
  const [head] = id.split(".");
  switch (head) {
    case "sheet": case "tool": case "layout": case "initOrder":
      return "Sheet";
    case "facet": case "selector": case "recipe": case "init": case "ack": case "collision": case "problem":
    case "dependency": case "authority": case "inspector": case "catalog": case "plan":
      return "Build";
    case "export":
      return "Export";
    case "deploy": case "deployments":
      return "Deploy";
    case "console":
      return "Console";
    case "chain": case "wallet":
      return "Chain";
    default:
      return "Session";
  }
}

/** The placeholder for `id`: disabled with `Not built yet · WP-<owner>`, and says so if run anyway. */
function placeholder(id: CommandId): Command {
  const reason = `Not built yet · WP-${COMMAND_OWNERS[id]}`;
  return {
    id,
    title: () => id,
    category: placeholderCategory(id),
    enabled: () => ({ ok: false, reason }),
    run: () => {
      log({ tag: "Note", text: reason });
    },
  };
}

let entries = new Map<CommandId, Entry>();
let order: CommandId[] = [];

function resetEntries(): void {
  entries = new Map(COMMAND_IDS.map((id) => [id, { command: placeholder(id), placeholder: true }]));
  order = [...COMMAND_IDS];
}

resetEntries();

/**
 * Registers real commands, replacing their placeholders. Call it at module level in the module's
 * `commands.ts`. Throws when an id isn't a `CommandId` or already has a real registration.
 */
export function defineCommands(commands: readonly Command[]): void {
  const seen = new Set<CommandId>();
  for (const c of commands) {
    if (!isCommandId(c.id)) throw new Error(`"${String(c.id)}" isn't a command id (contracts §5.3).`);
    const existing = entries.get(c.id);
    if ((existing && !existing.placeholder) || seen.has(c.id)) {
      throw new Error(`Command ${c.id} is already registered. WP-${COMMAND_OWNERS[c.id]} registers it once.`);
    }
    seen.add(c.id);
  }
  for (const c of commands) {
    entries.set(c.id, { command: c, placeholder: false });
    // Registration order decides which command a shared console verb tries first.
    order = [...order.filter((id) => id !== c.id), c.id];
  }
}

export function getCommand(id: CommandId): Command {
  const entry = entries.get(id);
  if (!entry) throw new Error(`"${id}" isn't a command id (contracts §5.3).`);
  return entry.command;
}

/** Every command: placeholders first in §5.3's order, then real ones in registration order. */
export function listCommands(): Command[] {
  return order.map((id) => getCommand(id));
}

/** True while `id` has no real registration. */
export function isPlaceholder(id: CommandId): boolean {
  return entries.get(id)?.placeholder ?? true;
}

/**
 * @internal For tests that register commands: captures the registry and returns a function that restores
 * it, so one test's registrations don't leak into the next.
 */
export function snapshotCommands(): () => void {
  const savedEntries = new Map(entries);
  const savedOrder = [...order];
  const savedListeners = new Set(runListeners);
  return () => {
    entries = savedEntries;
    order = savedOrder;
    runListeners.clear();
    for (const listener of savedListeners) runListeners.add(listener);
  };
}

// ---------------------------------------------------------------------------------------------------------
// Running

/** Snapshots of the stores for `enabled` and `run`. */
export function commandContext(source: CommandSource): CommandContext {
  return {
    project: doc.get(),
    session: session.get(),
    settings: settings.get(),
    catalog: getCatalog(),
    analysis: getAnalysis(),
    online: isOnline(),
    source,
  };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function check(c: Command, ctx: CommandContext, args: CommandArgs): Enablement {
  try {
    return c.enabled(ctx, args);
  } catch (error) {
    if (isNotImplemented(error)) return { ok: false, reason: error.message };
    throw error;
  }
}

/** A command's title and whether it can run now, for buttons, menus, palette rows and tooltips. */
export function commandState(ref: CommandRef, source: CommandSource = "api"): Enablement & { title: string } {
  const c = getCommand(ref.id);
  const args = ref.args ?? {};
  return { ...check(c, commandContext(source), args), title: c.title(args) };
}

const runListeners = new Set<(ref: CommandRef, source: CommandSource) => void>();

/** Subscribes to commands that ran (the palette's Recent group). */
export function onCommandRun(listener: (ref: CommandRef, source: CommandSource) => void): () => void {
  runListeners.add(listener);
  return () => runListeners.delete(listener);
}

/**
 * Runs a command if it's enabled. A disabled command logs and announces its reason and doesn't run; a
 * failure is logged, never thrown, so every surface can call this directly. Resolves with the outcome.
 */
export async function runCommand(ref: CommandRef, source: CommandSource): Promise<Enablement> {
  const c = getCommand(ref.id);
  const args = ref.args ?? {};
  const ctx = commandContext(source);
  const enablement = check(c, ctx, args);
  if (!enablement.ok) {
    log({ tag: "Note", text: enablement.reason });
    announce(enablement.reason);
    return enablement;
  }
  try {
    await c.run(ctx, args);
  } catch (error) {
    const reason = reasonOf(error);
    log({ tag: isNotImplemented(error) ? "Note" : "Error", text: reason });
    if (!isNotImplemented(error)) console.error(error);
    return { ok: false, reason };
  }
  for (const listener of runListeners) listener(ref, source);
  return { ok: true };
}
