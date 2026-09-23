import type { CommandRef } from "@lattice-studio/core";
import { CommandButton, Icon } from "@/ui";
import { CodeText } from "./CodeText";
import { usePathProblems } from "./hooks";
import styles from "./InitEditor.module.css";

/** Fixes that would only bring you back here. */
function elsewhere(fix: CommandRef): boolean {
  return fix.id !== "init.open" && fix.id !== "init.focusField";
}

/** A step's problems inline (INIT-02 "VaultCore initializes before ERC4626; it must come after."), with their fixes. */
export function StepProblems({ path }: { path: string }) {
  const problems = usePathProblems(path);
  if (problems.length === 0) return null;
  return (
    <>
      {problems.map((problem) => (
        <div key={problem.id} className={styles.stepProblem}>
          <p className={styles.problemText}>
            <Icon name={problem.severity === "blocker" ? "error" : problem.severity === "warning" ? "warning" : "info"} label={problem.severity === "blocker" ? "Blocker" : problem.severity === "warning" ? "Warning" : "Info"} />
            <span>
              <CodeText text={problem.message} />
            </span>
          </p>
          {problem.fixes.some(elsewhere) ? (
            <div className={styles.actions}>
              {problem.fixes.filter(elsewhere).map((fix) => (
                <CommandButton key={JSON.stringify(fix)} size="small" command={fix} />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}
