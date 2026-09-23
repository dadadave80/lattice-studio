import type { Problem, Severity } from "@lattice-studio/core";
import { openProblemDoc } from "@/contracts";
import { Button, CommandButton, cx, VisuallyHidden } from "@/ui";
import { Section } from "../../shared/Section";
import sheet from "../../shared/sheet.module.css";
import { CodeText } from "./CodeText";
import styles from "./facet.module.css";

const SEVERITY: Record<Severity, string> = { blocker: "Blocker", warning: "Warning", info: "Info" };

/** Problems anchored to this facet (spec L382: the problem shows in the Facet view): message, fixes, Learn more. */
export function FacetProblems({ problems }: { problems: readonly Problem[] }) {
  if (problems.length === 0) return null;
  return (
    <Section label="Problems" aside={`${problems.length}`}>
      <ul className={sheet.list}>
        {problems.map((problem) => (
          <li key={problem.id} className={cx(sheet.item, styles.problem)} data-problem={problem.id}>
            <span className={cx(styles.severity, problem.severity === "blocker" && styles.blocker)}>
              {SEVERITY[problem.severity]} · {problem.code}
            </span>
            <p className={sheet.text}>
              <CodeText text={problem.message} />
            </p>
            <div className={sheet.actions}>
              {problem.fixes.map((fix, index) => (
                <CommandButton key={`${fix.id}-${index}`} command={fix} size="small" />
              ))}
              <Button size="small" variant="quiet" onClick={() => openProblemDoc(problem.code)}>
                Learn more<VisuallyHidden> about {problem.code}</VisuallyHidden>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
