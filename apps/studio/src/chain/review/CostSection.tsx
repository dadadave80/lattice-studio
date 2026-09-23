import { formatFee, formatGas } from "@lattice-studio/core";
import type { SectionStatus } from "./copy";
import { OP_STACK_CHAINS } from "./fees";
import { calldataBytes, grouped, magnitude, problemStatus, worse } from "./model";
import { ProblemList } from "./ProblemList";
import { currencyOf, problemsIn, useReview } from "./review-data";
import styles from "./review.module.css";
import { Section } from "./Section";

const READING_FEES = "Reading fees…";

/**
 * Cost (spec L571): gas, an "about" and a "max" fee, the L1 data fee on OP Stack chains, the calldata size, and the
 * share of the chain's per-transaction gas cap. NET-06 shows here with Remove facets….
 */
export function CostSection() {
  const review = useReview();
  const { cost, chainId, chainName, acked } = review;
  const problems = problemsIn(review, "cost");
  const { symbol, decimals } = currencyOf(review);
  const fee = (wei: bigint) => formatFee(wei, symbol, decimals);

  let status: SectionStatus = problemStatus(problems, acked);
  if (cost.gas === undefined) status = worse(status, "waiting");

  const { fees } = cost;
  const feeText =
    fees.status === "ready"
      ? `about ${fee(fees.quote.about)} · at most ${fee(fees.quote.max)}`
      : fees.status === "loading"
        ? READING_FEES
        : fees.reason;
  const l1 =
    fees.status === "ready" && fees.quote.l1 !== undefined ? fee(fees.quote.l1) : fees.status === "loading" ? READING_FEES : "Not read yet";
  const share =
    cost.share !== undefined && cost.cap !== undefined
      ? `${Math.round(cost.share.share * 100)}% of ${chainName}'s ${magnitude(cost.cap)} per-transaction cap`
      : "Known once the gas is estimated";

  return (
    <Section id="cost" status={status}>
      <dl className={styles.facts}>
        <dt>Gas</dt>
        <dd data-gas="">{cost.gas === undefined ? "Estimated once the simulation runs" : formatGas(cost.gas)}</dd>
        <dt>Fee</dt>
        <dd data-fee="">{feeText}</dd>
        {chainId !== null && OP_STACK_CHAINS.has(chainId) ? (
          <>
            <dt>L1 data fee</dt>
            <dd data-l1-fee="">{l1}</dd>
          </>
        ) : null}
        <dt>Calldata</dt>
        <dd data-calldata="">{cost.deploy.ok ? `${grouped(calldataBytes(cost.deploy.value.tx.data))} bytes` : cost.deploy.error}</dd>
        <dt>Share of the cap</dt>
        <dd data-share="">{share}</dd>
      </dl>
      <ProblemList problems={problems} />
    </Section>
  );
}
