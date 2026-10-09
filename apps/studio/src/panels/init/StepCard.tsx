import type { InitStepView } from "@lattice-studio/core";
import { useId, type KeyboardEvent } from "react";
import { commandRef, runCommand } from "@/contracts";
import { cx } from "@/ui/shared/cx";
import { Icon } from "@/ui/icons/Icon";
import { FieldRow } from "./FieldRow";
import styles from "./InitEditor.module.css";
import { MoveStepButton } from "./MoveStepButton";
import { StepProblems } from "./StepProblems";
import { breakIdentifier } from "@/ui/text/Identifier";

/** Spec L468. */
export const AUTOMATIC_STEP_TITLE = "Register ERC-165 interfaces (automatic)";

function twoDigits(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isTyping(target: EventTarget): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

/**
 * One init call (spec L460-L468): its position, name and signature; for step inits ↑/↓ (and Alt+↑/↓, IR L97) and
 * its problems; locked for a bundle and the automatic ERC-165 step. Its form below: a struct that is the call's
 * only parameter shows as its fields (GovernedVaultInit's nine).
 */
export function StepCard({ step, movable, projectId }: {
  step: InitStepView;
  /** Editable steps in the recipe; null for a bundle, whose order is fixed. */
  movable: number | null;
  projectId: string;
}) {
  const headingId = useId();
  const title = step.automatic ? AUTOMATIC_STEP_TITLE : step.spec;
  const canMove = movable !== null && !step.locked;
  const only = step.fields.length === 1 ? step.fields[0] : undefined;
  const fields = only?.kind === "tuple" && only.components ? only.components : step.fields;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!canMove || !event.altKey || isTyping(event.target)) return;
    const to = event.key === "ArrowUp" ? step.index - 1 : event.key === "ArrowDown" ? step.index + 1 : null;
    if (to === null) return;
    event.preventDefault();
    void runCommand(commandRef("init.moveStep", { path: step.path, to }), "keys");
  };

  return (
    // Alt+↑/↓ (IR L97) comes up from the step's buttons and headings; the list item itself isn't a control.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <li
      className={cx(styles.step, step.locked && styles.stepLocked)}
      data-init-step={step.path}
      onKeyDown={onKeyDown}
    >
      <div className={styles.stepHead}>
        <span className={styles.index}>{twoDigits(step.index + 1)}</span>
        <div className={styles.stepName}>
          <h3 id={headingId} className={styles.stepTitle} tabIndex={-1}>
            {breakIdentifier(title)}
          </h3>
          <span className={styles.signature}>{breakIdentifier(`${step.contract}.${step.fn}`)}</span>
        </div>
        {step.locked ? <Icon name="lock" label="Locked" /> : null}
        {canMove ? (
          <div className={styles.stepTools}>
            <MoveStepButton
              path={step.path}
              spec={step.spec}
              to={step.index - 1}
              direction="up"
              edge={step.index === 0 ? `${step.spec} is already the first step` : null}
            />
            <MoveStepButton
              path={step.path}
              spec={step.spec}
              to={step.index + 1}
              direction="down"
              edge={step.index >= movable - 1 ? `${step.spec} is already the last step` : null}
            />
          </div>
        ) : null}
      </div>
      <StepProblems path={step.path} />
      {fields.length > 0 ? (
        <div className={styles.fields}>
          {fields.map((field) => (
            <FieldRow key={field.path} field={field} step={step} projectId={projectId} />
          ))}
        </div>
      ) : null}
    </li>
  );
}
