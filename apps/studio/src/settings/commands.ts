// S10's commands (contracts §5.3): settings.open, theme.set, tour.start, tour.end, about.open.
import {
  command, defineCommands, log, openDialog, settings, type Command, type CommandArgsOf, type ThemeChoice,
} from "@/contracts";
import { endTour, startTour, tourState } from "../tour/tour-state";

const THEME_LABEL: Record<ThemeChoice, string> = { shop: "Shop", draft: "Draft", system: "System" };

type ThemeArgs = CommandArgsOf<"theme.set">;

/** Exported so `commands.test.ts` can re-register them after `isolateContracts()` resets the registry. */
export const S10_COMMANDS: readonly Command[] = [
  command({
    id: "settings.open",
    title: () => "Open Settings",
    category: "Session",
    palette: true,
    enabled: () => ({ ok: true }),
    run: () => {
      openDialog("settings");
      log({ tag: "Note", text: "Opened Settings." });
    },
  }),
  command({
    id: "about.open",
    title: () => "Open About",
    category: "Session",
    palette: true,
    enabled: () => ({ ok: true }),
    run: () => {
      openDialog("about");
      log({ tag: "Note", text: "Opened About." });
    },
  }),
  command<ThemeArgs>({
    id: "theme.set",
    title: ({ theme }) => `Set theme to ${THEME_LABEL[theme]}`,
    category: "Session",
    enabled: (_ctx, { theme }) => (theme in THEME_LABEL ? { ok: true } : { ok: false, reason: `"${theme}" isn't a theme.` }),
    run: (_ctx, { theme }) => {
      settings.set({ theme });
      log({ tag: "Note", text: `Theme: ${THEME_LABEL[theme]}.` });
    },
  }),
  command({
    id: "tour.start",
    title: () => "Take the tour",
    category: "Session",
    palette: true,
    enabled: () => (tourState().running ? { ok: false, reason: "The tour is already running." } : { ok: true }),
    run: () => {
      startTour();
      log({ tag: "Note", text: "Started the tour." });
    },
  }),
  command({
    id: "tour.end",
    title: () => "End tour",
    category: "Session",
    enabled: () => (tourState().running ? { ok: true } : { ok: false, reason: "The tour isn't running." }),
    run: () => {
      endTour();
      log({ tag: "Note", text: "Ended the tour." });
    },
  }),
];

defineCommands(S10_COMMANDS);
