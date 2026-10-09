import { describe, expect, test } from "vitest";
import { renderWithStudio } from "../../../test/harness";
import { Logomark } from "./Logomark";

/** The pinned `lattice/assets/logomark.svg`, path for path. */
const CUTS = [
  "M12 1.5 L22.5 12 L12 22.5 L1.5 12 Z",
  "M12 6.5 L17.5 12 L12 17.5 L6.5 12 Z",
  "M12 1.5 L12 6.5 M22.5 12 L17.5 12 M12 22.5 L12 17.5 M1.5 12 L6.5 12",
];

const mark = () => document.querySelector("svg[data-logomark]") as SVGSVGElement;

describe("Logomark", () => {
  test("draws the mark's three cuts, 1.1 units in currentColor, 19 px, hidden from assistive technology", async () => {
    await renderWithStudio(<Logomark />);
    const svg = mark();
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("stroke-width")).toBe("1.1");
    expect([...svg.querySelectorAll("path")].map((path) => path.getAttribute("d"))).toEqual(CUTS);
    const style = getComputedStyle(svg);
    expect(style.fill).toBe("none");
    expect(style.stroke).toBe(style.color);
    expect(style.strokeLinecap).toBe("butt");
    const box = svg.getBoundingClientRect();
    expect([box.width, box.height]).toEqual([19, 19]);
  });

  test("follows the theme's ink", async () => {
    await renderWithStudio(<Logomark />, { theme: "light" });
    const svg = mark();
    const light = getComputedStyle(svg).stroke;
    document.documentElement.dataset.theme = "dark";
    const dark = getComputedStyle(svg).stroke;
    expect(dark).toBe(getComputedStyle(svg).color);
    expect(dark).not.toBe(light);
  });

  test("renders at a whole pixel", async () => {
    await renderWithStudio(<Logomark size={23.6} />);
    expect(mark().getBoundingClientRect().width).toBe(24);
  });
});
