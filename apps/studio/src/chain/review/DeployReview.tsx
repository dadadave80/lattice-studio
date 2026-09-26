import type { Address, Catalog } from "@lattice-studio/core";
import { authorityTable, isAddress, toChecksum } from "@lattice-studio/core";
import { useEffect, useMemo, useRef } from "react";
import {
  closeDialog, useAnalysis, useCatalog, useDeployState, useDocument, useOnline, useSession,
  type DialogComponentProps,
} from "@/contracts";
import { usePrediction } from "@/state";
import { useProjectStatus } from "@/shell/status";
import { Dialog } from "@/ui";
import { AddressSection } from "./AddressSection";
import { AuthoritySection } from "./AuthoritySection";
import { ChecksSection } from "./ChecksSection";
import { ConfirmBlock } from "./ConfirmBlock";
import { CHANGED_SINCE_REVIEW, CHANGED_SINCE_REVIEW_MARK, deployAgainNote } from "./copy";
import { CostSection } from "./CostSection";
import { CutSection } from "./CutSection";
import { DeployerSection } from "./DeployerSection";
import { InitSection } from "./InitSection";
import {
  IN_FLIGHT_PHASES, PRE_SIGN_PHASES, PROGRESS_PHASES, changedSinceReview, controllerChainName, resimulating, shortHash,
  signStepNote,
} from "./model";
import { NetworkSection } from "./NetworkSection";
import { ProgressView } from "./ProgressView";
import { ReviewContext, type Review } from "./review-data";
import { beginReview } from "./review-state";
import styles from "./review.module.css";
import { FailedNotice } from "./FailedNotice";
import { ReviewFooter } from "./ReviewFooter";
import { SimulationSection } from "./SimulationSection";
import { useCost } from "./use-cost";
import { useAccount, useChainService, useConnectors, useController, useReadiness } from "./use-review";

/**
 * The deploy review (Flow 12, spec L560-L580, IR L221-L243): a 640 px dialog, full height when narrow, whose nine
 * sections each prove one thing with a status mark, and a Sign & deploy that enables only when nothing blocks.
 * It opens S8c's deploy controller (`open()` snapshots the recipe hash), tells it about any edit, account or chain
 * change (`changed()`), and signs through it. `at: "progress"` reopens it at a deploy's progress (IR L207).
 */
export function DeployReview({ entry, top }: DialogComponentProps<"deploy-review">) {
  const catalog = useCatalog();
  const name = useDocument((s) => s.project.name);
  const onOpenChange = (open: boolean) => {
    if (!open) closeDialog("deploy-review");
  };
  if (!catalog) {
    return (
      <Dialog open onOpenChange={onOpenChange} top={top} size="wide" title={`Deploy ${name}`} initialFocus="title">
        <p className={styles.muted}>The catalog hasn't loaded yet.</p>
      </Dialog>
    );
  }
  return <ReviewDialog catalog={catalog} entry={entry} top={top} />;
}

/** Literal addresses that receive authority: the chain module reads their code for AUTH-01 (spec L332). */
function authorityHolders(review: Pick<Review, "project" | "catalog">): Address[] {
  try {
    const rows = authorityTable(review.project.recipe, review.catalog);
    const out = rows.map((row) => row.holder).filter((holder) => isAddress(holder)).map((holder) => toChecksum(holder as Address));
    return [...new Set(out)];
  } catch {
    return [];
  }
}

function ReviewDialog({ catalog, entry, top }: DialogComponentProps<"deploy-review"> & { catalog: Catalog }) {
  const project = useDocument((s) => s.project);
  const analysis = useAnalysis();
  const chainId = useSession((s) => s.chainId);
  const acks = useSession((s) => s.acks);
  const online = useOnline();
  const readOnly = useSession((s) => s.readOnly);
  const prediction = usePrediction();
  const serviceLoad = useChainService();
  const service = serviceLoad.status === "ready" ? serviceLoad.value : null;
  const account = useAccount(service);
  const connectors = useConnectors(service);
  const readiness = useReadiness(service, chainId);
  const controllerLoad = useController();
  const controller = controllerLoad.status === "ready" ? controllerLoad.value : null;
  const deploy = useDeployState((s) => s);
  const { status } = useProjectStatus();

  const chainInfo = chainId === null ? undefined : service?.chains().find((c) => c.id === chainId);
  const chainName = chainId === null ? "" : (chainInfo?.name ?? `Chain ${chainId}`);
  const chain = readiness.status === "ready" ? readiness.state : undefined;
  const cost = useCost({ project, catalog, analysis, prediction, chain, online });

  const review: Review = {
    project, catalog, analysis, online, readOnly, chainId, chainName, chainInfo, service,
    serviceError: serviceLoad.status === "error" ? serviceLoad.reason : null,
    serviceLoading: serviceLoad.status === "loading",
    readiness, chain, account, connectors, prediction, deploy, controller,
    acked: acks[analysis.recipeHash] ?? [], cost,
  };

  // A fresh review forgets the last one's preview, no-simulation tick and typed name.
  const fresh = entry.props.at !== "progress";
  useEffect(() => {
    if (fresh) beginReview();
  }, [fresh]);

  // Open: the controller snapshots the recipe hash and starts its review (spec L562), unless this is a deploy's progress.
  const opened = useRef(false);
  useEffect(() => {
    if (!controller || opened.current) return;
    opened.current = true;
    if (entry.props.at === "progress" || IN_FLIGHT_PHASES.has(controller.state().phase)) return;
    controller.open();
  }, [controller, entry.props.at]);

  // Any edit, account switch or chain switch while it's open: "Changed since review", simulate again (spec L562).
  const accountKey = account ? `${account.address.toLowerCase()}@${account.chainId}` : "none";
  const addressKey = prediction.status === "ready" ? prediction.address : "none";
  const changeKey = `${analysis.recipeHash}|${accountKey}|${chainId ?? "none"}|${addressKey}`;
  const baseline = useRef<string | null>(null);
  useEffect(() => {
    if (!controller || !service) return;
    if (baseline.current === null || baseline.current === changeKey) {
      baseline.current = changeKey;
      return;
    }
    baseline.current = changeKey;
    if (PRE_SIGN_PHASES.has(controller.state().phase)) controller.changed();
  }, [controller, service, changeKey]);

  // Readiness for the selected chain and path, with the code at every literal authority holder (AUTH-01).
  const holders = useMemo(() => authorityHolders({ project, catalog }), [project, catalog]);
  const holdersKey = holders.join(",");
  const path = project.deploy.path;
  useEffect(() => {
    if (!service || chainId === null || !online) return;
    void service.probe(chainId, { path, codeAt: holdersKey === "" ? [] : (holdersKey.split(",") as Address[]) });
  }, [service, chainId, path, holdersKey, online]);

  const progress = PROGRESS_PHASES.has(deploy.phase);
  const changed = changedSinceReview(deploy, analysis.recipeHash);
  const signNote = signStepNote(deploy, controllerChainName);
  // Flow 13: the live diamond this deploy leaves as it is.
  const live = status.deployAgain && status.deployment ? status.deployment.address : null;

  const close = () => {
    controller?.close();
    closeDialog("deploy-review");
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      top={top}
      size="wide"
      title={`Deploy ${project.name}`}
      description={`Recipe ${shortHash(analysis.recipeHash)} · catalog ${catalog.lattice.tag}`}
      initialFocus="title"
      footer={
        <ReviewContext.Provider value={review}>
          <ReviewFooter progress={progress} onClose={close} />
        </ReviewContext.Provider>
      }
    >
      <ReviewContext.Provider value={review}>
        <div className={styles.body} data-review="">
          {live ? <p className={styles.notice}>{deployAgainNote(live)}</p> : null}
          {deploy.phase === "failed" && deploy.error ? <FailedNotice error={deploy.error} /> : null}
          {changed ? (
            <output className={styles.notice}>
              {resimulating(deploy, analysis.recipeHash) ? CHANGED_SINCE_REVIEW : CHANGED_SINCE_REVIEW_MARK}
            </output>
          ) : null}
          {/* Not a live region: S8c logs the same words as an Error, announced as the setting says (spec L778). */}
          {signNote !== null && !progress ? (
            <p className={styles.notice} data-sign-note="">
              {signNote}
            </p>
          ) : null}
          {progress ? (
            <ProgressView />
          ) : (
            <>
              <div className={styles.sections}>
                <NetworkSection />
                <DeployerSection />
                <AddressSection />
                <CutSection />
                <InitSection />
                <AuthoritySection />
                <ChecksSection />
                <CostSection />
                <SimulationSection />
              </div>
              <ConfirmBlock />
            </>
          )}
        </div>
      </ReviewContext.Provider>
    </Dialog>
  );
}
