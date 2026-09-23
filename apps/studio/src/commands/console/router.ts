/**
 * The console router (contracts §5.3, IR L141-L160): a typed line to a command and its arguments. Several
 * commands can share a verb: a `sub` names a fixed first argument (`export foundry`, `export project`);
 * without one, the verb's commands are tried in registration order and the first whose `parse` accepts the
 * arguments runs (`route <facet>` is `facet.routeContested`, `route <facet> <selector>` is `selector.route`).
 * S5e's command line echoes, suggests and logs on top of this.
 */
import type { CommandId, CommandRef } from "@lattice-studio/core";
import { listCommands, runCommand, log, type Command, type Enablement } from "@/contracts";

/**
 * Splits a console line into words. Double or single quotes (straight or curly) keep spaces inside one word
 * and are removed: `set erc20init.name "My vault"` is `["set", "erc20init.name", "My vault"]`.
 */
export function tokenize(line: string): string[] {
  const words: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|“([^”]*)”|‘([^’]*)’|(\S+)/g;
  for (const m of line.matchAll(pattern)) words.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "");
  return words;
}

/** One way to use a verb: the command, its syntax ("route <facet> <selector or function>") and title. */
export type ConsoleForm = { command: Command; syntax: string; sub?: string };

const lower = (word: string) => word.toLowerCase();

/** Every form of `verb` (or one of its aliases), in registration order. */
export function formsOf(verb: string): ConsoleForm[] {
  const word = lower(verb);
  const forms: ConsoleForm[] = [];
  for (const c of listCommands()) {
    const con = c.console;
    if (!con) continue;
    if (lower(con.verb) !== word && !(con.aliases ?? []).some((a) => lower(a) === word)) continue;
    forms.push({ command: c, syntax: con.syntax, ...(con.sub === undefined ? {} : { sub: con.sub }) });
  }
  return forms;
}

/** A verb and its aliases, for `help` and S5e's nearest-verb suggestion. */
export type ConsoleVerb = { verb: string; aliases: string[]; forms: ConsoleForm[] };

/** Every console verb, in the order their first command registered. */
export function listVerbs(): ConsoleVerb[] {
  const byVerb = new Map<string, ConsoleVerb>();
  for (const c of listCommands()) {
    const con = c.console;
    if (!con) continue;
    const key = lower(con.verb);
    const entry = byVerb.get(key) ?? { verb: con.verb, aliases: [], forms: [] };
    for (const alias of con.aliases ?? []) if (!entry.aliases.includes(alias)) entry.aliases.push(alias);
    entry.forms.push({ command: c, syntax: con.syntax, ...(con.sub === undefined ? {} : { sub: con.sub }) });
    byVerb.set(key, entry);
  }
  return [...byVerb.values()];
}

export type Routed =
  /** The line names a command with arguments it accepts. */
  | { ok: true; ref: CommandRef; command: Command; syntax: string }
  /** It doesn't: why, and the verb's forms when it has any (empty for an unknown verb). */
  | { ok: false; error: string; forms: ConsoleForm[] };

/** How many words a syntax takes after its verb and sub: `<x>` is required, `[x]` optional. */
function arity(form: ConsoleForm): { min: number; max: number } {
  const groups = form.syntax.match(/<[^>]*>|\[[^\]]*\]/g) ?? [];
  const min = groups.filter((g) => g.startsWith("<")).length;
  return { min, max: groups.length };
}

/** Resolves `argv` (a tokenized line). Nothing runs. */
export function route(argv: readonly string[]): Routed {
  const [verb, ...rest] = argv;
  if (verb === undefined || verb === "") return { ok: false, error: "Type a command. Type help for commands.", forms: [] };
  const forms = formsOf(verb);
  if (!forms.length) return { ok: false, error: `“${verb}” isn't a command. Type help for commands.`, forms: [] };

  const first = rest[0] === undefined ? undefined : lower(rest[0]);
  const withSub = forms.filter((f) => f.sub !== undefined && lower(f.sub) === first);
  const bare = forms.filter((f) => f.sub === undefined);
  const attempts = [
    ...withSub.map((f) => ({ form: f, argv: rest.slice(1) })),
    ...bare.map((f) => ({ form: f, argv: rest })),
  ];
  const errors: { form: ConsoleForm; error: string; fits: boolean }[] = [];
  for (const { form, argv: args } of attempts) {
    const parsed = form.command.console?.parse([...args]);
    if (!parsed) continue;
    if (parsed.ok) {
      const ref: CommandRef = Object.keys(parsed.value).length ? { id: form.command.id, args: parsed.value } : { id: form.command.id };
      return { ok: true, ref, command: form.command, syntax: form.syntax };
    }
    const { min, max } = arity(form);
    errors.push({ form, error: parsed.error, fits: args.length >= min && args.length <= max });
  }
  // The error of the form the words fit best: a sub that matched, else one whose arity fits, else the first.
  const best = errors.find((e) => e.form.sub !== undefined) ?? errors.find((e) => e.fits) ?? errors[0];
  if (best) return { ok: false, error: best.error, forms };
  const subs = forms.filter((f) => f.sub !== undefined).map((f) => f.sub);
  return { ok: false, error: `${verb} takes one of: ${subs.join(", ")}.`, forms };
}

/**
 * Runs a typed line through the registry (source `console`). An unknown verb or arguments no form accepts
 * log the reason as a Note; a disabled command logs its reason through `runCommand`.
 */
export async function runConsoleLine(line: string): Promise<Enablement> {
  const routed = route(tokenize(line));
  if (!routed.ok) {
    log({ tag: "Note", text: routed.error });
    return { ok: false, reason: routed.error };
  }
  return runCommand(routed.ref, "console");
}

/** One line of `help`: a form's syntax, the command it runs and the verb's aliases. */
export type HelpLine = { syntax: string; id: CommandId; aliases: string[] };

/**
 * What `help [verb]` lists: every form of `verb` (each shared form of `export` and `route`), or one line per
 * form of every verb. Null for a verb Studio doesn't have.
 */
export function helpLines(verb?: string): HelpLine[] | null {
  const verbs = listVerbs();
  const chosen = verb === undefined
    ? verbs
    : verbs.filter((v) => lower(v.verb) === lower(verb) || v.aliases.some((a) => lower(a) === lower(verb)));
  if (verb !== undefined && !chosen.length) return null;
  return chosen.flatMap((v) => v.forms.map((f) => ({ syntax: f.syntax, id: f.command.id, aliases: v.aliases })));
}
