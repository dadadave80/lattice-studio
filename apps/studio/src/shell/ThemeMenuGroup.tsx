import type { ThemeId } from "@lattice-studio/tokens";
import { commandRef, resolveTheme, runCommand, useCommandState, useSettings } from "@/contracts";
import { useMediaQuery } from "@/a11y";
import { MenuRadioGroup } from "@/ui/overlays/MenuRadioGroup";
import { MenuRadioItem } from "@/ui/overlays/MenuRadioItem";

/** Light and Dark as menu radios (the overflow menu's theme switch): the checked one is the theme in use. */
export function ThemeMenuGroup() {
  const choice = useSettings((s) => s.theme);
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme: ThemeId = resolveTheme(choice, prefersDark);
  const dark = useCommandState(commandRef("theme.set", { theme: "dark" }), "menu");
  const light = useCommandState(commandRef("theme.set", { theme: "light" }), "menu");
  return (
    <MenuRadioGroup
      value={theme}
      onValueChange={(next) => {
        if (next === "dark" || next === "light") void runCommand(commandRef("theme.set", { theme: next }), "menu");
      }}
    >
      <MenuRadioItem value="light" label="Light" disabledReason={light.ok ? null : light.reason} />
      <MenuRadioItem value="dark" label="Dark" disabledReason={dark.ok ? null : dark.reason} />
    </MenuRadioGroup>
  );
}
