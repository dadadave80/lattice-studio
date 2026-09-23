import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { VisuallyHidden } from "../shared/VisuallyHidden";
import { Icon } from "./Icon";
import { ICON_NAMES } from "./icon-paths";

describe("Icon", () => {
  test("every icon draws in currentColor and is hidden when unlabelled", async () => {
    await renderWithStudio(
      <p>
        {ICON_NAMES.map((name) => (
          <Icon key={name} name={name} />
        ))}
      </p>,
    );
    const svgs = document.querySelectorAll("svg[data-icon]");
    expect(svgs.length).toBe(ICON_NAMES.length);
    for (const svg of svgs) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.querySelectorAll("path").length).toBeGreaterThan(0);
      const style = getComputedStyle(svg);
      expect(style.fill).toBe("none");
      expect(style.stroke).toBe(style.color);
      expect(svg.getBoundingClientRect().width).toBe(16);
    }
  });

  test("a labelled icon is an image with that name", async () => {
    await renderWithStudio(<Icon name="warning" label="Warning" />);
    await expect.element(page.getByRole("img", { name: "Warning" })).toBeInTheDocument();
  });
});

describe("VisuallyHidden", () => {
  test("is read but not seen", async () => {
    await renderWithStudio(
      <button type="button">
        <Icon name="close" />
        <VisuallyHidden>Close</VisuallyHidden>
      </button>,
    );
    const button = page.getByRole("button", { name: "Close" });
    await expect.element(button).toBeInTheDocument();
    const hidden = button.element().querySelector("span") as HTMLElement;
    expect(hidden.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });
});
