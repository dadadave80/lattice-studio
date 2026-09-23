import type { Address, ProjectStatus } from "@lattice-studio/core";
import { formatAddress, formatProblemSummary, recipeStats } from "@lattice-studio/core";
import { useEffect, useId, useMemo, useState } from "react";
import {
  chainService, commandRef, env, now, useAnalysis, useCatalog, useDeployState, useDocument, useOnline, type DeployState,
} from "@/contracts";
import { findChain } from "@/chain/infra/chains";
import { elapsedText } from "@/chain/review/progress-view";
import { IN_FLIGHT_PHASES, ON_ITS_WAY } from "@/chain/review/entry-copy";
import { useLayoutTier } from "@/shell/layout-tier";
import { chipWords, useProjectStatus, type StatusChipWords } from "@/shell/status";
import { usePrediction } from "@/state";
import { Button } from "@/ui/buttons/Button";
import { CommandButton } from "@/ui/buttons/CommandButton";
import { IconButton } from "@/ui/buttons/IconButton";
import { copyText } from "@/ui/copy/copy-text";
import { StatusChip } from "@/ui/status/StatusChip";
import { ChainPathPicker } from "./ChainPathPicker";
import { confirmIn, NO_ADDRESS, OFFLINE_MARK, PLACE_FACETS_FIRST, toFill, YOUR_WALLET } from "./copy";
import styles from "./chrome.module.css";

/** The title block's form: in full, one collapsed row (1024 px and wider), or the strip (768-1023 px). */
export type TitleBlockForm = "full" | "collapsed" | "strip";

/** What the address line shows. */
export type AddressLine =
  | { kind: "none"; text: string }
  | { kind: "address"; address: Address; label: "Predicted" | "Deployed"; href?: string; offline: boolean };

let remembered = false;

/** The wallet's name while a signature is awaited ("Confirm in MetaMask"), from the chain module. */
function useWalletName(active: boolean): string {
  const [name, setName] = useState(YOUR_WALLET);
  useEffect(() => {
    if (!active) return;
    let live = true;
    chainService().then(
      (service) => {
        const account = service.account();
        const connector = service.connectors().find((c) => c.id === account?.connector);
        if (live && connector) setName(connector.name);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [active]);
  return name;
}

/** The time now, once a second while `active` (the pending timer). */
function useTicking(active: boolean): number {
  const [at, setAt] = useState(() => now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setAt(now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return at;
}

/**
 * The stamp (spec L362, L384-L387): the project's status on the selected chain, and while a deploy is in flight,
 * where it is: "Confirm in {wallet}", then "Pending · 0:12".
 */
export function stampWords(
  status: ProjectStatus, deploy: DeployState, chainName: (id: number) => string, wallet: string, nowMs: number,
): StatusChipWords {
  if (deploy.phase === "awaitingSignature") return { tone: "pending", text: confirmIn(wallet) };
  if (deploy.phase === "pending") {
    const elapsed = elapsedText(deploy.since, nowMs);
    return { tone: "pending", text: elapsed === null ? "Pending" : `Pending · ${elapsed}` };
  }
  return chipWords(status, deploy, chainName);
}

function explorerLink(chainId: number, address: Address): string | undefined {
  const explorer = findChain(chainId, env.e2e)?.explorer;
  return explorer ? `${explorer}/address/${address}` : undefined;
}

/** Why the title block's Deploy can't run that the command itself doesn't know, or null (spec L378, L384). */
export function localDeployReason(empty: boolean, phase: DeployState["phase"]): string | null {
  if (empty) return PLACE_FACETS_FIRST;
  // A Safe proposal keeps the command's own reason ("Waiting for the Safe to execute the batch").
  if (phase !== "proposed" && IN_FLIGHT_PHASES.has(phase)) return ON_ITS_WAY;
  return null;
}

/**
 * Deploy… or, once the sheet differs from a live deploy, Deploy again… (spec L362, L584): the view's one filled
 * button, disabled with each reason of the states table (spec L378-L389). The commands give most of them; an
 * empty sheet and a deploy on its way are said here, so Deploy again… never starts a second deploy while one
 * is pending.
 */
function DeployAction({ again, empty, phase, size }: { again: boolean; empty: boolean; phase: DeployState["phase"]; size?: "small" }) {
  const local = localDeployReason(empty, phase);
  const label = again && !empty ? "Deploy again…" : "Deploy…";
  if (local !== null) {
    return (
      <Button variant="primary" disabledReason={local} data-deploy="" {...(size ? { size } : {})}>
        {label}
      </Button>
    );
  }
  return (
    <span data-deploy="" className={styles.deploy}>
      <CommandButton command={commandRef(again ? "deploy.again" : "deploy.open")} variant="primary" {...(size ? { size } : {})}>
        {label}
      </CommandButton>
    </span>
  );
}

function CopyAddress({ address }: { address: Address }) {
  return (
    <IconButton icon="copy" label="Copy address" size="small" onClick={() => void copyText(address)} />
  );
}

function AddressView({ line, short }: { line: AddressLine; short?: boolean }) {
  if (line.kind === "none") return <span className={styles.addressNote}>{line.text}</span>;
  const text = short ? formatAddress(line.address) : line.address;
  return (
    <span className={styles.addressLine}>
      {line.href ? (
        <a className={styles.address} href={line.href} target="_blank" rel="noreferrer" title={line.address}>
          {text}
        </a>
      ) : (
        <span className={styles.address} title={line.address}>
          {text}
        </span>
      )}
      {line.offline ? <span className={styles.offline}>{OFFLINE_MARK}</span> : null}
      <CopyAddress address={line.address} />
    </span>
  );
}

/** Everything the title block shows, in one place, so each form draws the same facts. */
function useTitleBlockFacts() {
  const name = useDocument((s) => s.project.name);
  const empty = useDocument((s) => s.project.recipe.facets.length === 0);
  const { status, chainName } = useProjectStatus();
  const deploy = useDeployState((s) => s);
  const prediction = usePrediction();
  const online = useOnline();
  const catalog = useCatalog();
  const analysis = useAnalysis((a) => a);
  const wallet = useWalletName(deploy.phase === "awaitingSignature");
  const at = useTicking(deploy.phase === "pending");

  const stamp = stampWords(status, deploy, chainName, wallet, at);
  const counts = useMemo(() => {
    const blockers = analysis.problems.filter((p) => p.severity === "blocker").length;
    const warnings = analysis.problems.filter((p) => p.severity === "warning").length;
    const toFillCount = analysis.problems.filter((p) => p.code === "INIT-01").length;
    const stats = catalog ? recipeStats(analysis, catalog).text : null;
    return { blockers, problems: formatProblemSummary({ blockers, warnings }), toFillCount, stats };
  }, [analysis, catalog]);

  let address: AddressLine;
  const deployed = status.deployment;
  if (empty) {
    address = { kind: "none", text: NO_ADDRESS };
  } else if (deploy.address && deploy.chainId !== undefined && IN_FLIGHT_PHASES.has(deploy.phase) && deploy.phase !== "proposed") {
    address = { kind: "address", address: deploy.address, label: "Predicted", offline: false };
  } else if (status.state === "live" && deployed) {
    const href = explorerLink(deployed.chainId, deployed.address);
    address = { kind: "address", address: deployed.address, label: "Deployed", offline: false, ...(href ? { href } : {}) };
  } else if (prediction.status === "ready") {
    address = { kind: "address", address: prediction.address, label: "Predicted", offline: !online };
  } else {
    address = { kind: "none", text: prediction.reason };
  }

  const mismatch =
    deploy.phase === "mismatch" && deploy.chainId !== undefined && deploy.address
      ? { chainId: deploy.chainId, address: deploy.address }
      : status.state === "mismatch" && deployed
        ? { chainId: deployed.chainId, address: deployed.address }
        : null;

  return { name, empty, status, deploy, stamp, counts, address, mismatch };
}

type Facts = ReturnType<typeof useTitleBlockFacts>;

function Stamp({ stamp }: { stamp: StatusChipWords }) {
  return (
    <span className={styles.stamp} data-stamp="">
      <StatusChip tone={stamp.tone} text={stamp.text} />
    </span>
  );
}

function FullBlock({ facts, collapse }: { facts: Facts; collapse: () => void }) {
  const { name, empty, status, deploy, stamp, counts, address, mismatch } = facts;
  const titleId = useId();
  return (
    <>
      <div className={styles.titleRow}>
        <span className={styles.label}>Project</span>
        <span id={titleId} className={styles.projectName}>
          {name}
        </span>
        <IconButton icon="chevron-down" label="Collapse title block" size="small" aria-expanded onClick={collapse} />
      </div>
      <div className={styles.cell}>
        <ChainPathPicker />
        <div className={styles.addressRow}>
          {address.kind === "address" ? <span className={styles.label}>{address.label}</span> : null}
          <AddressView line={address} />
        </div>
      </div>
      <div className={styles.cell}>
        <Stamp stamp={stamp} />
        {mismatch ? (
          <CommandButton command={commandRef("deploy.compare", mismatch)} size="small">
            Compare with the sheet…
          </CommandButton>
        ) : null}
      </div>
      <div className={styles.cell}>
        {counts.stats ? <span data-counts="">{counts.stats}</span> : null}
        <span data-problems="" className={counts.blockers > 0 ? styles.blockers : undefined}>
          {counts.problems}
        </span>
      </div>
      {counts.toFillCount > 0 ? (
        <div className={styles.fillRow}>
          <span data-to-fill="">{toFill(counts.toFillCount)}</span>
          <CommandButton command={commandRef("init.open")} size="small">
            Fill in
          </CommandButton>
        </div>
      ) : null}
      <div className={styles.deployRow}>
        <DeployAction again={status.deployAgain} empty={empty} phase={deploy.phase} />
      </div>
    </>
  );
}

function CollapsedBlock({ facts, expand }: { facts: Facts; expand: () => void }) {
  const { empty, status, deploy, stamp, address } = facts;
  return (
    <div className={styles.row}>
      <Stamp stamp={stamp} />
      <AddressView line={address} short />
      <DeployAction again={status.deployAgain} empty={empty} phase={deploy.phase} size="small" />
      <IconButton icon="chevron-up" label="Expand title block" size="small" aria-expanded={false} onClick={expand} />
    </div>
  );
}

function StripBlock({ facts }: { facts: Facts }) {
  return (
    <div className={styles.row}>
      <Stamp stamp={facts.stamp} />
      <AddressView line={facts.address} short />
    </div>
  );
}

/**
 * The title block (spec L362, the states table L374-L389, IR L112), without React Flow: project name, the chain
 * and path picker, the address with Copy (or why there's none), the stamp, the counts, the problems, Fill in while
 * required arguments are empty, and Deploy…. Collapsible at 1024 px and wider, where the collapsed form keeps
 * the stamp, the short address and Deploy…; at 768-1023 px it's the strip (stamp and short address), because
 * Deploy… moves into the title bar. Under 768 px the title bar carries the stamp and Deploy…, so it shows none.
 */
export function TitleBlockContent({ form: forced }: { form?: TitleBlockForm }) {
  const tier = useLayoutTier();
  const [collapsed, setCollapsed] = useState(remembered);
  const facts = useTitleBlockFacts();
  const setForm = (next: boolean) => {
    remembered = next;
    setCollapsed(next);
  };
  const form: TitleBlockForm | null =
    forced ?? (tier === "phone" ? null : tier === "narrow" ? "strip" : collapsed ? "collapsed" : "full");
  if (form === null) return null;
  return (
    <section className={styles.titleBlock} aria-label="Title block" data-form={form} data-chrome="title-block">
      {form === "full" ? <FullBlock facts={facts} collapse={() => setForm(true)} /> : null}
      {form === "collapsed" ? <CollapsedBlock facts={facts} expand={() => setForm(false)} /> : null}
      {form === "strip" ? <StripBlock facts={facts} /> : null}
    </section>
  );
}

/** @internal Tests: forget the collapse the last title block remembered. */
export function resetTitleBlockCollapse(): void {
  remembered = false;
}

