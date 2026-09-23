import { useId } from "react";
import { log } from "@/contracts";
import { Button } from "@/ui";
import { cantSimulate, pendingAcks, signEnablement, type Enablement } from "./model";
import { shortOfFunds, useReview, type Review } from "./review-data";
import { useReviewState } from "./review-state";
import { CANCELED_IN_WALLET } from "./copy";
import { fixtureBlock } from "./entry-copy";
import styles from "./review.module.css";

/** Sign & deploy's enablement for this review (spec L573, IR L238). */
export function useSignEnablement(review: Review): Enablement {
  const noSimulationTick = useReviewState((s) => s.noSimulationTick);
  const typedName = useReviewState((s) => s.typedName);
  const { analysis, account, chainId, deploy } = review;
  return signEnablement({
    online: review.online,
    readOnly: review.readOnly,
    catalogBlock: fixtureBlock(review.catalog.lattice.tag),
    blockers: analysis.problems.filter((p) => p.severity === "blocker").length,
    chainId,
    chainName: review.chainName,
    readiness: review.readiness,
    account: account ? { address: account.address, chainId: account.chainId, ...(account.kind ? { kind: account.kind } : {}) } : null,
    walletChainName: account ? (review.service?.chains().find((c) => c.id === account.chainId)?.name ?? `Chain ${account.chainId}`) : "",
    deploy,
    fundsShort: shortOfFunds(review),
    recipeHash: analysis.recipeHash,
    pendingAcks: pendingAcks(analysis.problems, review.acked).length,
    noSimulationTicked: noSimulationTick === analysis.recipeHash,
    mainnet: review.chainInfo?.testnet === false,
    typedName,
    projectName: review.project.name,
  });
}

/**
 * The review's footer: Cancel and Sign & deploy (Sign again after a rejection in the wallet, spec L574), with the
 * reason it can't sign yet written beside it; Close once the deploy is on its way.
 */
export function ReviewFooter({ progress, onClose }: { progress: boolean; onClose: () => void }) {
  const review = useReview();
  const enablement = useSignEnablement(review);
  const noSimulationTick = useReviewState((s) => s.noSimulationTick);
  const reasonId = useId();
  if (progress) {
    return (
      <div className={styles.footer}>
        <Button onClick={onClose}>Close</Button>
      </div>
    );
  }
  const again = review.deploy.error === CANCELED_IN_WALLET;
  // The extra tick (spec L573, L575) is the consent to sign without a simulation; the controller needs it said.
  const withoutSimulation = cantSimulate(review.deploy.simulation) && noSimulationTick === review.analysis.recipeHash;
  const sign = () => {
    const controller = review.controller;
    if (!controller) return;
    controller.sign(withoutSimulation ? { withoutSimulation: true } : undefined).catch((error: unknown) => {
      log({ tag: "Error", text: error instanceof Error ? error.message : String(error) });
    });
  };
  return (
    <div className={styles.footer}>
      {enablement.ok ? null : (
        <p id={reasonId} className={styles.footerReason} data-sign-reason="">
          {enablement.reason}
        </p>
      )}
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" icon="deploy" data-tour="deploy" disabledReason={enablement.ok ? null : enablement.reason} onClick={sign}>
        {again ? "Sign again" : "Sign & deploy"}
      </Button>
    </div>
  );
}
