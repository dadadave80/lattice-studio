import { useEffect, useRef } from "react";
import { commandRef, runCommand } from "@/contracts";
import { Select } from "@/ui";
import { CHAIN_CHECKS_NEED_CONNECTION, CHOOSE_A_CHAIN, checking, type SectionStatus } from "./copy";
import { FixButton } from "./FixButton";
import { WalletLoading } from "./WalletLoading";
import { neededContracts, problemStatus, readinessLine, worse } from "./model";
import { ProblemList } from "./ProblemList";
import { problemsIn, useReview } from "./review-data";
import { clearPickerFocus, useReviewState } from "./review-state";
import styles from "./review.module.css";
import { Section } from "./Section";

/**
 * Network (spec L563): the chain picker and the readiness line, "Sepolia · LatticeFactory ✓ · 15 of 15 facets and
 * init contracts ✓"; Retry reading and Use another RPC… when the chain couldn't be read; Deploy missing contracts…
 * when NET-03 fires. Choose another chain (chain.focusPicker) lands on the picker.
 */
export function NetworkSection() {
  const review = useReview();
  const { chainId, chainName, readiness, service, project, catalog, analysis, online, acked } = review;
  const problems = problemsIn(review, "network");
  const chains = service?.chains() ?? [];
  const options = chains.map((chain) => ({ value: String(chain.id), label: chain.name }));

  const picker = useRef<HTMLDivElement>(null);
  const focusRequested = useReviewState((s) => s.focusPicker);
  useEffect(() => {
    if (!focusRequested) return;
    // After the dialog's own initial focus (its heading) has landed.
    const frame = requestAnimationFrame(() => {
      picker.current?.querySelector<HTMLElement>("button, [role='combobox']")?.focus();
      clearPickerFocus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequested]);

  let status: SectionStatus = problemStatus(problems, acked);
  let line: string;
  if (!online) {
    line = CHAIN_CHECKS_NEED_CONNECTION;
    status = worse(status, "waiting");
  } else if (chainId === null) {
    line = CHOOSE_A_CHAIN;
    status = worse(status, "waiting");
  } else if (readiness.status === "ready") {
    line = readinessLine({
      chainName, path: project.deploy.path, chain: readiness.state, catalog,
      needed: neededContracts(analysis, project.recipe, catalog),
    });
  } else if (readiness.status === "error") {
    line = readiness.reason;
    status = "blocked";
  } else {
    line = checking(chainName);
    status = worse(status, "waiting");
  }

  return (
    <Section id="network" status={status}>
      <div ref={picker} data-chain-picker="">
        <Select
          label="Chain"
          options={options}
          value={chainId === null ? null : String(chainId)}
          placeholder="Choose a chain"
          onValueChange={(value) => void runCommand(commandRef("chain.select", { chainId: Number(value) }), "button")}
        />
      </div>
      <WalletLoading />
      <p className={styles.line} data-readiness="">
        {line}
      </p>
      {readiness.status === "error" ? (
        <div className={styles.actions}>
          <FixButton command={commandRef("chain.retryRead")} />
          <FixButton command={commandRef("chain.useAnotherRpc")} />
        </div>
      ) : null}
      <ProblemList problems={problems} />
    </Section>
  );
}
