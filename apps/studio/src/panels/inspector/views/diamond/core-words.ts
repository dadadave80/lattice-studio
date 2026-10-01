/**
 * The Core section's rows (the Diamond view's first section): the fallback's counts, the loupe's four
 * selectors, the ERC-165 interfaces the init registers and the cut facet with its upgrade mechanism. Pure, so
 * every state is unit-tested without a browser.
 */
import type { Catalog, CoreStatus, Hex4, MechanismOptions } from "@lattice-studio/core";
import { plural } from "@lattice-studio/core";
import { signatureOf } from "../facet/facet-model";
import { joinNames } from "../facet/pin-action";

/** "5 routed · 5 exported · 0 excluded". */
export function fallbackText(fallback: CoreStatus["fallback"]): string {
  return `${fallback.routed} routed · ${fallback.exported} exported · ${fallback.excluded} excluded`;
}

/** "4/4". */
export function loupeText(loupe: CoreStatus["loupe"]): string {
  return `${loupe.covered.length}/${loupe.selectors.length}`;
}

export type LoupeRow = { hex: Hex4; signature: string; covered: boolean };

/** The four loupe selectors, each with its signature (from the catalog) and whether it routes. */
export function loupeRows(loupe: CoreStatus["loupe"], catalog: Catalog): LoupeRow[] {
  return loupe.selectors.map((hex) => ({ hex, signature: signatureOf(catalog, hex) ?? hex, covered: loupe.covered.includes(hex) }));
}

/** "2 interfaces", "None registered"; "· supportsInterface not routed" while ERC165Facet's selector doesn't route. */
export function erc165Text(erc165: CoreStatus["erc165"]): string {
  const registered = erc165.interfaceIds.length === 0 ? "None registered" : plural(erc165.interfaceIds.length, "interface");
  return erc165.covered ? registered : `${registered} · supportsInterface not routed`;
}

/** The current mechanism's label ("Admin role", "Safe with delay"), when the recipe has one. */
export function mechanismLabel(options: Pick<MechanismOptions, "current" | "options">): string | undefined {
  return options.options.find((option) => option.id === options.current)?.label;
}

/**
 * "AccessControlDiamondCut · Admin role", "Empty · immutable", "Empty · no upgrade mechanism"; a conflict names
 * the rivals: "AccessControlDiamondCut · Admin role · conflicts with SafeDiamondCut".
 */
export function cutText(cut: CoreStatus["cut"], options: Pick<MechanismOptions, "current" | "options">): string {
  if (cut.facet === null) return `Empty · ${cut.immutable ? "immutable" : "no upgrade mechanism"}`;
  const mode = mechanismLabel(options) ?? "upgradeable";
  const conflict = cut.conflict ? ` · conflicts with ${joinNames(cut.rivals)}` : "";
  return `${cut.facet} · ${mode}${conflict}`;
}
