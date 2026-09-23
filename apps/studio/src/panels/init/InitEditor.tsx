import type { InitStepView } from "@lattice-studio/core";
import { plural } from "@lattice-studio/core";
import { useEffect, useRef } from "react";
import { commandRef, useCatalog, useDocument, type InspectorViewProps } from "@/contracts";
import { CommandButton } from "@/ui";
import { AuthorityTable } from "./AuthorityTable";
import { BundleOrder } from "./BundleOrder";
import styles from "./InitEditor.module.css";
import { firstMissing, planOf } from "./navigation";
import { StepCard } from "./StepCard";

const CONTROL = "input, [role='combobox'], [role='switch'], button, [tabindex]:not([tabindex='-1'])";

/**
 * Moves focus where `init.open` / `init.focusField` asked (contracts/stores.ts InspectorView "init"): an argument
 * path, a step path, "examples" (the first field still holding an example, INIT-05) or "authority".
 */
function focusTarget(root: HTMLElement | null, focus: string | undefined): void {
  if (!root || focus === undefined) return;
  let target: HTMLElement | null = null;
  if (focus === "authority") {
    target = root.querySelector<HTMLElement>("[data-init-section='authority'] h3");
  } else if (focus === "examples") {
    const row = root.querySelector("[data-state='example']")?.closest("[data-init-path]");
    target = row?.querySelector<HTMLElement>(CONTROL) ?? null;
  } else if (/^(steps\[\d+\]|bundle|auto)$/.test(focus)) {
    target = root.querySelector<HTMLElement>(`[data-init-step="${CSS.escape(focus)}"] h3`);
  } else {
    const row = root.querySelector(`[data-init-path="${CSS.escape(focus)}"]`);
    // Confirm address… opened on this field: the panel keeps focus (it's what the fix asked for).
    target = row?.querySelector<HTMLElement>("[data-confirm-panel]") ?? row?.querySelector<HTMLElement>(CONTROL) ?? null;
  }
  if (!target) return;
  target.focus();
  target.scrollIntoView({ block: "nearest" });
}

/** A step's key that follows it when it moves: its spec, and which occurrence of that spec it is. */
function stepKey(steps: readonly InitStepView[], i: number): string {
  const step = steps[i];
  if (!step) return String(i);
  const occurrence = steps.slice(0, i).filter((s) => s.spec === step.spec).length;
  return `${step.spec}|${occurrence}`;
}

/**
 * The Init plan view (Flow 7, IR L125): the bundle's form and fixed order, or the step list with ↑/↓ and Reorder
 * steps automatically, then the Authority table. Fill in goes to the first required field that's missing.
 * Registered as the inspector's "init" view; it loads in its own chunk (spec L822).
 */
export function InitEditor({ view }: InspectorViewProps<"init">) {
  const rootRef = useRef<HTMLElement>(null);
  const catalog = useCatalog();
  const recipe = useDocument((s) => s.project.recipe);
  const projectId = useDocument((s) => s.project.id);

  useEffect(() => {
    focusTarget(rootRef.current, view.focus);
  }, [view]);

  if (!catalog) {
    return (
      <section ref={rootRef} className={styles.root} aria-label="Init plan">
        <h2 className={styles.title}>Init plan</h2>
        <p className={styles.empty}>The catalog hasn't loaded yet.</p>
      </section>
    );
  }

  const plan = planOf(recipe, catalog);
  const movable = plan.kind === "steps" ? plan.steps.filter((s) => s.automatic === undefined).length : null;
  const missing = firstMissing(plan);
  const bundle = plan.kind === "bundle" ? plan.steps[0] : undefined;
  const summary = plan.kind === "bundle" ? "One bundle call" : plan.kind === "steps" ? plural(plan.steps.length, "step") : "No init";

  return (
    <section ref={rootRef} className={styles.root} aria-label="Init plan">
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Init plan</h2>
          <p className={styles.eyebrow}>{summary}</p>
        </div>
        <div className={styles.actions}>
          {missing ? (
            <CommandButton size="small" variant="primary" command={commandRef("init.focusField", { path: missing })}>
              Fill in
            </CommandButton>
          ) : null}
          {movable !== null && movable >= 2 ? <CommandButton size="small" command={commandRef("init.reorderAuto")} /> : null}
        </div>
      </header>
      {plan.kind === "none" ? <p className={styles.empty}>This recipe has no init: nothing runs when the diamond deploys.</p> : null}
      {plan.steps.length > 0 ? (
        <ol className={styles.steps} aria-label={plan.kind === "bundle" ? "Bundle" : "Steps in call order"}>
          {plan.steps.map((step, i) => (
            <StepCard key={stepKey(plan.steps, i)} step={step} movable={movable} projectId={projectId} />
          ))}
        </ol>
      ) : null}
      {bundle && plan.sequence ? <BundleOrder spec={bundle.spec} sequence={plan.sequence} /> : null}
      <AuthorityTable recipe={recipe} catalog={catalog} />
    </section>
  );
}
