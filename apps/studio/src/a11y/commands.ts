// S9's commands (contracts §5.3): region.next, region.prev and region.focus (spec L743, IR L16).
import { announce, command, defineCommands, log, REGION_IDS, REGION_LABELS, type CommandArgsOf, type KeyBinding } from "@/contracts";
import { cycleRegion, dialogReason, goToRegion, toastsShowing } from "./regions";

type FocusArgs = CommandArgsOf<"region.focus">;

/** "Go to inspector": one binding per region, unbound by default and remappable; every region but the toasts is a palette row. */
const GO_TO: KeyBinding[] = REGION_IDS.map((region) => ({
  name: region,
  keys: [],
  args: { region },
  label: `Go to ${REGION_LABELS[region].toLowerCase()}`,
  palette: region !== "toasts",
}));

function cycle(step: 1 | -1): void {
  if (!cycleRegion(step)) {
    const text = "No regions are showing.";
    log({ tag: "Note", text });
    announce(text);
  }
}

defineCommands([
  command({
    id: "region.next",
    title: () => "Next region",
    category: "Session",
    keys: ["F6", { keys: "Ctrl+F6", platform: "other" }],
    keyContext: ["global"],
    enabled: () => {
      const reason = dialogReason();
      return reason ? { ok: false, reason } : { ok: true };
    },
    run: () => cycle(1),
  }),
  command({
    id: "region.prev",
    title: () => "Previous region",
    category: "Session",
    keys: ["Shift+F6", { keys: "Ctrl+Shift+F6", platform: "other" }],
    keyContext: ["global"],
    enabled: () => {
      const reason = dialogReason();
      return reason ? { ok: false, reason } : { ok: true };
    },
    run: () => cycle(-1),
  }),
  command<FocusArgs>({
    id: "region.focus",
    title: ({ region }) => (region in REGION_LABELS ? `Go to ${REGION_LABELS[region].toLowerCase()}` : "Go to region"),
    category: "Session",
    bindings: GO_TO,
    keyContext: ["global"],
    enabled: (_ctx, { region }) => {
      if (!REGION_IDS.includes(region)) return { ok: false, reason: `"${String(region)}" isn't a region.` };
      const reason = dialogReason();
      if (reason) return { ok: false, reason };
      if (region === "toasts" && !toastsShowing()) return { ok: false, reason: "No notifications are showing." };
      return { ok: true };
    },
    run: async (_ctx, { region }) => {
      const result = await goToRegion(region);
      if (result.ok) return;
      log({ tag: "Note", text: result.text });
      announce(result.text);
    },
  }),
]);
