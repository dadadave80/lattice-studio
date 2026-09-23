import type { ChainState } from "./chain";
import type { Address, Hex } from "./hex";
import type { Json } from "./json";
import type { Arg, Recipe } from "./recipe";

/**
 * C4a `planInit`: the init as the inspector shows it (spec L457-L469).
 * bundle: one locked step, with the overlay's `sequence` read-only. steps: the recipe's order, plus the
 * automatic ERC-165 step unless a step's spec registers the interfaces itself. none: no steps.
 */
export type InitPlan = {
  kind: "bundle" | "steps" | "none";
  steps: InitStepView[];
  /** Bundles: internal order from the overlay, shown read-only. */
  sequence?: string[];
};

/** One init call in the plan. */
export type InitStepView = {
  /** "bundle", "steps[2]", or "auto" for the automatic ERC-165 step. */
  path: string;
  /** Position in call order, from 0. */
  index: number;
  /** InitSpec name; the automatic step names Lattice's DiamondIntrospectionInit. */
  spec: string;
  contract: string;
  /** "init(string,string)", "initUpgradeable()". */
  fn: string;
  /** The appended step: "Register ERC-165 interfaces (automatic)" (spec L468). */
  automatic?: "initUpgradeable" | "initImmutable";
  /** Bundles and the automatic step can't move or be removed. */
  locked: boolean;
  args: Record<string, Arg>;
  /** One per parameter; tuple components nest under `components`. */
  fields: FieldModel[];
  /** Paths of required arguments that are missing or break their rule (INIT-01). */
  missing: string[];
  /** Paths of arguments that still hold the template's example (INIT-05). */
  examples: string[];
};

/** What kind of control an init field gets (C4a, S5d, spec L461-L465). */
export type FieldKind =
  | "address" | "duration" | "percent" | "amount" | "integer" | "string" | "bool" | "enum" | "bytes" | "array" | "tuple";

/** C4a `fieldModel`: one init parameter, from its `type`, `unit` and `rule`. */
export type FieldModel = {
  /** Full argument path: "bundle.p.asset", "steps[2].admin". */
  path: string;
  /** Parameter or component name. */
  name: string;
  /** Visible label: "Voting period". */
  label: string;
  /** Solidity type: "uint48", "(address,string)". */
  type: string;
  kind: FieldKind;
  /** Help text from NatSpec or the overlay. */
  doc: string;
  unit?: "seconds" | "percent" | "wei";
  /** The raw rule, as the overlay writes it. */
  rule?: string;
  /** Inclusive lower bound, decimal string. */
  min?: string;
  /** Upper bound, decimal string (inclusive). */
  max?: string;
  /** `gt(n)`: `min` is exclusive. */
  exclusiveMin?: true;
  maxLength?: number;
  /** Enum values. */
  options?: string[];
  required: boolean;
  allowZero: boolean;
  /** `code(safe|token|contract)`: the address must hold code of that kind on the selected chain. */
  needsCode?: "safe" | "token" | "contract";
  /** Receives a role, ownership or upgrade rights. */
  authority: boolean;
  role?: string;
  example?: Json;
  /** Tuples: one field per component, with dotted paths. */
  components?: FieldModel[];
  /** Arrays: the element's model. */
  element?: FieldModel;
};

/** C4a `validateArg` context: chain rules apply only when `chain.codeAt` has the address. */
export type ArgContext = {
  chain?: ChainState;
  /** For messages: "No Safe at this address on Sepolia yet. Deploy the Safe first." */
  chainName?: string;
  refs?: { self?: Address; deployer?: Address };
};

/** C4b `encodeInit`'s result: the diamond's init target and calldata (none: zero target and "0x"). */
export type InitCall = { target: Address; data: Hex };

/** C4b `decodeInit`'s result. */
export type DecodedInit = {
  kind: "bundle" | "steps" | "none";
  steps: DecodedInitStep[];
};

/** One decoded init call; MultiInit bubbles reverts raw, so the target is kept for C6 to attribute them. */
export type DecodedInitStep = {
  target?: Address;
  /** InitSpec name when the catalog knows the selector. */
  spec?: string;
  fn: string;
  args: Record<string, Arg>;
  /** Argument paths whose value equals a resolved reference. */
  fromRef: Record<string, "self" | "deployer">;
};

/**
 * C4c `authorityTable`: who holds each role after init (spec L469, L568).
 * `holder` is null when nobody does ("Guardian → none").
 */
export type AuthorityRow = {
  /** "DEFAULT_ADMIN_ROLE", "Upgrade", "Guardian", "Proposer", "Executor". */
  role: string;
  holder: Arg | null;
  /** The holder once references resolve for a deploy context. */
  resolved?: Address;
  /** How the holder gets it: "AccessControlInit(admin)", "SafeDiamondCut (pinned Safe)". */
  via: string;
  /** The init-argument path it comes from; AUTH-02 and LINK-01 anchor here. */
  path?: string;
  /** The row that says who can upgrade; Flow 17 opens from it. */
  upgrade?: true;
};

/** The five choices of Flow 17 (spec L644-L649). `authority.chooseMechanism {preset}` uses these ids. */
export type Mechanism = "admin" | "safe" | "safe-delay" | "governance" | "immutable";

/** One option in Choose an upgrade mechanism. */
export type MechanismOption = {
  id: Mechanism;
  /** "Admin role", "Safe", "Safe with delay", "Governance", "Immutable". */
  label: string;
  /** The family member it places; none for Immutable. */
  facet?: string;
  /** Who can upgrade and how fast: "holders of DEFAULT_ADMIN_ROLE cut at once". */
  summary: string;
  enabled: boolean;
  /** Why it's disabled: "Governance needs GovernedVault's Governor, Votes and TimelockController; …". */
  reason?: string;
};

/** C4c `mechanismOptions`. */
export type MechanismOptions = {
  /** The mechanism the recipe has now; null with no member placed and `immutable` unset. */
  current: Mechanism | null;
  /** Set when the init is a bundle that sets up its own mechanism: the bundle decides (spec L651). */
  bundle?: string;
  options: MechanismOption[];
};

/** What Flow 17's Fill in step collects (spec L650). Addresses take references or pasted addresses. */
export type MechanismInputs = {
  safe?: Arg;
  /** Decimal string. */
  minThreshold?: string;
  /** Seconds, decimal string. */
  delay?: string;
  admin?: Arg;
  /** Admin role's "Use a Safe…": keep the mechanism and hand DEFAULT_ADMIN_ROLE to the Safe. */
  keepMechanism?: true;
};

/** One line of Flow 17's preview: "Remove AccessControlDiamondCut", "Place SafeDiamondCut", "Upgrade → Safe 0x71C7…976F, 2 of 3". */
export type ChangeLine = {
  kind: "remove" | "place" | "init" | "authority" | "immutable";
  text: string;
  facet?: string;
};

/** C4c `planMechanismChange`'s result: the preview and the recipe to apply as one undo step. */
export type MechanismChange = { changes: ChangeLine[]; next: Recipe };
