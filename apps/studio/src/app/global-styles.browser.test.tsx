import { Select as BaseSelect } from "@base-ui/react/select";
import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { renderWithStudio } from "../../test/harness";

const OPTIONS = Array.from({ length: 60 }, (_, i) => ({ value: `chain-${i}`, label: `Chain ${i + 1}` }));

/**
 * A Base UI Select whose list scrolls with arrows: Base UI marks the list `base-ui-disable-scrollbar` and would
 * hide its scrollbar with an injected <style>, which the app turns off.
 */
function ArrowSelect() {
  return (
    <BaseSelect.Root items={OPTIONS} defaultValue="chain-0">
      <BaseSelect.Trigger aria-label="Network">
        <BaseSelect.Value />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner alignItemWithTrigger={false}>
          <BaseSelect.Popup>
            <BaseSelect.ScrollUpArrow />
            <BaseSelect.List style={{ maxBlockSize: "200px", overflowY: "auto" }}>
              {OPTIONS.map((option) => (
                <BaseSelect.Item key={option.value} value={option.value} label={option.label}>
                  <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
            <BaseSelect.ScrollDownArrow />
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

describe("global styles", () => {
  test("Base UI's injected scrollbar rules ship as CSS (spec L863): a Select popup that scrolls shows no scrollbar", async () => {
    await renderWithStudio(<ArrowSelect />);
    await page.getByRole("combobox", { name: "Network" }).click();
    await expect.element(page.getByRole("option", { name: "Chain 60" })).toBeInTheDocument();
    // The app renders Base UI with `disableStyleElements` (CSP), so Base UI adds no <style> of its own.
    expect(document.querySelector("style[data-precedence^='base-ui'], style[href='base-ui-disable-scrollbar']")).toBeNull();
    const scroller = document.querySelector<HTMLElement>(".base-ui-disable-scrollbar");
    if (!scroller) throw new Error("No element carries base-ui-disable-scrollbar.");
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
    const style = getComputedStyle(scroller);
    expect(style.scrollbarWidth).toBe("none");
    // No gutter: the scrollbar takes no room beside the options.
    const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    expect(scroller.offsetWidth - scroller.clientWidth - borders).toBe(0);
  });

  test("the rules come in both forms, for browsers without scrollbar-width", () => {
    const rules = [...document.styleSheets].flatMap((sheet) => {
      try {
        return [...sheet.cssRules].map((rule) => rule.cssText);
      } catch {
        return [];
      }
    });
    expect(rules).toContain(".base-ui-disable-scrollbar { scrollbar-width: none; }");
    expect(rules).toContain(".base-ui-disable-scrollbar::-webkit-scrollbar { display: none; }");
  });
});
