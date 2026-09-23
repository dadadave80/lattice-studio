/**
 * The command registry's contract (contracts §5.3). Every `CommandId` starts as a placeholder, disabled with
 * `Not built yet · WP-<owner>`. Each module registers its real commands in its own `commands.ts` with
 * `defineCommands`; a real registration replaces the placeholder, and a second real registration throws.
 * S2 builds the keymap, console router and palette on `listCommands`, `listBindings`, `commandState` and
 * `runCommand`; components render with `useCommandState`.
 */
import type { Analysis, Catalog, CommandId, CommandRef, Json, Project, Result } from "@lattice-studio/core";
import { COMMAND_IDS, COMMAND_OWNERS, isCommandId, isNotImplemented } from "@lattice-studio/core";
import { useSyncExternalStore } from "react";
import { getAnalysis, subscribeAnalysis } from "./analysis";
import { getCatalog, subscribeCatalog } from "./catalog";
import { deployState, useDeployState, type DeployState } from "./deploy";
import { log } from "./kernel";
import { bindingId, type BindingId, type KeyBinding, type KeyContext, type KeySpec } from "./keys";
import { announce, isOnline, useOnline } from "./services";
import { doc, session, settings, type SessionState, type SettingsState } from "./stores";

export type CommandArgs = Record<string, Json>;

export type CommandCategory = "Sheet" | "Build" | "Session" | "Export" | "Deploy" | "Console" | "Chain";

/** Whether a command can run now; when it can't, the reason every surface shows (spec L661). */
export type Enablement = { ok: true } | { ok: false; reason: string; fix?: CommandRef };

/** Where a command was run from. */
export type CommandSource = "keys" | "palette" | "console" | "menu" | "button" | "fix" | "toast" | "api";

/** What `enabled` and `run` see: snapshots of the stores when the command was invoked. */
export type CommandContext = {
  /** The command being checked or run, with its arguments. */
  ref: CommandRef;
  project: Project;
  session: SessionState;
  settings: SettingsState;
  /** Null while the catalog loads or after it failed. */
  catalog: Catalog | null;
  analysis: Analysis;
  online: boolean;
  /** The deploy controller's mirrored state (`idle` until it loads). */
  deploy: DeployState;
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
  /** Default shortcut(s), run with no arguments; remappable as the binding `<command id>`. */
  keys?: KeySpec[];
  /** Shortcuts that run the command with arguments (nudge left, go to inspector); each remappable on its own. */
  bindings?: KeyBinding[];
  /** Where the shortcuts are live. */
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

function pristine(): { entries: Map<CommandId, Entry>; order: CommandId[] } {
  return {
    entries: new Map(COMMAND_IDS.map((id) => [id, { command: placeholder(id), placeholder: true }])),
    order: [...COMMAND_IDS],
  };
}

let { entries, order } = pristine();
let version = 0;
const registryListeners = new Set<() => void>();

function registryChanged(): void {
  version += 1;
  for (const listener of Array.from(registryListeners)) listener();
}

/**
 * Registers real commands, replacing their placeholders. Call it at module level in the module's
 * `commands.ts`. Throws when an id isn't a `CommandId`, already has a real registration, or two bindings of
 * one command share a name.
 */
export function defineCommands(commands: readonly Command[]): void {
  const seen = new Set<CommandId>();
  for (const c of commands) {
    if (!isCommandId(c.id)) throw new Error(`"${String(c.id)}" isn't a command id (contracts §5.3).`);
    const existing = entries.get(c.id);
    if ((existing && !existing.placeholder) || seen.has(c.id)) {
      throw new Error(`Command ${c.id} is already registered. WP-${COMMAND_OWNERS[c.id]} registers it once.`);
    }
    const names = (c.bindings ?? []).map((b) => b.name);
    if (new Set(names).size !== names.length) throw new Error(`Command ${c.id} has two bindings with one name.`);
    seen.add(c.id);
  }
  for (const c of commands) {
    entries.set(c.id, { command: c, placeholder: false });
    // Registration order decides which command a shared console verb tries first.
    order = [...order.filter((id) => id !== c.id), c.id];
  }
  if (commands.length) registryChanged();
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

/** One remappable shortcut: what it runs, its default keys, and the keys in effect after the keymap. */
export type ResolvedBinding = {
  id: BindingId;
  ref: CommandRef;
  label?: string;
  defaults: KeySpec[];
  keys: KeySpec[];
  keyContext?: KeyContext[];
};

/** Every shortcut binding, with `settings.keymap` applied (an empty list unbinds). */
export function listBindings(keymap: SettingsState["keymap"] = settings.get().keymap): ResolvedBinding[] {
  const out: ResolvedBinding[] = [];
  for (const c of listCommands()) {
    const context = c.keyContext ? { keyContext: c.keyContext } : {};
    if (c.keys?.length) {
      const id = bindingId(c.id);
      out.push({ id, ref: { id: c.id }, defaults: c.keys, keys: keymap[id] ?? c.keys, ...context });
    }
    for (const b of c.bindings ?? []) {
      const id = bindingId(c.id, b.name);
      const ref: CommandRef = b.args ? { id: c.id, args: b.args } : { id: c.id };
      out.push({ id, ref, defaults: b.keys, keys: keymap[id] ?? b.keys, ...(b.label ? { label: b.label } : {}), ...context });
    }
  }
  return out;
}

/** Calls back whenever a registration changes the registry. */
export function subscribeCommands(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

/**
 * @internal For tests that register commands: captures the registry and returns a function that restores
 * it. With `{ pristine: true }` the registry starts over from placeholders for the test.
 */
export function snapshotCommands(options: { pristine?: boolean } = {}): () => void {
  const saved = { entries: new Map(entries), order: [...order], listeners: new Set(runListeners) };
  if (options.pristine) {
    ({ entries, order } = pristine());
    registryChanged();
  }
  return () => {
    entries = saved.entries;
    order = saved.order;
    runListeners.clear();
    for (const listener of saved.listeners) runListeners.add(listener);
    registryChanged();
  };
}

/** @internal The harness's `overrideCommands`: replaces commands, real or not, until the returned disposer runs. */
export function overrideCommands(commands: readonly Command[]): () => void {
  const saved = commands.map((c) => [c.id, entries.get(c.id)] as const);
  for (const c of commands) {
    if (!isCommandId(c.id)) throw new Error(`"${String(c.id)}" isn't a command id (contracts §5.3).`);
    entries.set(c.id, { command: c, placeholder: false });
  }
  registryChanged();
  return () => {
    for (const [id, entry] of saved) if (entry) entries.set(id, entry);
    registryChanged();
  };
}

// ---------------------------------------------------------------------------------------------------------
// Running

/** Snapshots of the stores for `enabled` and `run`. Not for render: read stores with hooks there. */
export function commandContext(source: CommandSource, ref: CommandRef): CommandContext {
  return {
    ref,
    project: doc.get(),
    session: session.get(),
    settings: settings.get(),
    catalog: getCatalog(),
    analysis: getAnalysis(),
    online: isOnline(),
    deploy: deployState(),
    source,
  };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `enabled()`, where a throw disables the command: NotImplemented with its reason, anything else logged as an Error. */
function check(c: Command, ctx: CommandContext, args: CommandArgs): Enablement {
  try {
    return c.enabled(ctx, args);
  } catch (error) {
    if (isNotImplemented(error)) return { ok: false, reason: error.message };
    const reason = reasonOf(error);
    log({ tag: "Error", text: `${c.id}: ${reason}` });
    console.error(error);
    return { ok: false, reason };
  }
}

function title(c: Command, args: CommandArgs): string {
  try {
    return c.title(args);
  } catch {
    return c.id;
  }
}

/**
 * A command's title and whether it can run now, for non-render code (the dispatcher, the console, tests).
 * It reads the stores with `get()`, which render must not do (spec L902): components use `useCommandState`.
 */
export function commandState(ref: CommandRef, source: CommandSource = "api"): Enablement & { title: string } {
  const c = getCommand(ref.id);
  const args = ref.args ?? {};
  return { ...check(c, commandContext(source, ref), args), title: title(c, args) };
}

type CommandStateValue = Enablement & { title: string };

function sameState(a: CommandStateValue, b: CommandStateValue): boolean {
  if (a.ok !== b.ok || a.title !== b.title) return false;
  if (a.ok || b.ok) return true;
  return a.reason === b.reason && JSON.stringify(a.fix ?? null) === JSON.stringify(b.fix ?? null);
}

function subscribeEverything(onChange: () => void): () => void {
  const stops = [
    doc.subscribe(onChange),
    session.subscribe(onChange),
    settings.subscribe(onChange),
    subscribeCatalog(onChange),
    subscribeAnalysis(onChange),
    subscribeCommands(onChange),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}

/**
 * A command's title and enablement, re-rendering when either changes: for buttons, menu items, palette rows
 * and tooltips. `ref` may be a new object each render; it's compared by value.
 */
export function useCommandState(ref: CommandRef, source: CommandSource = "button"): CommandStateValue {
  // Online and deploy state re-render through their own hooks; their values reach enabled() via the context.
  useOnline();
  useDeployState((s) => s.phase);
  const key = `${source}|${JSON.stringify(ref)}`;
  return useSyncExternalStore(subscribeEverything, () => stableState(key, ref, source));
}

/** The last value per ref and source, so equal states keep one identity (useSyncExternalStore needs it). */
const stateCache = new Map<string, CommandStateValue>();

function stableState(key: string, ref: CommandRef, source: CommandSource): CommandStateValue {
  const next = commandState(ref, source);
  const cached = stateCache.get(key);
  if (cached && sameState(cached, next)) return cached;
  stateCache.set(key, next);
  return next;
}

const runListeners = new Set<(ref: CommandRef, source: CommandSource) => void>();

/** Subscribes to commands that ran (the palette's Recent group). */
export function onCommandRun(listener: (ref: CommandRef, source: CommandSource) => void): () => void {
  runListeners.add(listener);
  return () => {
    runListeners.delete(listener);
  };
}

/**
 * Runs a command if it's enabled. A disabled command logs and announces its reason and doesn't run; a
 * failure is logged, never thrown, so every surface can call this directly. Resolves with the outcome.
 */
export async function runCommand(ref: CommandRef, source: CommandSource): Promise<Enablement> {
  const c = getCommand(ref.id);
  const args = ref.args ?? {};
  const ctx = commandContext(source, ref);
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
  for (const listener of Array.from(runListeners)) listener(ref, source);
  return { ok: true };
}

/** @internal Registry version, for tests. */
export function commandsVersion(): number {
  return version;
}
