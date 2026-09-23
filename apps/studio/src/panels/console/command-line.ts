/**
 * What Enter on the command line does (IR L137): echo the line ("› place governor"), then run it through S2's
 * router. Input that names no verb gets the nearest one as a suggestion; everything else is the router's and the
 * command's to answer. Output goes to the Log, so the Log tab comes forward first.
 */
import { log } from "@/contracts";
import { route, runConsoleLine, tokenize } from "@/commands/console/router";
import { unknownVerb } from "./verbs";
import { showConsoleTab } from "./drawer";

/** The echo of a typed line: dim, so output stands out under it. */
export function echoText(line: string): string {
  return `› ${line}`;
}

export async function submitLine(input: string): Promise<void> {
  const line = input.trim();
  if (line === "") return;
  showConsoleTab("log");
  log({ tag: "Note", dim: true, text: echoText(line) });
  const argv = tokenize(line);
  const routed = route(argv);
  const [verb] = argv;
  if (!routed.ok && routed.forms.length === 0 && verb !== undefined) {
    log({ tag: "Note", text: unknownVerb(verb) });
    return;
  }
  await runConsoleLine(line);
}

/** The command line's history, oldest first, without consecutive repeats; kept for the session. */
const history: string[] = [];
export const HISTORY_CAP = 100;

export function remember(line: string): void {
  const trimmed = line.trim();
  if (trimmed === "" || history.at(-1) === trimmed) return;
  history.push(trimmed);
  if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
}

export function commandHistory(): readonly string[] {
  return history;
}

/** @internal Tests. */
export function clearCommandHistory(): void {
  history.length = 0;
}
