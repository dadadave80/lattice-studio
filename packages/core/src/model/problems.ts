import type { CommandId, CommandRef } from "./commands";
import type { Unit } from "./catalog";
import type { Address, Hex, Hex4 } from "./hex";
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
  /** Everything the message and the fixes need; per code, the keys of `ProblemParams[code]`. */
  params: Record<string, Json>;
  /**
   * Rendered by narrate's `renderProblem(code, params)`. Checks leave it "" and `runChecks` fills it for every
   * problem, in that one place.
   */
  message: string;
  fixes: CommandRef[];
  /** A warning the deploy review must tick. */
  ack?: true;
};

/** A selector as messages name it: signature and hex, never hex alone (spec L670). */
type SelectorParams = { selector: Hex4; signature: string };

/**
 * The params each check fills and each message template and fix reads (spec L311-L342, contracts §3.3).
 * The checks (C2, C3, C4a, C4c, C6) and `renderProblem` (C10) are built against these keys.
 * Values are raw: counts as numbers, gas and wei as decimal strings, addresses EIP-55; C10 formats them.
 * Chain-bearing codes carry `chain`, the display name (`ChainState.name`, "Sepolia").
 */
export type ProblemParams = {
  /** "`sendMessage(bytes,bytes,bytes[])` 0xcdfe7f5c is exported by A and B. Choose one owner." Contenders in catalog order. */
  "SEL-01": SelectorParams & { contenders: string[] };
  /** "ERC20 gives 4 selectors to GovernedVault and ERC4626." `to`: the owners, in catalog order. */
  "SEL-02": { facet: string; count: number; selectors: Hex4[]; to: string[] };
  /**
   * "ERC20Pausable cuts nothing: both its selectors are seams that GovernedVault serves. Remove it."
   * `why`: every selector is a seam served elsewhere, owned elsewhere, excluded, or a mix. `movable`: selectors
   * that could route here instead (non-empty offers Route a selector…).
   */
  "SEL-03": { facet: string; count: number; why: "seams" | "owned" | "excluded" | "mixed"; servedBy: string[]; movable: Hex4[] };
  /** "`exportSelectors()` is never cut into a diamond." `facet`: the owner the import named, if any. */
  "SEL-04": SelectorParams & { facet?: string };
  /**
   * "GovernedVault isn't on the sheet, so it can't own `transfer` 0xa9059cbb." Or: it doesn't export it.
   * `signature` is absent when no catalog facet exports the selector; the message then names the hex alone.
   */
  "SEL-05": { selector: Hex4; signature?: string; facet: string; reason: "not-placed" | "not-exported" };
  /**
   * "`transfer(address,uint256)` must be served by a version that updates vote checkpoints (GovernedVault or
   * ERC20Votes), not ERC20Pausable." `reason`: the seam's reason. `owner`: the stale explicit owner; absent
   * when the problem is that none of `allowed` is placed (`nonePlaced`).
   */
  "SEM-01": SelectorParams & { allowed: string[]; reason: string; owner?: string; nonePlaced: boolean };
  /**
   * "The loupe is incomplete: `facets()` is missing. Every Lattice diamond needs all four." Names the first
   * missing selector; `missing` lists all. `excluded`: DiamondLoupeFacet is placed but these are excluded.
   */
  "CORE-01": SelectorParams & { missing: Hex4[]; facet: string; excluded: boolean };
  /** "Nothing can change this diamond after deploy." */
  "CORE-02": Record<string, never>;
  /**
   * "One upgrade mechanism per diamond: AccessControlDiamondCut would let the admin skip GovernedSafeDiamondCut's
   * delay." `facets`: the two members, catalog order. `reason`: the consequence clause after the colon, which C3
   * fills ("AccessControlDiamondCut would let the admin skip GovernedSafeDiamondCut's delay").
   */
  "CORE-03": { facets: string[]; reason: string };
  /** "Plain ETH sent to this diamond will revert." `facet`: the one to place ("Receive"). */
  "CORE-04": { facet: string };
  /** "`supportsInterface()` won't exist; …" `facet`: the one to place ("ERC165Facet"). */
  "CORE-05": { facet: string };
  /** "VaultCore requires ERC4626: it runs the assets behind ERC4626's shares and initializes after it." */
  "DEP-01": { facet: string; anyOf: string[]; reason: string };
  /**
   * A convention: a companion ("GovernedDiamondCut usually ships with EmergencyStop, so a guardian can halt
   * upgrades.") or a namespace written with no manager ("Roles are written at init, but without AccessControl
   * nobody can manage them later."). `reason` is required for a companion; for a namespace, when it's absent,
   * C10 words it generically: "`<namespace>` is written at init, but without <anyOf> nobody can manage it later."
   */
  "DEP-02":
    | { kind: "companion"; facet: string; anyOf: string[]; reason: string }
    | { kind: "namespace"; namespace: string; anyOf: string[]; reason?: string; facet?: string };
  /** "AccountSigner and ERC6900Validation are different account models; one diamond holds one." */
  "DEP-03": { facets: string[]; family: "access" | "account" };
  /** "`lattice.storage.X` is claimed by A and B." */
  "STO-01": { id: string; slot: Hex; facets: string[] };
  /** "ERC20Votes shares `lattice.storage.ERC20` with ERC20." `owner` declares the namespace; `facet` touches it. */
  "STO-02": { facet: string; namespace: string; owner: string };
  /**
   * "Governor quorum is 140; it must be 0-100 (percent of supply)." / "No Safe at this address on Sepolia yet.
   * Deploy the Safe first." `detail`: validateArg's message; `chain` when a chain rule failed.
   */
  "INIT-01": { path: string; label: string; missing: boolean; detail: string; value?: Json; chain?: string };
  /** "VaultCore initializes before ERC4626; it must come after." `path`: the step's path ("steps[2]"). */
  "INIT-02": { path: string; spec: string; module: string; after: string };
  /**
   * "ERC20PermitInit and ERC6538RegistryInit both set the diamond's one EIP-712 domain, to different names, …"
   * `case`: conflict (blocker), roles to different addresses (warning), identical (info). `specs`/`paths`: the
   * two steps. Roles: `argPaths` and `admin` feed "Use one admin" (`init.setArg`).
   */
  "INIT-03": {
    module: string;
    case: "conflict" | "roles" | "same";
    specs: string[];
    paths: string[];
    detail?: string;
    argPaths?: string[];
    admin?: Json;
  };
  /**
   * "ERC20 has no init step, so `name()` and `symbol()` would be empty." `facet`: the placed facet needing it,
   * or absent for a `sameCall` module with no init (`sameCallWith`). `spec`: the init step to add.
   * Without `consequence`, C10 words it generically: "<facet> has no init step, so <module> is never initialized."
   */
  "INIT-04": { module: string; spec: string; facet?: string; consequence?: string; sameCallWith?: string };
  /**
   * "5 fields still use example values, including voting period (600 s) and quorum (4%)." Each example carries
   * its field's unit (C4a copies it from the field model) so C10 can write "600 s" and "4%".
   */
  "INIT-05": { count: number; paths: string[]; examples: { path: string; label: string; value: Json; unit?: Unit }[] };
  /**
   * "`diamondCut` and `DEFAULT_ADMIN_ROLE` rest with 0xAb12…34c7, a single key. If it's a Safe that isn't
   * deployed yet, deploy it first." `delegated`: an EIP-7702 account.
   */
  "AUTH-01": { holder: Address; roles: string[]; paths: string[]; delegated: boolean; chain: string };
  /**
   * "The admin is 0x4B20…9eF1, where this diamond would have been before the salt changed." `source`,
   * `chainId` and `chain` come from `AnalysisContext.knownFrom`; when it has no entry, C10 words it
   * generically: "The admin is 0x4B20…9eF1, an address this diamond had or a recorded deployment holds."
   */
  "AUTH-02": {
    path: string;
    role: string;
    address: Address;
    source?: "prediction" | "deployment";
    chainId?: number;
    chain?: string;
  };
  /**
   * "The upgrade role goes to 0x71C7…976F, which came from a shared link." `source` comes from
   * `AnalysisContext.unconfirmedFrom`; when absent, C10 words it generically: "…, which came from a link or a
   * file and hasn't been confirmed."
   */
  "LINK-01": { path: string; role: string; address: Address; source?: "link" | "file" };
  /** "The contract at CreateX's address on {chain} isn't CreateX: its codehash differs from 0xbd8a7ea8…b53f." */
  "NET-01": { chain: string; case: "missing" | "codehash"; expected: Hex; actual?: Hex };
  /** "Arachnid's deployment proxy isn't on {chain}, so missing contracts can't be deployed at their release addresses." */
  "NET-02": { chain: string; case: "missing" | "codehash"; expected: Hex; actual?: Hex };
  /**
   * "LatticeFactory and 3 of 15 facets and init contracts aren't on {chain} yet. …" `core`: LatticeRegistry
   * and LatticeFactory when missing; `missing`: absent facets and init contracts, of `total` the plan needs.
   */
  "NET-03": { chain: string; core: string[]; missing: string[]; total: number };
  /** "The code at 0x5FbD…0aa3 isn't Lattice ERC20 0.4.0." */
  "NET-04": { chain: string; name: string; version: string; address: Address; expected: Hex; actual: Hex };
  /** Worded per path: factory "This account already deployed a diamond with this salt; …", CreateX "This salt was already used on {chain}; …". */
  "NET-05": { chain: string; path: "factory" | "createx"; address: Address };
  /** "This deploy needs about 17.2M gas; {chain} allows 16.8M per transaction." Blocker over the cap, warning from 80%. */
  "NET-06": { chain: string; gas: string; cap: string; share: number };
  /** "Simulating with `eth_call`: fewer details in the preview." */
  "NET-07": { chain: string };
  /** "3 facets will be cut without the registry's on-chain check: Sepolia's LatticeRegistry doesn't list their pinned versions." */
  "NET-08": { chain: string; facets: string[]; count: number };
};

/** The params type of one code. */
export type ParamsOf<C extends ProblemCode> = ProblemParams[C];

/** Codes whose severity the check decides per case (INIT-03, NET-06). */
export type VariableSeverityCode = "INIT-03" | "NET-06";

/** `problem()` options: `severity` is required for INIT-03 and NET-06; `id` overrides `problemId(code, where)`. */
export type ProblemOptions<C extends ProblemCode> = C extends VariableSeverityCode
  ? { severity: Severity; id?: string }
  : { id?: string };

/**
 * Builds a problem with typed params: severity and `ack` from `PROBLEMS`, id from `problemId(code, where)`
 * unless given, and `message: ""` for `runChecks` to render.
 *
 * The id must name what makes the problem one problem (its identity anchor), and nothing more, so it stays
 * stable across edits. When `where` carries more than that (a SEL-01 anchors every contender), pass `id`:
 *
 * | Codes | Identity anchor | Example |
 * | --- | --- | --- |
 * | SEL-01, SEL-04, SEL-05, SEM-01, CORE-01 | the selector only | `SEL-01:0xcdfe7f5c` |
 * | SEL-02, SEL-03, STO-02 | the facet | `SEL-03:ERC20Pausable` |
 * | CORE-02, CORE-04, CORE-05 | the diamond | `CORE-02:diamond` |
 * | CORE-03, DEP-03 | both facets, catalog order | `CORE-03:AccessControlDiamondCut+GovernedDiamondCut` |
 * | DEP-01, DEP-02 | the facet and the requirement (its first `anyOf` option, or the namespace), since one facet can miss two | `DEP-01:VaultCore+ERC4626` |
 * | STO-01 | the namespace id | `STO-01:lattice.storage.ERC20` |
 * | INIT-01, AUTH-02, LINK-01 | the argument path | `INIT-01:bundle.p.asset` |
 * | INIT-02 | the step path | `INIT-02:steps[2]` |
 * | INIT-03 | the module | `INIT-03:EIP712` |
 * | INIT-04 | the module | `INIT-04:ERC20` |
 * | INIT-05 | the diamond | `INIT-05:diamond` |
 * | AUTH-01 | the holder, lowercase | `AUTH-01:0xab12…` |
 * | NET-01 to NET-08 | the chain id | `NET-03:11155111` |
 */
export function problem<C extends ProblemCode>(
  code: C,
  where: Anchor[],
  params: ProblemParams[C],
  fixes: CommandRef[],
  ...options: C extends VariableSeverityCode ? [ProblemOptions<C>] : [ProblemOptions<C>?]
): Problem {
  const info = PROBLEMS[code];
  const opts: { severity?: Severity; id?: string } = options[0] ?? {};
  const severity = info.severity === "variable" ? opts.severity : info.severity;
  if (severity === undefined) throw new TypeError(`${code} needs a severity: the check decides it per case.`);
  const out: Problem = {
    id: opts.id ?? problemId(code, where),
    code,
    severity,
    where,
    params: params as Record<string, Json>,
    message: "",
    fixes,
  };
  if (info.ack) out.ack = true;
  return out;
}

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
 * (`CORE-03:AccessControlDiamondCut+GovernedDiamondCut`, `DEP-01:VaultCore+ERC4626`); callers pass them in
 * catalog order. Pass each code's identity anchor, listed on `problem()`, not every anchor in `where`.
 */
export function problemId(code: ProblemCode, anchor: Anchor | string | readonly (Anchor | string)[]): string {
  const list: readonly (Anchor | string)[] = isAnchorList(anchor) ? anchor : [anchor];
  return `${code}:${list.map(anchorKey).join("+")}`;
}

function isAnchorList(anchor: Anchor | string | readonly (Anchor | string)[]): anchor is readonly (Anchor | string)[] {
  return Array.isArray(anchor);
}
