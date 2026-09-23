import type { ThemeId } from "@lattice-studio/tokens";
import { commandRef, resolveTheme, runCommand, useCommandState, useSettings } from "@/contracts";
import { useMediaQuery } from "@/a11y";
import { SegmentedToggle } from "@/ui";

const OPTIONS = [
  { value: "shop", label: "Shop" },
  { value: "draft", label: "Draft" },
] as const;

/** The Shop / Draft switch (IR L71): runs `theme.set`; not an undo step. "System" shows the theme it resolves to. */
export function ThemeSwitch({ className }: { className?: string }) {
  const choice = useSettings((s) => s.theme);
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme: ThemeId = resolveTheme(choice, prefersDark);
  const other: ThemeId = theme === "shop" ? "draft" : "shop";
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
