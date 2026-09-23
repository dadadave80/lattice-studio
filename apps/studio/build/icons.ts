/**
 * The app icons, drawn from the logomark exactly as `design/logos/` ships it (two concentric diamonds joined
 * by four struts on a 24-unit grid; display cut 0.75 stroke from 40 px up, small cut 1.1 below). The mark is
 * only scaled and coloured: Off-white on the Shop ground, never redrawn, restroked, filled or rounded.
 *
 * `bun apps/studio/build/icons.ts` renders the PNGs and `favicon.ico` into `public/` with ImageMagick, and
 * writes `favicon.svg`. The outputs are committed; the build never shells out to ImageMagick.
 */
import { themeColors } from "@lattice-studio/tokens";

/** The logomark's paths, verbatim from `logomark.svg` and `logomark-small.svg`. */
const MARK_PATHS = [
  "M12 1.5 L22.5 12 L12 22.5 L1.5 12 Z",
  "M12 6.5 L17.5 12 L12 17.5 L6.5 12 Z",
  "M12 1.5 L12 6.5 M22.5 12 L17.5 12 M12 22.5 L12 17.5 M1.5 12 L6.5 12",
] as const;

export const DISPLAY_STROKE = 0.75;
export const SMALL_STROKE = 1.1;

/** Ground and ink of the icons: the Shop theme, which Studio opens in. */
export const ICON_GROUND = themeColors.shop.ground;
export const ICON_INK = themeColors.shop.text;

/** The mark's own drawing, in its 24-unit box, stroked with `color`. */
export function markPaths(stroke: number, color?: string): string {
  const paint = color ? ` stroke="${color}"` : "";
  return MARK_PATHS.map((d, i) => {
    const join = i < 2 ? ' stroke-linejoin="miter"' : "";
    return `<path d="${d}"${paint} stroke-width="${stroke}"${join}/>`;
  }).join("");
}

type Point = readonly [number, number];

/** The mark's subpaths as point lists, read from the path data; `closed` for the two diamonds. */
export function markShapes(): { points: Point[]; closed: boolean }[] {
  const shapes: { points: Point[]; closed: boolean }[] = [];
  for (const d of MARK_PATHS) {
    for (const sub of d.split("M").map((s) => s.trim()).filter(Boolean)) {
      const closed = sub.endsWith("Z");
      const points = sub
        .replace("Z", "")
        .split("L")
        .map((pair): Point => {
          const [x = 0, y = 0] = pair.trim().split(/\s+/).map(Number);
          return [x, y];
        });
      shapes.push({ points, closed });
    }
  }
  return shapes;
}

/**
 * ImageMagick arguments that draw a square icon of `size` px: the Shop ground, with the mark scaled so its
 * 24-unit box spans `markShare` of the side (the box already carries 1.5 units of margin). ImageMagick's own
 * SVG renderer drops strokes, so the mark is drawn with its primitives from the same path data.
 */
export function iconDrawArgs(size: number, options: { markShare: number; stroke: number }): string[] {
  const scale = (size * options.markShare) / 24;
  const offset = (size - 24 * scale) / 2;
  const at = ([x, y]: Point) => `${offset + x * scale},${offset + y * scale}`;
  const args = [
    "-size", `${size}x${size}`, `xc:${ICON_GROUND}`,
    "-fill", "none", "-stroke", ICON_INK, "-strokewidth", String(options.stroke * scale),
  ];
  for (const shape of markShapes()) {
    const primitive = shape.closed ? "polygon" : "line";
    args.push("-draw", `stroke-linejoin miter ${primitive} ${shape.points.map(at).join(" ")}`);
  }
  return args;
}

/**
 * The tab icon: the small cut on a transparent ground, Ink on light tab strips and Off-white on dark ones.
 * An SVG used as an image runs no script, and its own `<style>` is outside the page's CSP.
 */
export function faviconSvg(): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">`,
    `<style>path{stroke:${themeColors.draft.text}}@media (prefers-color-scheme: dark){path{stroke:${themeColors.shop.text}}}</style>`,
    markPaths(SMALL_STROKE),
    "</svg>\n",
  ].join("");
}

/** Every PNG icon under `public/`. The maskable one keeps the mark inside the 80% safe zone. */
export const ICONS = [
  { file: "icons/icon-192.png", size: 192, markShare: 0.75, stroke: DISPLAY_STROKE },
  { file: "icons/icon-512.png", size: 512, markShare: 0.75, stroke: DISPLAY_STROKE },
  { file: "icons/maskable-512.png", size: 512, markShare: 0.6, stroke: DISPLAY_STROKE },
  { file: "icons/apple-touch-icon.png", size: 180, markShare: 0.75, stroke: DISPLAY_STROKE },
] as const;

async function render(): Promise<void> {
  const { join } = await import("node:path");
  const { mkdirSync, writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const publicDir = join(import.meta.dir, "..", "public");
  const scratch = mkdtempSync(join(tmpdir(), "studio-icons-"));
  const magick = (args: string[]) => {
    const r = Bun.spawnSync(["magick", ...args]);
    if (r.exitCode !== 0) throw new Error(`magick ${args.join(" ")} failed:\n${r.stderr.toString()}`);
  };
  try {
    mkdirSync(join(publicDir, "icons"), { recursive: true });
    for (const icon of ICONS) {
      magick([...iconDrawArgs(icon.size, icon), "-strip", `PNG32:${join(publicDir, icon.file)}`]);
    }
    const ico = [16, 32].map((size) => {
      const png = join(scratch, `ico-${size}.png`);
      magick([...iconDrawArgs(size, { markShare: 1, stroke: SMALL_STROKE }), "-strip", `PNG32:${png}`]);
      return png;
    });
    magick([...ico, join(publicDir, "favicon.ico")]);
    writeFileSync(join(publicDir, "favicon.svg"), faviconSvg());
    console.log(`Rendered ${ICONS.length} icons, favicon.ico and favicon.svg into ${publicDir}.`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) await render();
