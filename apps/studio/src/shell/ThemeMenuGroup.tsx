import type { ThemeId } from "@lattice-studio/tokens";
import { commandRef, resolveTheme, runCommand, useCommandState, useSettings } from "@/contracts";
import { useMediaQuery } from "@/a11y";
import { MenuRadioGroup, MenuRadioItem } from "@/ui";

/** Shop and Draft as menu radios (the overflow menu's theme switch): the checked one is the theme in use. */
export function ThemeMenuGroup() {
  const choice = useSettings((s) => s.theme);
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme: ThemeId = resolveTheme(choice, prefersDark);
  const shop = useCommandState(commandRef("theme.set", { theme: "shop" }), "menu");
  const draft = useCommandState(commandRef("theme.set", { theme: "draft" }), "menu");
  return (
    <MenuRadioGroup
      value={theme}
      onValueChange={(next) => {
        if (next === "shop" || next === "draft") void runCommand(commandRef("theme.set", { theme: next }), "menu");
      }}
    >
      <MenuRadioItem value="shop" label="Shop" disabledReason={shop.ok ? null : shop.reason} />
      <MenuRadioItem value="draft" label="Draft" disabledReason={draft.ok ? null : draft.reason} />
    </MenuRadioGroup>
  );
}
