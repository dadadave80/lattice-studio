/**
 * Projects for the card's browser tests (never imported by the app): facets placed in a grid, with the layout
 * flags a test sets.
 */
import type { Catalog, Hex4, Project } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";

export type CardProjectOptions = {
  exclude?: Hex4[];
  owners?: Record<Hex4, string>;
  pinsRight?: string[];
  expanded?: string[];
  /** Cards per row. */
  columns?: number;
  /** Row pitch in sheet units. */
  rowPitch?: number;
};

/** The gallery: every pin state and every border (see card-model.test.ts). */
export const GALLERY_FACETS = [
  "ERC20", "ERC20Votes", "GovernedVault", "ERC20Pausable", "AxelarGatewayAdapter", "HyperlaneGatewayAdapter",
  "VaultCore", "Receive",
];

export function cardProject(catalog: Catalog, facets: string[], options: CardProjectOptions = {}): Project {
  const { columns = 4, rowPitch = 392 } = options;
  const layout: Project["layout"] = {};
  facets.forEach((name, i) => {
    layout[name] = {
      x: 24 + (i % columns) * 272,
      y: 24 + Math.floor(i / columns) * rowPitch,
      pins: options.pinsRight?.includes(name) ? "right" : "left",
      ...(options.expanded?.includes(name) ? { expanded: true as const } : {}),
    };
  });
  return makeProject({
    recipe: makeRecipe({ facets, exclude: options.exclude ?? [], owners: options.owners ?? {} }, catalog),
    layout,
  });
}
