/**
 * What each upgrade mechanism and each self-wiring bundle means for authority (spec L57, L469, L644-L649).
 * The catalog says which facet is in the upgrade family and which params receive authority; the rest (who
 * cuts, and the roles a bundle gives the diamond itself) is Lattice's Solidity, cited per entry.
 */
import type { Catalog, Facet, InitParam, InitSpec } from "../model/catalog";
import type { Mechanism } from "../model/init";
import type { Arg, Recipe } from "../model/recipe";

/** `DEFAULT_ADMIN_ROLE`, as the overlay names it on an authority param. */
export const ADMIN_ROLE = "DEFAULT_ADMIN_ROLE";

/** Ownable's owner, as the overlay names it (OwnableInit `_owner`). */
export const OWNER_ROLE = "owner";

/** One Flow 17 option (spec L644-L649). `summary` is the spec's clause, quoted. */
export type MechanismDef = {
  id: Mechanism;
  label: string;
  /** The family member it places; none for Immutable. */
  facet?: string;
  summary: string;
  /** The function that cuts, for AUTH-01's "`diamondCut` … rest with". */
  cutFn?: "diamondCut" | "scheduleCut";
  /** How the Upgrade row's holder gets it. */
  via?: string;
};

/** The five choices, in the dialog's order (spec L644-L649). */
export const MECHANISMS: readonly MechanismDef[] = [
  {
    id: "admin",
    label: "Admin role",
    facet: "AccessControlDiamondCut",
    summary: "holders of `DEFAULT_ADMIN_ROLE` cut at once",
    cutFn: "diamondCut",
    via: "AccessControlDiamondCut (DEFAULT_ADMIN_ROLE)",
  },
  {
    id: "safe",
    label: "Safe",
    facet: "SafeDiamondCut",
    summary: "only the pinned Safe cuts, at its threshold",
    cutFn: "diamondCut",
    via: "SafeDiamondCut (pinned Safe)",
  },
  {
    id: "safe-delay",
    label: "Safe with delay",
    facet: "GovernedSafeDiamondCut",
    summary: "the Safe schedules a cut, which waits out `minDelay`",
    // GovernedSafeDiamondCut has no `diamondCut`: it upgrades through scheduleCut and executeCut (spec L56).
    cutFn: "scheduleCut",
    via: "GovernedSafeDiamondCut (pinned Safe, after minDelay)",
  },
  {
    id: "governance",
    label: "Governance",
    facet: "GovernedDiamondCut",
    summary: "only a passed proposal, executed through the diamond's own timelock, cuts",
    cutFn: "diamondCut",
    // GovernedDiamondCutLib.sol:119 grants UPGRADE_EXECUTOR_ROLE to address(this) only.
    via: "GovernedDiamondCut (governance through the timelock)",
  },
  { id: "immutable", label: "Immutable", summary: "no mechanism, which is the same as Keep immutable" },
];

/** Spec L648, quoted. */
export const GOVERNANCE_DISABLED =
  "Governance needs GovernedVault's Governor, Votes and TimelockController; Lattice has no standalone Governor init.";

/**
 * diamond-lib's DiamondCutFacet is in the upgrade family but isn't one of Flow 17's five: its owner cuts
 * (OwnableInit `_owner`).
 */
export const OWNER_CUT = { facet: "DiamondCutFacet", cutFn: "diamondCut", via: "DiamondCutFacet (owner)" } as const;

/** A role a bundle gives without an argument: the diamond itself, or everyone (address(0)). */
export type SelfHeld = { role: string; holder: "self" | "anyone"; via: string };

/**
 * Bundles that wire authority to the diamond itself. GovernedVaultInit.sol:45-48 gives `DEFAULT_ADMIN_ROLE`
 * to the diamond; :73-77 makes the diamond the timelock's only proposer and its admin, and opens execution
 * (`executors[0] = address(0)`). GovernedVaultENSInit.sol:52, 74-77 does the same.
 */
export const SELF_HELD: Readonly<Record<string, readonly SelfHeld[]>> = {
  GovernedVaultInit: selfHeld("GovernedVaultInit"),
  GovernedVaultENSInit: selfHeld("GovernedVaultENSInit"),
};

function selfHeld(contract: string): SelfHeld[] {
  return [
    { role: ADMIN_ROLE, holder: "self", via: `${contract} (the diamond itself)` },
    { role: "Proposer", holder: "self", via: `${contract} (the diamond's Governor)` },
    { role: "Executor", holder: "anyone", via: `${contract} (open execution)` },
  ];
}

/** Guardians of EmergencyStop: none at init; the admin appoints them later (EmergencyStopLib.sol:101-110). */
export const GUARDIAN = { facet: "EmergencyStop", role: "Guardian", via: "EmergencyStop (no guardian at init)" } as const;

export function mechanismById(id: Mechanism): MechanismDef {
  const def = MECHANISMS.find((m) => m.id === id);
  if (!def) throw new TypeError(`Unknown mechanism ${id}`);
  return def;
}

export function mechanismByFacet(facet: string): MechanismDef | undefined {
  return MECHANISMS.find((m) => m.facet === facet);
}

export function facetNamed(catalog: Catalog, name: string): Facet | undefined {
  return catalog.facets.find((f) => f.name === name);
}

export function specNamed(catalog: Catalog, name: string): InitSpec | undefined {
  return catalog.inits.find((s) => s.name === name);
}

/** Placed facets of the upgrade family, in catalog order. */
export function upgradeMembers(recipe: Recipe, catalog: Catalog): Facet[] {
  const placed = new Set(recipe.facets);
  return catalog.facets.filter((f) => f.family === "upgrade" && placed.has(f.name));
}

/** The bundle that sets up its own upgrade mechanism (GovernedVaultInit), if the init is one. */
export function decidingBundle(recipe: Recipe, catalog: Catalog): InitSpec | undefined {
  if (recipe.init.kind !== "bundle") return undefined;
  const spec = specNamed(catalog, recipe.init.spec);
  if (!spec) return undefined;
  const family = new Set(catalog.facets.filter((f) => f.family === "upgrade").map((f) => f.name));
  return spec.initializes.some((i) => family.has(i.module)) ? spec : undefined;
}

/** One authority argument of the recipe's init. */
export type AuthorityArg = {
  /** "steps[0].admin", "bundle.p.admin". */
  path: string;
  spec: InitSpec;
  param: InitParam;
  /** Absent when the recipe doesn't set it (INIT-01 reports that). */
  value?: Arg;
  /** Step index, or -1 for a bundle. */
  step: number;
};

/** Every param flagged `authority`, tuple components included, in call order. */
export function authorityArgs(recipe: Recipe, catalog: Catalog): AuthorityArg[] {
  const out: AuthorityArg[] = [];
  const calls =
    recipe.init.kind === "bundle"
      ? [{ prefix: "bundle", spec: recipe.init.spec, args: recipe.init.args, step: -1 }]
      : recipe.init.kind === "steps"
        ? recipe.init.steps.map((s, i) => ({ prefix: `steps[${i}]`, spec: s.spec, args: s.args, step: i }))
        : [];
  for (const call of calls) {
    const spec = specNamed(catalog, call.spec);
    if (!spec) continue;
    walk(spec, spec.params, call.args, call.prefix, call.step, out);
  }
  return out;
}

function walk(
  spec: InitSpec,
  params: readonly InitParam[],
  args: Readonly<Record<string, Arg>> | undefined,
  prefix: string,
  step: number,
  out: AuthorityArg[],
): void {
  for (const param of params) {
    const path = `${prefix}.${param.name}`;
    const value = args && Object.hasOwn(args, param.name) ? args[param.name] : undefined;
    if (param.components && param.components.length > 0) {
      walk(spec, param.components, isRecord(value) ? value : undefined, path, step, out);
      continue;
    }
    if (!param.authority) continue;
    const entry: AuthorityArg = { path, spec, param, step };
    if (value !== undefined) entry.value = value;
    out.push(entry);
  }
}

function isRecord(value: Arg | undefined): value is Record<string, Arg> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !("$ref" in value);
}

/** `{ $ref }` when the arg is a reference. */
export function refOf(value: Arg | null | undefined): "self" | "deployer" | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const ref = (value as { $ref?: unknown }).$ref;
  return ref === "self" || ref === "deployer" ? ref : undefined;
}

/** A literal address in any case (the model's `isAddress` is strict EIP-55; stored JSON may be lowercase). */
export function isAddressLike(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** "SafeDiamondCutInit(admin, safe, minThreshold)". */
export function signature(spec: InitSpec): string {
  return `${spec.contract}(${spec.params.map((p) => p.name).join(", ")})`;
}
