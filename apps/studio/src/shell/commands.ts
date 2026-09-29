/**
 * S3's commands (contracts §5.3): `app.menu`, `pane.toggle` and `pane.show`. The pane commands work at every
 * tier: they open a pane, its drawer (1024-1279 and 768-1023 px) or its switcher tab (under 768 px), so
 * "Go to inspector" (S9) and the pane switcher reach every region at any width.
 */
import {
  announce, command, defineCommands, log, session, type CommandArgsOf, type Enablement,
} from "@/contracts";
import { appMenuMounted, setAppMenuOpen } from "./app-menu-state";
import { currentTier } from "./layout-tier";
import {
  PANE_NAMES, paneSubject, showPane, togglePane, toggledShowing, type Panes, type ShownPane, type ToggledPane,
} from "./panes";

type ShowArgs = CommandArgsOf<"pane.show">;
type ToggleArgs = CommandArgsOf<"pane.toggle">;

const SHOWN: readonly ShownPane[] = ["sheet", "catalog", "structure", "inspector", "console"];
const TOGGLED: readonly ToggledPane[] = ["left", "inspector", "console"];

const SHOW_TITLES: Readonly<Record<ShownPane, string>> = {
  sheet: "Show sheet",
  catalog: "Show catalog",
  structure: "Show Structure",
  inspector: "Show inspector",
  console: "Show console",
};

const TOGGLE_TITLES: Readonly<Record<ToggledPane, string>> = {
  left: "Toggle left pane",
  inspector: "Toggle inspector",
  console: "Toggle console",
};

const OK: Enablement = { ok: true };

function say(text: string): void {
  log({ tag: "Note", text });
  announce(text);
}

function setPanes(next: Panes): void {
  session.set((s) => (s.panes === next ? s : { panes: next }));
}

export const appMenuCommand = command({
  id: "app.menu",
  title: () => "Open the App menu",
  category: "Session",
  palette: true,
  enabled: () => OK,
  run() {
    if (!appMenuMounted()) {
      say("The App menu isn't showing.");
      return;
    }
    setAppMenuOpen(true);
  },
});

export const paneShowCommand = command<ShowArgs>({
  id: "pane.show",
  title: (args) => SHOW_TITLES[args.pane] ?? "Show pane",
  category: "Session",
  bindings: SHOWN.map((pane) => ({ name: pane, keys: [], args: { pane }, palette: true })),
  enabled: (_ctx, args) => (SHOWN.includes(args.pane) ? OK : { ok: false, reason: `"${String(args.pane)}" isn't a pane.` }),
  run(_ctx, { pane }) {
    const panes = session.get().panes;
    const next = showPane(panes, currentTier(), pane);
    if (next === panes) {
      say(`${paneSubject(pane)} is already showing.`);
      return;
    }
    setPanes(next);
    announce(`Showing ${PANE_NAMES[pane]}.`);
  },
});

export const paneToggleCommand = command<ToggleArgs>({
  id: "pane.toggle",
  title: (args) => TOGGLE_TITLES[args.pane] ?? "Toggle pane",
  category: "Session",
  bindings: (["left", "inspector"] as const).map((pane) => ({ name: pane, keys: [], args: { pane }, palette: true })),
  enabled: (_ctx, args) => (TOGGLED.includes(args.pane) ? OK : { ok: false, reason: `"${String(args.pane)}" isn't a pane.` }),
  run(_ctx, { pane }) {
    const panes = session.get().panes;
    const tier = currentTier();
    const hiding = toggledShowing(panes, tier, pane);
    setPanes(togglePane(panes, tier, pane));
    const name = pane === "left" ? PANE_NAMES[panes.left.tab] : PANE_NAMES[pane];
    announce(hiding ? `Hid ${name}.` : `Showing ${name}.`);
  },
});

defineCommands([appMenuCommand, paneShowCommand, paneToggleCommand]);
