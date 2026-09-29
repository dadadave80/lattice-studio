// S10's commands (contracts §5.3): settings.open, theme.set, tour.start, tour.end, about.open.
import {
  command, defineCommands, log, openDialog, settings, type Command, type CommandArgsOf, type ThemeChoice,
} from "@/contracts";
import { endTour, startTour, tourState } from "../tour/tour-state";

const THEME_LABEL: Record<ThemeChoice, string> = { light: "Light", dark: "Dark", system: "System" };

/** Own keys only: `constructor`, `toString` and `__proto__` are on every object's prototype, never themes. */
function isTheme(value: string): value is ThemeChoice {
  return Object.hasOwn(THEME_LABEL, value);
}

/** The theme's label, or what was given when it isn't one. */
function themeLabel(value: string): string {
  return isTheme(value) ? THEME_LABEL[value] : value;
}

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
    title: ({ theme }) => `Set theme to ${themeLabel(theme)}`,
    category: "Session",
    // IR L158: `theme <light, dark or system>`, case-insensitive; run() confirms with the "Theme: X." line.
    console: {
      verb: "theme",
      syntax: "theme <light, dark or system>",
      parse: (argv) => {
        const text = argv.join(" ").trim();
        const theme = text.toLowerCase();
        if (isTheme(theme)) return { ok: true, value: { theme } };
        return { ok: false, error: `${text === "" ? "theme takes" : `“${text}” isn't a theme. Choose`} light, dark or system.` };
      },
    },
    enabled: (_ctx, { theme }) => (isTheme(theme) ? { ok: true } : { ok: false, reason: `"${theme}" isn't a theme.` }),
    run: (_ctx, { theme }) => {
      settings.set({ theme });
      log({ tag: "Note", text: `Theme: ${themeLabel(theme)}.` });
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
