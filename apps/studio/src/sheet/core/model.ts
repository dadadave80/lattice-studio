/**
 * What the core cell prints, from core's `coreStatus` (the diamond's fixed part: the proxy's fallback, the loupe,
 * ERC-165 and the cut socket). Pure, so every row and every accessible name is covered by `model.test.ts`. The
 * names carry the state a screen reader would otherwise have to read off the pads: "Loupe socket: 4 of 4 covered".
 */
import type { CoreStatus } from "@lattice-studio/core";
import { CORE, CORE_TAGLINE, CUT, ERC165, FALLBACK, LOUPE } from "./copy";

/** The cut row: the placed cut facet and its mode, a conflict (two placed), or the empty socket. */
export type CutRow =
  | { state: "empty"; text: string; facet: null }
  | { state: "one"; text: string; facet: string }
  | { state: "conflict"; text: string; facet: string; rivals: string[] };

/** "14 routed" (the core's own five selectors included, so an empty sheet reads "5 routed"). */
export function fallbackText(status: CoreStatus): string {
  return `${status.fallback.routed} routed`;
}

/** "4/4". */
export function loupeText(status: CoreStatus): string {
  return `${status.loupe.covered.length}/${status.loupe.selectors.length}`;
}

/** The cut row's words: "AccessControlDiamondCut · upgradeable", "Empty · immutable", "Empty · no upgrade mechanism". */
export function cutRow(status: CoreStatus): CutRow {
  const { facet, rivals, conflict, immutable } = status.cut;
  if (facet === null) return { state: "empty", text: immutable ? "Empty · immutable" : "Empty · no upgrade mechanism", facet: null };
  if (conflict) return { state: "conflict", text: [facet, ...rivals].join(" · "), facet, rivals };
  return { state: "one", text: `${facet} · upgradeable`, facet };
}

/** The header button's name: "Core: the diamond's fixed part". */
export function diamondName(): string {
  return `${CORE}: ${CORE_TAGLINE.charAt(0).toLowerCase()}${CORE_TAGLINE.slice(1)}`;
}

/** "Fallback: 14 routed". */
export function fallbackName(status: CoreStatus): string {
  return `${FALLBACK}: ${fallbackText(status)}`;
}

/** "Loupe socket: 4 of 4 covered". */
export function loupeName(status: CoreStatus): string {
  return `${LOUPE} socket: ${status.loupe.covered.length} of ${status.loupe.selectors.length} covered`;
}

/** "ERC-165 socket: covered", "ERC-165 socket: not covered". */
export function erc165Name(status: CoreStatus): string {
  return `${ERC165} socket: ${status.erc165.covered ? "covered" : "not covered"}`;
}

/** "Cut socket: AccessControlDiamondCut · upgradeable", "Cut socket: empty · immutable", "Cut socket: A · B, both claim it". */
export function cutName(status: CoreStatus): string {
  const row = cutRow(status);
  if (row.state === "empty") return `${CUT} socket: ${row.text.charAt(0).toLowerCase()}${row.text.slice(1)}`;
  if (row.state === "conflict") return `${CUT} socket: ${row.text}, ${row.rivals.length === 1 ? "both" : "all"} claim it`;
  return `${CUT} socket: ${row.text}`;
}
