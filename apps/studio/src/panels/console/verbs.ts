/**
 * The console's verbs as the command line and `help` see them (IR L137, L151): the registered verbs, the nearest
 * one to a mistyped word, and `help [verb]`. Behind the console body's boundary with S2's router, which only the
 * console reads; `definitions.ts` reaches `help` through `loadConsoleBody()`.
 */
import type { CommandRef } from "@lattice-studio/core";
import { announce, getCommand, log, subscribeCommands } from "@/contracts";
import { helpLines, listVerbs } from "@/commands/console/router";
import { nearestVerb, type VerbWords } from "./suggest";

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

function say(text: string): void {
  log({ tag: "Note", text });
  announce(text);
}

function safeTitle(ref: CommandRef): string | null {
  try {
    const title = getCommand(ref.id).title(ref.args ?? {});
    return /undefined|\{|\[object/.test(title) ? null : title;
  } catch {
    return null;
  }
}

/** `help`: every verb; `help <verb>`: each form of it with its title and aliases. */
export function help(verb: string | undefined): void {
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
