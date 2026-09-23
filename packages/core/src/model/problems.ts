import type { CommandId, CommandRef } from "./commands";
import type { Hex4 } from "./hex";
import type { Json } from "./json";
import type { WpId } from "./wp";

/** Problem severity (spec L275, contracts §3.1). */
export type Severity = "blocker" | "warning" | "info";

/** Every check code in spec L309-L342 (UPG-01..05 are v2 and not here). */
export type ProblemCode =
  | "SEL-01" | "SEL-02" | "SEL-03" | "SEL-04" | "SEL-05" | "SEM-01"
  | "CORE-01" | "CORE-02" | "CORE-03" | "CORE-04" | "CORE-05" | "DEP-01" | "DEP-02" | "DEP-03"
  | "STO-01" | "STO-02" | "INIT-01" | "INIT-02" | "INIT-03" | "INIT-04" | "INIT-05"
  | "AUTH-01" | "AUTH-02" | "LINK-01"
  | "NET-01" | "NET-02" | "NET-03" | "NET-04" | "NET-05" | "NET-06" | "NET-07" | "NET-08";

/** Where a problem points (contracts §3.1). */
export type Anchor =
  | { kind: "diamond" }
  | { kind: "facet"; facet: string }
  | { kind: "selector"; selector: Hex4; facet?: string }
  /** "bundle.p.asset", "steps[2].admin". */
  | { kind: "init"; path: string }
  | { kind: "chain"; chainId: number };

/**
 * A problem the analysis raises (spec L273-L278).
 * Additions (contracts §3.1): `code`, `params` and `ack`.
 */
export type Problem = {
  /** Stable, e.g. "SEL-01:0xcdfe7f5c" (`problemId`). */
  id: string;
  code: ProblemCode;
  severity: Severity;
  /** Facet, selector or init field. */
  where: Anchor[];
  /** Everything the message and the fixes need. */
  params: Record<string, Json>;
  /** Rendered by narrate's `renderProblem(code, params)`. */
  message: string;
  fixes: CommandRef[];
  /** A warning the deploy review must tick. */
  ack?: true;
};

/** One registry row (contracts §3.3). */
export type ProblemInfo = {
  /** "variable" where the checks table sets severity per case (INIT-03, NET-06). */
  severity: Severity | "variable";
  /** "Warning (acknowledge)" in the checks table. */
  ack?: true;
  /** The work package whose check raises it. */
  owner: WpId;
  /** Command ids its fixes use, in the order the note offers them (contracts §3.3). */
  fixes: CommandId[];
};

/** The problem registry, from the checks table (spec L309-L342) and contracts §3.3. */
export const PROBLEMS: Readonly<Record<ProblemCode, ProblemInfo>> = {
  "SEL-01": { severity: "blocker", owner: "C2", fixes: ["selector.route", "collision.choosePerSelector"] },
  "SEL-02": { severity: "info", owner: "C2", fixes: ["inspector.focusSelectors"] },
  "SEL-03": { severity: "warning", owner: "C2", fixes: ["facet.remove", "inspector.focusSelectors"] },
  "SEL-04": { severity: "blocker", owner: "C2", fixes: ["selector.clearOwner"] },
  "SEL-05": { severity: "blocker", owner: "C2", fixes: ["selector.clearOwner"] },
  "SEM-01": { severity: "blocker", owner: "C2", fixes: ["selector.route", "facet.remove", "facet.place"] },
  "CORE-01": { severity: "blocker", owner: "C3", fixes: ["facet.place", "selector.include"] },
  "CORE-02": { severity: "warning", ack: true, owner: "C3", fixes: ["authority.chooseMechanism", "recipe.keepImmutable"] },
  "CORE-03": { severity: "blocker", owner: "C3", fixes: ["facet.remove"] },
  "CORE-04": { severity: "warning", owner: "C3", fixes: ["facet.place"] },
  "CORE-05": { severity: "warning", owner: "C3", fixes: ["facet.place"] },
  "DEP-01": { severity: "blocker", owner: "C3", fixes: ["facet.place", "dependency.compare"] },
  "DEP-02": { severity: "warning", owner: "C3", fixes: ["facet.place"] },
  "DEP-03": { severity: "blocker", owner: "C3", fixes: ["facet.remove"] },
  "STO-01": { severity: "blocker", owner: "C3", fixes: ["facet.remove"] },
  "STO-02": { severity: "info", owner: "C3", fixes: [] },
  "INIT-01": { severity: "blocker", owner: "C4a", fixes: ["init.focusField"] },
  "INIT-02": { severity: "blocker", owner: "C4a", fixes: ["init.reorderAuto", "init.open"] },
  "INIT-03": { severity: "variable", owner: "C4a", fixes: ["init.removeStep", "init.setArg"] },
  "INIT-04": { severity: "blocker", owner: "C4a", fixes: ["init.addStep"] },
  "INIT-05": { severity: "warning", ack: true, owner: "C4a", fixes: ["init.open", "ack.set"] },
  "AUTH-01": { severity: "warning", ack: true, owner: "C4c", fixes: ["authority.chooseMechanism", "ack.set"] },
  "AUTH-02": { severity: "blocker", owner: "C4c", fixes: ["init.setArg", "init.focusField"] },
  "LINK-01": { severity: "blocker", owner: "C4c", fixes: ["init.confirmAddress", "init.focusField"] },
  "NET-01": { severity: "blocker", owner: "C6", fixes: ["deploy.usePath", "chain.focusPicker"] },
  "NET-02": { severity: "blocker", owner: "C6", fixes: ["chain.focusPicker"] },
  "NET-03": { severity: "blocker", owner: "C6", fixes: ["deploy.missingContracts"] },
  "NET-04": { severity: "blocker", owner: "C6", fixes: ["chain.focusPicker"] },
  "NET-05": { severity: "blocker", owner: "C6", fixes: ["deploy.newSalt"] },
  "NET-06": { severity: "variable", owner: "C6", fixes: ["deploy.removeFacets"] },
  "NET-07": { severity: "info", owner: "C6", fixes: ["chain.useAnotherRpc"] },
  "NET-08": { severity: "warning", ack: true, owner: "C6", fixes: ["ack.set", "chain.focusPicker"] },
};

/** Every problem code, in the checks table's order. */
export const PROBLEM_CODES = Object.keys(PROBLEMS) as ProblemCode[];

/** Guard for codes read from outside (docs routes, stored acknowledgements). */
export function isProblemCode(value: unknown): value is ProblemCode {
  return typeof value === "string" && Object.hasOwn(PROBLEMS, value);
}

/**
 * The id part of an anchor: a facet name, a selector, an init path, a chain id, or "diamond".
 * A string is used as given.
 */
export function anchorKey(anchor: Anchor | string): string {
  if (typeof anchor === "string") return anchor;
  switch (anchor.kind) {
    case "diamond":
      return "diamond";
    case "facet":
      return anchor.facet;
    case "selector":
      return anchor.selector;
    case "init":
      return anchor.path;
    case "chain":
      return String(anchor.chainId);
  }
}

/**
 * Stable problem ids (spec L305): `SEL-01:0xcdfe7f5c`, `DEP-01:VaultCore`, `INIT-01:bundle.p.asset`,
 * `CORE-02:diamond`, `NET-03:11155111`. Several anchors join with "+" in the order given
 * (`CORE-03:AccessControlDiamondCut+GovernedDiamondCut`); callers pass them in catalog order.
 */
export function problemId(code: ProblemCode, anchor: Anchor | string | readonly (Anchor | string)[]): string {
  const list: readonly (Anchor | string)[] = isAnchorList(anchor) ? anchor : [anchor];
  return `${code}:${list.map(anchorKey).join("+")}`;
}

function isAnchorList(anchor: Anchor | string | readonly (Anchor | string)[]): anchor is readonly (Anchor | string)[] {
  return Array.isArray(anchor);
}
