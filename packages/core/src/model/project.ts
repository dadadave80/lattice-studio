import type { Address, Hex } from "./hex";
import type { Recipe } from "./recipe";
import type { LoupeFacet } from "./chain";

/** Pinned facts that an upgrade must recheck before sending. */
export type UpgradeBaseline = {
  block: number;
  blockHash: Hex;
  facets: LoupeFacet[];
  codehashes: Record<string, Hex>;
};

export type UpgradeOrigin = UpgradeBaseline & { chainId: number; address: Address; owner: Address | null };

/** A proposal or transaction preserves the previous confirmed deployment until verification succeeds. */
export type PendingUpgrade = {
  phase: "signing" | "proposed" | "pending" | "verifying";
  /** Identifies the reservation that owns cleanup and receipt updates across tabs. */
  reviewId?: string;
  desiredRecipeHash: Hex;
  catalogHash: Hex;
  baseline: UpgradeBaseline;
  expectedFacets: LoupeFacet[];
  expectedCodehashes: Record<string, Hex>;
  from: Address;
  /** Exact submitted intent for observation after a reload; wei never travels as a JSON number. */
  call?: { data: Hex; value: string };
  since: string;
  tx?: Hex;
  safeTxHash?: Hex;
  callsId?: string;
};

/** What autosave and `.lattice.json` files hold (spec L233-L243). */
export type Project = {
  id: string;
  name: string;
  recipe: Recipe;
  layout: Record<string, { x: number; y: number; pins: "left" | "right"; expanded?: true }>;
  deploy: {
    /** LatticeFactory by default; CreateX CREATE3 when chosen. */
    path: "factory" | "createx";
    /** 11 random bytes; the salt is from ‖ flag ‖ entropy. */
    entropy: Hex;
    /** Flag 0x00 or 0x01; read only on the CreateX path. */
    scope: "every-chain" | "this-chain";
  };
  /** Per init-argument path, for LINK-01. */
  provenance: Record<string, "link" | "file" | "confirmed">;
  /** This diamond's earlier predicted addresses, for AUTH-02. */
  predicted: { chainId: number; address: Address }[];
  /** Per init-argument path, the ENS name its address was resolved from (spec L462; contract addition, FX42). */
  labels?: Record<string, string>;
  upgrade?: UpgradeOrigin;
};

/** Own store, keyed by [chainId, address], indexed by project id (spec L244-L253). */
type DeploymentRecord = {
  projectId: string;
  chainId: number;
  address: Address;
  status: "pending" | "proposed" | "confirmed" | "mismatch" | "failed";
  tx?: Hex;
  safeTxHash?: Hex;
  callsId?: string;
  block?: number;
  recipeHash: Hex;
  catalogHash: Hex;
  at: string;
  verification: "pending" | "match" | "exact_match" | "failed";
  /** Why Sourcify couldn't verify, while `verification` is "failed" (spec L606; contract addition from FX21). */
  verificationReason?: string;
  /** 1 at deploy, +1 per upgrade (v2). */
  revision: number;
  /** Imported: shown "From file" until re-read on-chain. */
  fromFile?: true;
  pendingUpgrade?: PendingUpgrade;
};

/** An existing v1 record keeps its original shape and creation provenance. */
export type CreatedDeployment = DeploymentRecord & {
  kind?: "deployed";
  path: "factory" | "createx";
  deployer: Address;
  salt: Hex;
};

/** Inspection cannot establish how a diamond was originally deployed. */
export type ImportedDeployment = DeploymentRecord & { kind: "imported" };
export type Deployment = CreatedDeployment | ImportedDeployment;

/** A `.lattice.json` file (spec L254). */
export type ProjectFile = { project: Project; deployments: Deployment[] };

/** What every edit op returns (contracts §3.1); the document store applies it as one undo step. */
export type EditResult = {
  project: Project;
  /** False when the op was a no-op; `summary` then says why ("ERC20 is already on the sheet."). */
  changed: boolean;
  /** In the spec's voice: "Placed ERC20". */
  summary: string;
};

/** The diamond's state for the selected chain (spec L686; "From file" spec L501). */
export type DiamondState =
  | "not-deployed" | "pending" | "proposed" | "live" | "modified" | "mismatch" | "failed" | "from-file";

/** C5a `projectStatus`: the stamp, the status chip and whether Deploy again applies (spec L582-L584, L686). */
export type ProjectStatus = {
  state: DiamondState;
  /** One of spec L686's strings: "Not deployed", "Proposed · Sepolia (Safe)", "Live · Sepolia · r1", "Modified since r1", "Mismatch · Sepolia". */
  stamp: string;
  /** The chain the stamp describes; null when none is selected. */
  chainId: number | null;
  /** The record the stamp describes, when there is one. */
  deployment?: Deployment;
  /** Every chain where a confirmed deployment has the current recipe hash. */
  live: { chainId: number; address: Address; revision: number }[];
  /** "Modified since r1": the revision the sheet differs from. */
  modifiedSince?: number;
  /** A confirmed deploy exists and the sheet differs from it: the button reads Deploy again… */
  deployAgain: boolean;
};
