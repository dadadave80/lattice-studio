import type { InitPlan, Refs } from "@lattice-studio/core";
import { decodeInit, isAddress, planInit, toChecksum } from "@lattice-studio/core";
import { Fragment, useEffect, useRef, useState } from "react";
import { commandRef } from "@/contracts";
import { useEnsLabels } from "@/panels/init/init-ui-store";
import { Icon } from "@/ui";
import type { SectionStatus } from "./copy";
import { FixButton } from "./FixButton";
import {
  argumentPath, ensEntries, flattenArgs, recheckLine, valueText, type EnsEntry, type Recheck,
} from "./init-view";
import { problemStatus, worse } from "./model";
import { ProblemList } from "./ProblemList";
import { problemsIn, useReview } from "./review-data";
import styles from "./review.module.css";
import { Section } from "./Section";

/** One init call as the section lists it. */
type StepView = {
  key: string;
  title: string;
  target?: string;
  lines: { key: string; text: string }[];
};

function planOf(...args: Parameters<typeof planInit>): InitPlan | null {
  try {
    return planInit(...args);
  } catch {
    return null;
  }
}

/**
 * Init (spec L567): the decoded arguments, references as "this diamond (0x…)", ENS names typed this session beside
 * their addresses, each re-resolved once here and flagged when it points elsewhere now (spec L462). Before the init
 * data can be built (no wallet yet) it lists the planned arguments and says why.
 */
export function InitSection() {
  const review = useReview();
  const { analysis, catalog, project, prediction, acked, chainId, service, online } = review;
  const problems = problemsIn(review, "init");
  const plan = planOf(project.recipe, catalog);
  const refs: Refs = prediction.status === "ready" ? { self: prediction.address, deployer: prediction.from } : {};
  const labels = useEnsLabels();
  const ens = ensEntries(labels, project.id, chainId, plan);
  const rechecks = useRechecks({ labels, projectId: project.id, recipe: project.recipe, catalog, chainId, service, online });

  let status: SectionStatus = problemStatus(problems, acked);
  let note: string | null = null;
  let steps: StepView[] = [];
  const init = analysis.init;

  if (init === null) {
    note = "No init call: the diamond is cut without one.";
  } else if (init.data !== undefined) {
    const decoded = decodeInit(init.data, catalog, refs);
    if (!decoded.ok) {
      note = decoded.error;
      status = worse(status, "blocked");
    } else if (decoded.value.kind === "none") {
      note = "No init call: the diamond is cut without one.";
    } else {
      steps = decoded.value.steps.map((step, index) => {
        const title = `${step.spec ?? plan?.steps[index]?.spec ?? "Unknown init"} · ${step.fn}`;
        const lines = flattenArgs(step.args).map(({ key, value }) => {
          const path = argumentPath(plan, index, key);
          return { key, text: valueText(value, { fromRef: step.fromRef[key], refs, ens, path }) };
        });
        return { key: `${index}`, title, ...(step.target ? { target: toChecksum(step.target) } : {}), lines };
      });
    }
  } else {
    if (prediction.status !== "ready") {
      note = prediction.reason;
      status = worse(status, "waiting");
    }
    steps = (plan?.steps ?? []).map((step) => ({
      key: step.path,
      title: `${step.spec} · ${step.fn}`,
      lines: flattenArgs(step.args).map(({ key, value }) => ({
        key,
        text: valueText(value, { refs, ens, path: `${step.path}.${key}` }),
      })),
    }));
  }

  return (
    <Section id="init" status={status}>
      {note ? (
        <p className={styles.line} data-init-note="">
          {note}
        </p>
      ) : null}
      {steps.map((step) => (
        <div key={step.key} className={styles.content} data-init-step={step.title}>
          <p className={styles.line}>{step.title}</p>
          {step.target ? (
            <p className={styles.muted}>
              at <span className={styles.mono}>{step.target}</span>
            </p>
          ) : null}
          {step.lines.length === 0 ? (
            <p className={styles.muted}>No arguments.</p>
          ) : (
            <dl className={styles.facts}>
              {step.lines.map((line) => (
                <Fragment key={line.key}>
                  <dt>{line.key}</dt>
                  <dd>{line.text}</dd>
                </Fragment>
              ))}
            </dl>
          )}
        </div>
      ))}
      {ens.length > 0 ? (
        <div className={styles.content} data-ens="">
          <p className={styles.muted}>ENS names typed this session are resolved again here.</p>
          {ens.map((entry) => (
            <RecheckLine key={entry.path} entry={entry} recheck={rechecks[recheckKey(entry)] ?? (online ? { status: "pending" } : { status: "offline" })} />
          ))}
        </div>
      ) : null}
      <ProblemList problems={problems} />
    </Section>
  );
}

function RecheckLine({ entry, recheck }: { entry: EnsEntry; recheck: Recheck }) {
  const { text, changed } = recheckLine(entry, recheck);
  if (!changed) {
    return (
      <p className={styles.line} data-ens-name={entry.name}>
        {text}
      </p>
    );
  }
  return (
    <div className={styles.problem} data-ens-name={entry.name} data-ens-changed="">
      <p className={styles.problemText}>
        <Icon name="warning" size="small" label="Warning" />
        <span>{text}</span>
      </p>
      <div className={styles.actions}>
        <FixButton command={commandRef("init.focusField", { path: entry.path })} />
      </div>
    </div>
  );
}

function recheckKey(entry: EnsEntry): string {
  return `${entry.path}|${entry.name}|${entry.address}`;
}

type RecheckInput = {
  labels: ReturnType<typeof useEnsLabels>;
  projectId: string;
  recipe: Parameters<typeof planInit>[0];
  catalog: Parameters<typeof planInit>[1];
  chainId: number | null;
  service: ReturnType<typeof useReview>["service"];
  online: boolean;
};

/**
 * Re-resolves each typed name once per mounted review (spec L462), for the chain it was typed for, which is the
 * selected chain: names typed for other chains are never resolved here. Waits for the chain module and a connection.
 */
function useRechecks({ labels, projectId, recipe, catalog, chainId, service, online }: RecheckInput): Readonly<Record<string, Recheck>> {
  const [found, setFound] = useState<Readonly<Record<string, Recheck>>>({});
  const asked = useRef(new Set<string>());
  // Answers land while the review is open, even when an edit re-runs the effect: each name is asked only once.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!service || !online || chainId === null) return;
    for (const entry of ensEntries(labels, projectId, chainId, planOf(recipe, catalog))) {
      const key = recheckKey(entry);
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      const settle = (recheck: Recheck) => {
        if (mounted.current) setFound((prev) => ({ ...prev, [key]: recheck }));
      };
      service.resolveEns(entry.name, chainId).then(
        (result) => {
          if (!result.ok) settle({ status: "failed", reason: result.error });
          else settle({ status: "resolved", address: result.value !== null && isAddress(result.value) ? toChecksum(result.value) : null });
        },
        (error: unknown) => settle({ status: "failed", reason: error instanceof Error ? error.message : String(error) }),
      );
    }
  }, [labels, projectId, recipe, catalog, chainId, service, online]);
  return found;
}
