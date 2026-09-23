/**
 * What every edit op shares: the two result shapes and the copy they reuse. A success summary is a label with
 * no trailing period ("Placed ERC20"), because undo prints it as "Undid: Placed ERC20." (C10 `lines.undid`).
 * A no-op summary is a full sentence that says why nothing changed ("ERC20 is already on the sheet.").
 */
import { joinAnd } from "../format/text";
import type { EditResult, Project } from "../model/project";

/** Nothing changed: the same project object back, and why. */
export function noOp(project: Project, summary: string): EditResult {
  return { project, changed: false, summary };
}

/** A change, with its undo label. */
export function done(project: Project, summary: string): EditResult {
  return { project, changed: true, summary };
}

/** "ERC20 isn't on the sheet." / "ERC20 and ERC4626 aren't on the sheet." (IR L143). */
export function notOnSheet(names: readonly string[]): string {
  return `${joinAnd(names)} ${names.length === 1 ? "isn't" : "aren't"} on the sheet.`;
}

/** Unique names in first-seen order. */
export function unique(names: readonly string[]): string[] {
  return [...new Set(names)];
}

/** Both coordinates are finite numbers. */
export function isFinitePoint(point: { x: number; y: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
