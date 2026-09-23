import { announce, log } from "@/contracts";
import { Checkbox } from "@/ui";
import { AckTick } from "./AckTick";
import { NO_SIMULATION_NOTE, NO_SIMULATION_TICK, type SectionStatus } from "./copy";
import { ackProblems, cantSimulate, problemStatus, worse } from "./model";
import { ProblemList } from "./ProblemList";
import { problemsIn, useReview } from "./review-data";
import { setNoSimulationTick, useReviewState } from "./review-state";
import styles from "./review.module.css";
import { Section } from "./Section";

/**
 * Checks (spec L569): what remains that no other section shows, blockers first, then warnings; the ticks for Keep
 * immutable (CORE-02), Keep example values (INIT-05) and Cut without the registry check (NET-08); and the extra tick
 * when the RPC can't simulate at all (spec L573). AUTH-01's tick lives under Authority.
 */
export function ChecksSection() {
  const review = useReview();
  const { analysis, acked, deploy } = review;
  const problems = problemsIn(review, "checks").filter((p) => p.severity !== "info");
  const ticks = ackProblems(problems);
  const shown = problems.filter((p) => !ticks.includes(p));
  const noSimulation = cantSimulate(deploy.simulation);
  const tick = useReviewState((s) => s.noSimulationTick);
  const noSimulationTicked = tick === analysis.recipeHash;

  let status: SectionStatus = problemStatus(problems, acked);
  if (noSimulation && !noSimulationTicked) status = worse(status, "tick");

  const onNoSimulation = (checked: boolean) => {
    setNoSimulationTick(checked ? analysis.recipeHash : null);
    const text = checked ? "Deploying without a simulation for this recipe." : "Unticked Deploy without a simulation.";
    log({ tag: "Note", text });
    announce(text);
  };

  return (
    <Section id="checks" status={status}>
      {problems.length === 0 && !noSimulation ? <p className={styles.muted}>No warnings left.</p> : null}
      <ProblemList problems={shown} />
      {ticks.map((problem) => (
        <AckTick key={problem.id} problem={problem} recipeHash={analysis.recipeHash} acked={acked.includes(problem.id)} />
      ))}
      {noSimulation ? (
        <Checkbox label={NO_SIMULATION_TICK} description={NO_SIMULATION_NOTE} checked={noSimulationTicked} onCheckedChange={onNoSimulation} />
      ) : null}
    </Section>
  );
}
