import type { Address, Hex } from "@lattice-studio/core";
import { formatStamp } from "@lattice-studio/core";
import { useEffect, useState, type ReactNode } from "react";
import { commandRef, now, useSettings } from "@/contracts";
import { Button, copyText } from "@/ui";
import { FixButton } from "./FixButton";
import { elapsedText, matchesText, staleText } from "./progress-view";
import { nameOf, useReview, type Review } from "./review-data";
import styles from "./review.module.css";
import progress from "./progress.module.css";

/** The chain the deploy went to (the selected one unless the controller says otherwise), its name and explorer. */
function deployChain(review: Review): { id: number | null; name: string; explorer: string | undefined } {
  const id = review.deploy.chainId ?? review.chainId;
  if (id === null) return { id, name: review.chainName, explorer: undefined };
  const info = review.service?.chains().find((chain) => chain.id === id);
  const selected = id === review.chainId;
  return {
    id,
    name: selected ? review.chainName : nameOf(review, id),
    explorer: info?.explorer ?? (selected ? review.chainInfo?.explorer : undefined),
  };
}

/** "Pending · 0:12", counting up once a second from `since` on the injected clock. */
function PendingTimer({ since }: { since: string | undefined }) {
  const [at, setAt] = useState(() => now());
  useEffect(() => {
    const timer = setInterval(() => setAt(now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = elapsedText(since, at);
  // The count stays out of the live region, so a screen reader hears "Pending" once, not every second.
  return (
    <>
      Pending
      {elapsed === null ? null : (
        <span className={progress.timer} aria-hidden="true" data-timer="">
          {` · ${elapsed}`}
        </span>
      )}
    </>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={`${styles.link} ${styles.mono}`} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function TxFact({ tx, explorer }: { tx: Hex | undefined; explorer: string | undefined }) {
  if (tx === undefined) return null;
  return (
    <>
      <dt>Transaction</dt>
      <dd data-tx="">{explorer ? <ExternalLink href={`${explorer}/tx/${tx}`}>{tx}</ExternalLink> : tx}</dd>
    </>
  );
}

function AddressFact({ address }: { address: Address | undefined }) {
  if (address === undefined) return null;
  return (
    <>
      <dt>Address</dt>
      <dd data-address="">{address}</dd>
    </>
  );
}

/** The confirmed diamond's plan, as `facets()` has to match it. */
function planCounts(review: Review): { facets: number; selectors: number } {
  const { plan } = review.analysis;
  return { facets: plan.length, selectors: plan.reduce((sum, entry) => sum + entry.selectors.length, 0) };
}

/**
 * The deploy after Sign & deploy or a Safe batch (spec L574-L580, L384-L387), in place of the review's sections: one
 * status line (a polite live region) that follows the phase, then what the phase needs: the transaction linked to the
 * explorer, Keep waiting · Check wallet · Review again once stale, Discard proposal for a Safe, the live address with
 * the explorer and Copy address, or Compare with the sheet… and Use a new salt after a mismatch.
 */
export function ProgressView() {
  const review = useReview();
  const receiptTimeout = useSettings((s) => s.receiptTimeout);
  const { deploy, connectors, account } = review;
  const chain = deployChain(review);
  const { tx, address } = deploy;

  let status: ReactNode = null;
  let body: ReactNode = null;
  switch (deploy.phase) {
    case "awaitingSignature": {
      const wallet = connectors.find((c) => c.id === account?.connector)?.name ?? "your wallet";
      status = `Confirm in ${wallet}`;
      break;
    }
    case "pending":
      status = <PendingTimer since={deploy.since} />;
      body = (
        <dl className={styles.facts}>
          <TxFact tx={tx} explorer={chain.explorer} />
          <AddressFact address={address} />
        </dl>
      );
      break;
    case "stale":
      status = staleText(receiptTimeout);
      body = (
        <>
          <dl className={styles.facts}>
            <TxFact tx={tx} explorer={chain.explorer} />
            <AddressFact address={address} />
          </dl>
          <div className={styles.actions}>
            <FixButton command={commandRef("deploy.keepWaiting")} />
            <FixButton command={commandRef("deploy.checkWallet")} />
            <FixButton command={commandRef("deploy.reviewAgain")} />
          </div>
        </>
      );
      break;
    case "proposed":
      status = formatStamp({ state: "proposed", chain: chain.name });
      body = (
        <>
          <p className={styles.line}>
            {deploy.safe ? `Proposed to Safe ${deploy.safe} on ${chain.name}.` : `Proposed on ${chain.name}.`} Waiting for the Safe
            to execute the batch.
          </p>
          <dl className={styles.facts}>
            <AddressFact address={address} />
          </dl>
          <div className={styles.actions}>
            <FixButton command={commandRef("deploy.discardProposal")} />
          </div>
        </>
      );
      break;
    case "confirmed":
      status = (
        <>
          Deployed{address ? ` at ${address}` : ""}. Reading <code className={styles.mono}>facets()</code> to compare with the
          plan…
        </>
      );
      body = (
        <dl className={styles.facts}>
          <TxFact tx={tx} explorer={chain.explorer} />
        </dl>
      );
      break;
    case "verifying": {
      const { facets, selectors } = planCounts(review);
      status = matchesText(facets, selectors);
      body = (
        <>
          <p className={styles.muted}>Verifying on Sourcify…</p>
          <dl className={styles.facts}>
            <AddressFact address={address} />
          </dl>
        </>
      );
      break;
    }
    case "live":
      status = `Live · ${chain.name}`;
      body = (
        <>
          <dl className={styles.facts}>
            <AddressFact address={address} />
          </dl>
          {address ? (
            <div className={styles.actions}>
              {chain.explorer ? (
                <a className={styles.link} href={`${chain.explorer}/address/${address}`} target="_blank" rel="noreferrer">
                  Open in explorer
                </a>
              ) : null}
              <Button size="small" icon="copy" onClick={() => void copyText(address)}>
                Copy address
              </Button>
            </div>
          ) : null}
        </>
      );
      break;
    case "mismatch":
      status = "Deployed, but doesn't match the sheet";
      body = (
        <>
          <dl className={styles.facts}>
            <AddressFact address={address} />
          </dl>
          <div className={styles.actions}>
            {chain.id !== null && address ? (
              <FixButton command={commandRef("deploy.compare", { chainId: chain.id, address })} />
            ) : null}
            <FixButton command={commandRef("deploy.newSalt")} />
          </div>
        </>
      );
      break;
    default:
      return null;
  }

  return (
    <div className={progress.progress} data-progress={deploy.phase}>
      <output className={progress.status} aria-live="polite">
        {status}
      </output>
      {body}
    </div>
  );
}
