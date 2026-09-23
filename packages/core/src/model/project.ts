import type { Address, Hex } from "./hex";
import type { Recipe } from "./recipe";

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
};

/** Own store, keyed by [chainId, address], indexed by project id (spec L244-L253). */
export type Deployment = {
  projectId: string;
  chainId: number;
  address: Address;
  path: "factory" | "createx";
  deployer: Address;
  salt: Hex;
  status: "pending" | "proposed" | "confirmed" | "mismatch" | "failed";
  tx?: Hex;
  safeTxHash?: Hex;
  callsId?: string;
  block?: number;
  recipeHash: Hex;
  catalogHash: Hex;
  at: string;
  verification: "pending" | "match" | "exact_match" | "failed";
  /** 1 at deploy, +1 per upgrade (v2). */
  revision: number;
  /** Imported: shown "From file" until re-read on-chain. */
  fromFile?: true;
};

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
