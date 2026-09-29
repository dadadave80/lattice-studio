import type { ThemeId } from "@lattice-studio/tokens";
import { commandRef, resolveTheme, runCommand, useCommandState, useSettings } from "@/contracts";
import { useMediaQuery } from "@/a11y";
import { SegmentedToggle } from "@/ui/fields/SegmentedToggle";

const OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

/** The Light / Dark switch (IR L71): runs `theme.set`; not an undo step. "System" shows the theme it resolves to. */
export function ThemeSwitch({ className }: { className?: string }) {
  const choice = useSettings((s) => s.theme);
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme: ThemeId = resolveTheme(choice, prefersDark);
  const other: ThemeId = theme === "dark" ? "light" : "dark";
  const state = useCommandState(commandRef("theme.set", { theme: other }));
  return (
    <SegmentedToggle
      label="Theme"
      value={theme}
      options={OPTIONS}
      disabledReason={state.ok ? null : state.reason}
      onValueChange={(next) => void runCommand(commandRef("theme.set", { theme: next }), "button")}
      className={className}
    />
  );
}
