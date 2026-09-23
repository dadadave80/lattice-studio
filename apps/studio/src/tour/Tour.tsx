/**
 * The tour's coach mark (spec L400, Flow 1; IR L188): five steps that never block input. It's explicitly
 * not a dialog — no focus trap, no backdrop, no autofocus — so it renders a small floating card near its
 * step's `[data-tour]` target, or centered when that target isn't in the DOM yet. Esc or "End tour" leaves
 * it at any step through the `tour.end` command (S10's `settings/commands.ts`), which logs the outcome;
 * reaching the end through "Done" logs its own line here, since no command runs on that path.
 */
import { type CSSProperties, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { announce, log, pushEscape, runCommand } from "@/contracts";
import { Button } from "@/ui";
import styles from "./Tour.module.css";
import { TOUR_STEPS } from "./steps";
import { endTour, setTourStep, useTourState } from "./tour-state";

const MARGIN = 12;

function clampStep(step: number): number {
  return Math.min(Math.max(step, 0), TOUR_STEPS.length - 1);
}

export function Tour() {
  const running = useTourState((s) => s.running);
  const rawStep = useTourState((s) => s.step);
  const index = clampStep(rawStep);
  const step = TOUR_STEPS[index]!;
  const headingId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    if (!running) return;
    function place() {
      const card = cardRef.current;
      if (!card) return;
      const target = document.querySelector(`[data-tour="${step.id}"]`);
      const cardRect = card.getBoundingClientRect();
      if (!target) {
        setStyle({ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)" });
        return;
      }
      const targetRect = target.getBoundingClientRect();
      let top = targetRect.bottom + MARGIN;
      if (top + cardRect.height > window.innerHeight - MARGIN) top = targetRect.top - cardRect.height - MARGIN;
      top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, window.innerHeight - cardRect.height - MARGIN));
      let left = Math.min(
        Math.max(targetRect.left, MARGIN),
        Math.max(MARGIN, window.innerWidth - cardRect.width - MARGIN),
      );
      setStyle({ position: "fixed", top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [running, step.id]);

  useEffect(() => {
    if (!running) return;
    return pushEscape(() => {
      void runCommand({ id: "tour.end" }, "keys");
      return true;
    });
  }, [running]);

  useEffect(() => {
    if (!running) return;
    announce(`${step.title}. ${step.text}`);
  }, [running, step.title, step.text]);

  if (!running) return null;

  const isFirst = index === 0;
  const isLast = index === TOUR_STEPS.length - 1;

  function handleNext() {
    if (isLast) {
      endTour();
      log({ tag: "Note", text: "Finished the tour." });
    } else {
      setTourStep(index + 1);
    }
  }

  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a coach mark, not a form group; no semantic tag fits
    <div ref={cardRef} className={styles.card} style={style} role="group" aria-labelledby={headingId}>
      <p className={styles.counter}>
        Step {index + 1} of {TOUR_STEPS.length}
      </p>
      <h2 id={headingId} className={styles.title}>
        {step.title}
      </h2>
      <p className={styles.text}>{step.text}</p>
      <div className={styles.actions}>
        <div className={styles.steps}>
          {!isFirst && (
            <Button size="small" onClick={() => setTourStep(index - 1)}>
              Back
            </Button>
          )}
          <Button size="small" onClick={handleNext}>
            {isLast ? "Done" : "Next"}
          </Button>
        </div>
        <Button
          size="small"
          variant="quiet"
          onClick={() => void runCommand({ id: "tour.end" }, "button")}
        >
          End tour
        </Button>
      </div>
    </div>
  );
}
