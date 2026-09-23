import type { Problem } from "@lattice-studio/core";
import { Icon } from "@/ui";
import { FixButton } from "./FixButton";
import styles from "./review.module.css";

export type ProblemListProps = {
  problems: readonly Problem[];
  /** Fixes the section already offers as its own controls (the tick, Use a new salt), left out here. */
  omitFixes?: readonly string[];
};

function severityLabel(problem: Problem): string {
  if (problem.severity === "blocker") return "Blocker";
  return problem.severity === "warning" ? "Warning" : "Info";
}

/** A section's problems in the spec's words, each with its fixes as buttons that say why when they can't run. */
export function ProblemList({ problems, omitFixes = [] }: ProblemListProps) {
  if (problems.length === 0) return null;
  return (
    <ul className={styles.problems}>
      {problems.map((problem) => {
        const fixes = problem.fixes.filter((fix) => !omitFixes.includes(fix.id));
        const icon = problem.severity === "blocker" ? "error" : problem.severity === "warning" ? "warning" : "info";
        return (
          <li key={problem.id} className={styles.problem} data-problem={problem.id}>
            <p className={styles.problemText}>
              <Icon name={icon} size="small" label={severityLabel(problem)} />
              <span>{problem.message}</span>
            </p>
            {fixes.length > 0 ? (
              <div className={styles.actions}>
                {fixes.map((fix) => (
                  <FixButton key={`${fix.id}|${JSON.stringify(fix.args ?? {})}`} command={fix} />
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
