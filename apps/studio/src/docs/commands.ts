/** `help.open` (contracts §5.3, IR L64's App menu "Help"): opens the problem docs index, or one code's page. */
import { isProblemCode } from "@lattice-studio/core";
import { command, defineCommands, session } from "@/contracts";
import type { CommandArgsMap } from "@/contracts";

defineCommands([
  command<CommandArgsMap["help.open"]>({
    id: "help.open",
    title: (args) => (args.code ? `Learn more about ${args.code}` : "Help"),
    category: "Session",
    palette: true,
    enabled: (_ctx, args) => (args.code !== undefined && !isProblemCode(args.code) ? { ok: false, reason: `"${args.code}" isn't a problem code.` } : { ok: true }),
    run: (_ctx, args) => {
      const view = args.code === undefined ? ({ kind: "doc" } as const) : ({ kind: "doc", code: args.code } as const);
      session.set((s) => ({ panes: { ...s.panes, inspector: { ...s.panes.inspector, open: true, view } } }));
    },
  }),
]);
