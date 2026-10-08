import type { Address, ProjectStatus } from "@lattice-studio/core";
import { formatAddress, formatProblemSummary, isCoreOnly, recipeStats } from "@lattice-studio/core";
import { spacing } from "@lattice-studio/tokens";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  chainService, commandRef, env, now, useAnalysis, useCatalog, useDeployState, useDocument, useOnline, useSession,
  type DeployState,
} from "@/contracts";
import { findChain } from "@/chain/infra/chains";
import { useLayoutTier } from "@/shell/layout-tier";
import { chipWords, useProjectStatus, type StatusChipWords } from "@/shell/status";
import { usePrediction } from "@/state";
import { Button } from "@/ui/buttons/Button";
import { CommandButton } from "@/ui/buttons/CommandButton";
import { IconButton } from "@/ui/buttons/IconButton";
import { copyText } from "@/ui/copy/copy-text";
import { VisuallyHidden } from "@/ui/shared/VisuallyHidden";
import { StatusChip } from "@/ui/status/StatusChip";
import { ChainPathPicker } from "./ChainPathPicker";
import { rememberedTitleBlockChoice, rememberTitleBlockChoice } from "./title-block-choice";
import {
  confirmIn, elapsedText, IN_FLIGHT_PHASES, LANDED_PHASES, NEW_TAB, NO_ADDRESS, OFFLINE_MARK, ON_ITS_WAY,
  PLACE_FACETS_FIRST, toFill, YOUR_WALLET,
} from "./copy";
import styles from "./chrome.module.css";

/** The title block's form: in full, one collapsed row (1024 px and wider), or the strip (768-1023 px). */
export type TitleBlockForm = "full" | "collapsed" | "strip";

/** What the address line shows. */
export type AddressLine =
  | { kind: "none"; text: string }
  | { kind: "address"; address: Address; label: "Predicted" | "Deployed"; href?: string; offline: boolean };

/**
 * A sheet shorter than this, in px, opens with the title block collapsed (David's decision on SH-01/SH-02):
 * 15 × `--lx-space-12` (720). The full block is about 6 of those steps tall (286 px measured), so below this it
 * would take more than 40% of the sheet's height from the cards Fit frames. At the default panes that collapses
 * it in a 900 px tall window (a 700 px sheet) and keeps it full at 1080 (880 px), or at 900 with the console closed.
 */
export const SHORT_SHEET = 15 * Number.parseFloat(spacing["space-12"]);

/**
 * Whether the title block starts collapsed: while the sheet is empty (the core alone: the block would only say
 * "Choose a chain", "Not deployed" and a disabled Deploy…) or short (`SHORT_SHEET`; null while not measured).
 */
export function collapsedByDefault(empty: boolean, short: boolean | null): boolean {
  return empty || short === true;
}

/**
 * Whether the sheet the block sits on is shorter than `SHORT_SHEET`, kept current; null with no sheet around it
 * (as in its own tests). It changes only when the sheet crosses the line, so a resize doesn't re-render the block.
 */
function useShortSheet(root: RefObject<HTMLElement | null>, active: boolean): boolean | null {
  const [short, setShort] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const sheet = active ? root.current?.closest<HTMLElement>(".react-flow") : null;
    if (!sheet) return;
    // Measured before the first paint, so Fit and the first view find the block in the form it keeps. A hidden
    // sheet (a pane switcher tab) measures 0: it keeps what it last was.
    const measure = () => {
      if (sheet.clientHeight > 0) setShort(sheet.clientHeight < SHORT_SHEET);
    };
    measure();
    // A resize changes the block's form a frame later, outside the observer's callback, so the panels that follow
    // its size (the core cell) don't loop the observers.
    let frame = 0;
    const sizes = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    sizes.observe(sheet);
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
    };
  }, [root, active]);
  return active ? short : null;
}

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

/**
 * Why the title block's Deploy can't run that the command itself doesn't know, or null (spec L378, L384). A
 * read-only session outranks an empty sheet: facets can't be placed either, so its reason is the one to act on.
 */
export function localDeployReason(empty: boolean, phase: DeployState["phase"], readOnly: string | null): string | null {
  if (readOnly !== null) return readOnly;
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
  const readOnly = useSession((s) => s.readOnly);
  const local = localDeployReason(empty, phase, readOnly);
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
          <VisuallyHidden>{NEW_TAB}</VisuallyHidden>
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
  const empty = useDocument((s) => isCoreOnly(s.project.recipe));
  const { status, chainName } = useProjectStatus();
  const phase = useDeployState((s) => s.phase);
  const deployChain = useDeployState((s) => s.chainId);
  const deployAddress = useDeployState((s) => s.address);
  const since = useDeployState((s) => s.since);
  const deploy = useMemo<DeployState>(
    () => ({
      phase,
      ...(deployChain === undefined ? {} : { chainId: deployChain }),
      ...(deployAddress === undefined ? {} : { address: deployAddress }),
      ...(since === undefined ? {} : { since }),
    }),
    [phase, deployChain, deployAddress, since],
  );
  const prediction = usePrediction();
  const online = useOnline();
  const catalog = useCatalog();
  const problems = useAnalysis((a) => a.problems);
  const stats = useAnalysis((a) => (catalog ? recipeStats(a, catalog).text : null));
  const wallet = useWalletName(deploy.phase === "awaitingSignature");
  const at = useTicking(deploy.phase === "pending");

  const stamp = stampWords(status, deploy, chainName, wallet, at);
  const counts = useMemo(() => {
    const blockers = problems.filter((p) => p.severity === "blocker").length;
    const warnings = problems.filter((p) => p.severity === "warning").length;
    const toFillCount = problems.filter((p) => p.code === "INIT-01").length;
    return { blockers, problems: formatProblemSummary({ blockers, warnings }), toFillCount, stats };
  }, [problems, stats]);

  let address: AddressLine;
  const deployed = status.deployment;
  if (empty) {
    address = { kind: "none", text: NO_ADDRESS };
  } else if (deploy.address && deploy.chainId !== undefined && IN_FLIGHT_PHASES.has(deploy.phase) && deploy.phase !== "proposed") {
    // Once the transaction lands (confirmed, verifying) the address is the diamond's own.
    const label = LANDED_PHASES.has(deploy.phase) ? "Deployed" : "Predicted";
    address = { kind: "address", address: deploy.address, label, offline: false };
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

type Toggle = { controls: string; onToggle: () => void };

function FullBlock({ facts, toggle }: { facts: Facts; toggle: Toggle }) {
  const { name, empty, status, deploy, stamp, counts, address, mismatch } = facts;
  return (
    <>
      <div className={styles.titleRow}>
        <span className={styles.label}>Project</span>
        <span className={styles.projectName}>{name}</span>
        <IconButton
          icon="chevron-down" label="Collapse title block" size="small" aria-expanded aria-controls={toggle.controls}
          data-title-toggle="" onClick={toggle.onToggle}
        />
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
      {/* Counts wait for the first facet: the core alone has nothing to count yet, and its problems aren't the person's. */}
      {empty ? null : (
        <div className={styles.cell}>
          {counts.stats ? <span data-counts="">{counts.stats}</span> : null}
          <span data-problems="" className={counts.blockers > 0 ? styles.blockers : undefined}>
            {counts.problems}
          </span>
        </div>
      )}
      {!empty && counts.toFillCount > 0 ? (
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

function CollapsedBlock({ facts, toggle }: { facts: Facts; toggle: Toggle }) {
  const { empty, status, deploy, stamp, address } = facts;
  return (
    <div className={styles.row}>
      <Stamp stamp={stamp} />
      <AddressView line={address} short />
      <DeployAction again={status.deployAgain} empty={empty} phase={deploy.phase} size="small" />
      <IconButton
        icon="chevron-up" label="Expand title block" size="small" aria-expanded={false} aria-controls={toggle.controls}
        data-title-toggle="" onClick={toggle.onToggle}
      />
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
 * and path picker, the address with Copy (or why there's none), the stamp, the counts and the problems once a
 * facet is placed, Fill in while required arguments are empty, and Deploy…. Collapsible at 1024 px and wider, where the collapsed form keeps
 * the stamp, the short address and Deploy…; at 768-1023 px it's the strip (stamp and short address), because
 * Deploy… moves into the title bar. Under 768 px the title bar carries the stamp and Deploy…, so it shows none.
 */
export function TitleBlockContent({ form: forced }: { form?: TitleBlockForm }) {
  const tier = useLayoutTier();
  const [choice, setChoice] = useState(rememberedTitleBlockChoice);
  const facts = useTitleBlockFacts();
  const root = useRef<HTMLElement>(null);
  const id = useId();
  const toggled = useRef(false);
  const onSheet = forced === undefined && (tier === "wide" || tier === "mid");
  const short = useShortSheet(root, onSheet);
  const byDefault = collapsedByDefault(facts.empty, short);
  // A choice made against another default is spent: the condition changed, so the default rules again. Until the
  // sheet is measured (the first render) the condition isn't known yet, and the choice stands.
  const known = !onSheet || short !== null;
  // A spent choice is forgotten, so the condition changing back doesn't bring it back (`title-block-choice.ts`).
  const live = choice !== null && choice === rememberedTitleBlockChoice() && (!known || choice.over === byDefault) ? choice : null;
  const collapsed = live ? live.collapsed : byDefault;
  useLayoutEffect(() => {
    if (known && live === null && choice !== null && rememberedTitleBlockChoice() === choice) rememberTitleBlockChoice(null);
  }, [known, live, choice]);
  const setForm = (next: boolean) => {
    const made = { collapsed: next, over: byDefault };
    rememberTitleBlockChoice(made);
    toggled.current = true;
    setChoice(made);
  };
  // The toggle is a new button in the other form: focus follows it, so the keyboard never loses its place.
  useLayoutEffect(() => {
    if (!toggled.current) return;
    toggled.current = false;
    root.current?.querySelector<HTMLElement>("[data-title-toggle]")?.focus();
  }, [collapsed]);
  const form: TitleBlockForm | null =
    forced ?? (tier === "phone" ? null : tier === "narrow" ? "strip" : collapsed ? "collapsed" : "full");
  if (form === null) return null;
  return (
    <section ref={root} id={id} className={styles.titleBlock} aria-label="Title block" data-form={form} data-chrome="title-block">
      {form === "full" ? <FullBlock facts={facts} toggle={{ controls: id, onToggle: () => setForm(true) }} /> : null}
      {form === "collapsed" ? <CollapsedBlock facts={facts} toggle={{ controls: id, onToggle: () => setForm(false) }} /> : null}
      {form === "strip" ? <StripBlock facts={facts} /> : null}
    </section>
  );
}

export { resetTitleBlockCollapse } from "./title-block-choice";

