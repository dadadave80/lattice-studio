/**
 * Everything the review's sections read, gathered once by `DeployReview` and handed down through context, so each
 * section is a plain function of it (and a test can render one section with a hand-built `Review`).
 */
import type { Analysis, Catalog, ChainState, Problem, Project } from "@lattice-studio/core";
import { createContext, useContext } from "react";
import type {
  ChainInfo, ChainReadiness, ChainService, DeployController, DeployState, WalletAccount, WalletConnector,
} from "@/contracts";
import type { Prediction } from "@/state";
import { env } from "@/contracts";
import { findChain } from "@/chain/infra/chains";
import type { SectionId } from "./copy";
import { fundsShort, sectionOf } from "./model";
import type { Cost } from "./use-cost";

export type Review = {
  project: Project;
  catalog: Catalog;
  analysis: Analysis;
  online: boolean;
  /** The selected chain, and its name ("Chain 11155111" while the chain module hasn't said). */
  chainId: number | null;
  chainName: string;
  chainInfo: ChainInfo | undefined;
  /** The chain module; null while it loads or when it failed (`serviceError`). */
  service: ChainService | null;
  serviceError: string | null;
  readiness: ChainReadiness;
  /** The selected chain's probes, once ready. */
  chain: ChainState | undefined;
  account: WalletAccount | null;
  connectors: readonly WalletConnector[];
  prediction: Prediction;
  /** The deploy controller's state, and the controller once loaded. */
  deploy: DeployState;
  controller: DeployController | null;
  /** Acknowledged problem ids for the current recipe hash. */
  acked: readonly string[];
  /** The deploy transaction, its gas against the cap and its fees. */
  cost: Cost;
};

export const ReviewContext = createContext<Review | null>(null);

export function useReview(): Review {
  const review = useContext(ReviewContext);
  if (!review) throw new Error("A review section rendered outside DeployReview.");
  return review;
}

/** The problems a section shows, in the analysis' order. */
export function problemsIn(review: Pick<Review, "analysis">, section: SectionId): Problem[] {
  return review.analysis.problems.filter((p) => sectionOf(p.code) === section);
}

/** The selected chain's native currency (ETH unless the chain table says otherwise). */
export function currencyOf(review: Pick<Review, "chainId">): { symbol: string; decimals: number } {
  const spec = review.chainId === null ? undefined : findChain(review.chainId, env.e2e);
  return spec ? { symbol: spec.nativeCurrency.symbol, decimals: spec.nativeCurrency.decimals } : { symbol: "ETH", decimals: 18 };
}

/** Flow 14's "Needs about 0.012 ETH; this account has 0.004." for the connected account, or null. */
export function shortOfFunds(review: Pick<Review, "chainId" | "account" | "cost">): string | null {
  const { account, cost } = review;
  if (!account || account.chainId !== review.chainId || account.kind === "safe") return null;
  return fundsShort(account.balance, cost.fees.status === "ready" ? cost.fees.quote : undefined, currencyOf(review));
}

/** A chain's display name from the review's chain module, else "Chain {id}". */
export function nameOf(review: Pick<Review, "service">, chainId: number): string {
  return review.service?.chains().find((chain) => chain.id === chainId)?.name ?? `Chain ${chainId}`;
}
