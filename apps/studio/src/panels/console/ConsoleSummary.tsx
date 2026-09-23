import { useSyncExternalStore } from "react";
import { useAnalysis, useDeployState, useDocument, useOnline } from "@/contracts";
import { cx } from "@/ui";
import { chainName } from "./chains";
import styles from "./ConsolePanel.module.css";
import { latestWith, logEntries, subscribeLog } from "./log-store";
import { consoleSummary, STREAMING } from "./summary";

function counts(problems: readonly { severity: string }[]): string {
  let blockers = 0;
  let warnings = 0;
  for (const p of problems) {
    if (p.severity === "blocker") blockers += 1;
    else if (p.severity === "warning") warnings += 1;
  }
  return `${blockers}:${warnings}`;
}

/** The header's summary and its square (spec L376-L389, the Console summary column). */
export function ConsoleSummary() {
  const facets = useDocument((s) => s.project.recipe.facets.length);
  const tally = useAnalysis((a) => counts(a.problems));
  const recipeHash = useAnalysis((a) => a.recipeHash);
  const online = useOnline();
  const phase = useDeployState((d) => d.phase);
  const snapshot = useDeployState((d) => d.snapshot);
  const chainId = useDeployState((d) => d.chainId);
  const safe = useDeployState((d) => d.safe);
  const entries = useSyncExternalStore(subscribeLog, logEntries);
  const streaming = STREAMING.has(phase);
  const latest = streaming ? (latestWith(entries, ["Deploy", "Verify", "Error"])?.text ?? null) : null;
  const [blockers = 0, warnings = 0] = tally.split(":").map(Number);

  const summary = consoleSummary({
    facets,
    blockers,
    warnings,
    online,
    recipeHash,
    deploy: {
      phase,
      ...(snapshot === undefined ? {} : { snapshot }),
      ...(chainId === undefined ? {} : { chainId }),
      ...(safe === undefined ? {} : { safe }),
    },
    latestDeployLine: latest,
    chainName: (id) => chainName(id),
  });

  return (
    <span className={cx(styles.summary, summary.accent && styles.accent)} data-summary={summary.kind}>
      <span className={styles.square} aria-hidden="true" />
      <span className={styles.summaryText}>{summary.text}</span>
    </span>
  );
}
