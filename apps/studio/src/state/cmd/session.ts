/**
 * Undo and redo (Flow 9, spec L488-L494), renaming the project (IR L65) and acknowledging a warning in the
 * deploy review (INIT-05, AUTH-01, NET-08: contracts §3.3 `ack.set`).
 */
import type { ProblemCode } from "@lattice-studio/core";
import { renameProject } from "@lattice-studio/core";
import { command, doc, getAnalysis, session, type CommandArgsOf, type KeyContext } from "@/contracts";
import { studioState } from "../runtime";
import { disabled, edit, guard, isString, OK, sayNote } from "./shared";

type AckArgs = CommandArgsOf<"ack.set">;
type RenameArgs = CommandArgsOf<"project.rename">;

/**
 * Undo and redo are live everywhere except text fields, which keep native text undo (IR L11): the console's
 * command line and the palette's search are text too.
 */
const EVERYWHERE_BUT_TEXT: KeyContext[] = ["global", "sheet", "card-rows", "tree", "list", "menu", "dialog"];

export const NOTHING_TO_UNDO = "Nothing to undo";
export const NOTHING_TO_REDO = "Nothing to redo";

const bare = (verb: string) => ({
  verb,
  syntax: verb,
  parse: (argv: string[]) => (argv.length === 0 ? { ok: true as const, value: {} } : { ok: false as const, error: `${verb} takes no arguments.` }),
});

export const undoCommand = command({
  id: "history.undo",
  title: () => "Undo",
  category: "Session",
  keys: ["Mod+z"],
  keyContext: EVERYWHERE_BUT_TEXT,
  palette: true,
  console: bare("undo"),
  enabled(ctx) {
    const blocked = guard(ctx, false);
    if (blocked) return blocked;
    return doc.state().canUndo ? OK : disabled(NOTHING_TO_UNDO);
  },
  run() {
    // The store logs "Undid: Placed ERC20." and announces it (spec L493); narration follows, dimmed.
    if (doc.undo() === null) sayNote(`${NOTHING_TO_UNDO}.`);
    studioState().analysis.flush();
  },
});

export const redoCommand = command({
  id: "history.redo",
  title: () => "Redo",
  category: "Session",
  keys: ["Mod+Shift+z", { keys: "Ctrl+y", platform: "other" }],
  keyContext: EVERYWHERE_BUT_TEXT,
  palette: true,
  console: bare("redo"),
  enabled(ctx) {
    const blocked = guard(ctx, false);
    if (blocked) return blocked;
    return doc.state().canRedo ? OK : disabled(NOTHING_TO_REDO);
  },
  run() {
    if (doc.redo() === null) sayNote(`${NOTHING_TO_REDO}.`);
    studioState().analysis.flush();
  },
});

export const renameCommand = command<RenameArgs>({
  id: "project.rename",
  title: () => "Rename project",
  category: "Session",
  enabled(ctx, args) {
    const blocked = guard(ctx, false);
    if (blocked) return blocked;
    if (typeof args.name !== "string") return disabled("Give the project a name");
    return OK;
  },
  run(_ctx, { name }) {
    edit((p) => renameProject(p, name));
  },
});

/** What the acknowledgement's button says, per code (spec L326-L342). */
const ACK_TITLES: Partial<Record<ProblemCode, string>> = {
  "CORE-02": "Keep immutable",
  "INIT-05": "Keep example values",
  "AUTH-01": "Keep single key",
  "NET-08": "Cut without the registry check",
};

/** What the console says once it's acknowledged. */
const ACK_LINES: Partial<Record<ProblemCode, string>> = {
  "INIT-05": "Kept the example values for this recipe.",
  "AUTH-01": "Kept the single key for this recipe.",
  "NET-08": "Cutting without the registry check for this recipe.",
};

function codeOf(problemId: string): ProblemCode | undefined {
  const code = problemId.slice(0, problemId.indexOf(":"));
  return code === "" ? undefined : (code as ProblemCode);
}

export const ackCommand = command<AckArgs>({
  id: "ack.set",
  title: ({ problemId }) => {
    const code = isString(problemId) ? codeOf(problemId) : undefined;
    return (code && ACK_TITLES[code]) ?? "Acknowledge";
  },
  category: "Build",
  enabled(ctx, args) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    if (!isString(args.problemId)) return disabled("Name the problem to acknowledge");
    if (ctx.analysis.recipeHash === "0x") return disabled("The analysis hasn't run yet");
    return OK;
  },
  run(ctx, { problemId }) {
    const hash = ctx.analysis.recipeHash;
    const acked = ctx.session.acks[hash] ?? [];
    if (acked.includes(problemId)) {
      sayNote("Already acknowledged for this recipe.");
      return;
    }
    // Acknowledgements live in the session, keyed by recipe hash: never in history (contracts §5.1).
    session.set((s) => ({ acks: { ...s.acks, [hash]: [...(s.acks[hash] ?? []), problemId] } }));
    const code = codeOf(problemId);
    const problem = getAnalysis().problems.find((p) => p.id === problemId);
    const text = (code && ACK_LINES[code]) ?? `Acknowledged: ${problem?.message ?? problemId}`;
    sayNote(text);
  },
});
