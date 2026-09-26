import { Button, copyText } from "@/ui";
import { NO_SIMULATION_NOTE, SIMULATING, type SectionStatus } from "./copy";
import {
  CONTROLLER_NOT_BUILT, cantSimulate, controllerChainName, grouped, pathName, resimulating, simulationOwnsError,
} from "./model";
import { simulationReport } from "./progress-view";
import { useReview, type Review } from "./review-data";
import { useReviewState } from "./review-state";
import styles from "./review.module.css";
import { Section } from "./Section";

const NOT_YET = "Runs once the network, the account and the inputs are known.";

type Shown = { status: SectionStatus; text: string; revert?: string };

/**
 * What the section says, in the order Sign & deploy reads the same state (model `signEnablement`), so the mark and
 * the footer never disagree: not built, simulating (again), passed, reverted, couldn't simulate, not yet.
 */
function shown(review: Review, ticked: boolean): Shown {
  const { deploy, analysis } = review;
  if (deploy.phase === "idle") return { status: "waiting", text: CONTROLLER_NOT_BUILT };
  // A change marks the review until it's signed (spec L562); the section waits only while it simulates again.
  if (resimulating(deploy, analysis.recipeHash) || deploy.phase === "simulating") return { status: "waiting", text: SIMULATING };
  const { simulation } = deploy;
  if (simulation?.ok) {
    const text = simulation.summary ?? (simulation.block === undefined ? "Simulated." : `Simulated at block ${grouped(simulation.block)}.`);
    return { status: "ok", text };
  }
  // Before the revert branch: an RPC that can't simulate isn't a revert, whatever text it carries (spec L575).
  if (cantSimulate(simulation)) {
    const text = simulationOwnsError(deploy, controllerChainName) ? (deploy.error ?? NO_SIMULATION_NOTE) : NO_SIMULATION_NOTE;
    return { status: ticked ? "ok" : "tick", text };
  }
  if (simulation?.revert) return { status: "blocked", text: simulation.revert, revert: simulation.revert };
  return { status: "waiting", text: NOT_YET };
}

/**
 * Simulation (spec L572): runs by itself once network, account and inputs are known (S8c's controller runs it). It
 * shows "Simulated at block 9,123,456: diamond at 0x… with 14 facets, 120 selectors, 7 events.", or the decoded
 * revert with Copy details for a bug report (Flow 14), or that the RPC couldn't simulate (the tick lives in Checks).
 */
export function SimulationSection() {
  const review = useReview();
  const tick = useReviewState((s) => s.noSimulationTick);
  const { status, text, revert } = shown(review, tick === review.analysis.recipeHash);

  const copyDetails = () => {
    if (revert === undefined) return;
    const { simulation } = review.deploy;
    const report = simulationReport({
      revert,
      recipeHash: review.analysis.recipeHash,
      chainName: review.chainName,
      chainId: review.chainId,
      path: pathName(review.project.deploy.path),
      catalog: review.catalog.lattice.tag,
      ...(simulation?.block === undefined ? {} : { block: simulation.block }),
    });
    void copyText(report, { label: "details" });
  };

  return (
    <Section id="simulation" status={status}>
      <p className={status === "waiting" ? styles.muted : styles.line} data-simulation="">
        {text}
      </p>
      {revert !== undefined ? (
        <div className={styles.actions}>
          <Button size="small" icon="copy" onClick={copyDetails}>
            Copy details
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
