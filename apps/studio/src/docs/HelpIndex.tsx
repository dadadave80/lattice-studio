/** The problem docs index (`help.open` with no code, IR L64's App menu "Help"): every code, grouped by family. */
import type { ProblemCode } from "@lattice-studio/core";
import { useEffect, useRef } from "react";
import { commandRef, runCommand, useCommandState } from "@/contracts";
import { PROBLEM_DOC_ENTRIES, type DocFamily } from "./content";
import styles from "./HelpIndex.module.css";

const FAMILIES: readonly DocFamily[] = [
  "Selectors and seams",
  "Diamond core, dependencies and storage",
  "Init, authority and links",
  "Chain readiness",
];

function DocLink({ code, title }: { code: ProblemCode; title: string }) {
  const ref = commandRef("help.open", { code });
  const state = useCommandState(ref, "button");
  return (
    <li>
      <button
        type="button"
        className={styles.link}
        aria-disabled={state.ok ? undefined : true}
        title={state.ok ? undefined : state.reason}
        onClick={() => {
          if (state.ok) void runCommand(ref, "button");
        }}
      >
        <span className={styles.code}>{code}</span>
        <span className={styles.linkTitle}>{title}</span>
      </button>
    </li>
  );
}

export function HelpIndex() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Coming back here from a code's page (or opening the index for the first time in the inspector) moves
  // focus to this heading, never dropping it to <body> (spec L751-L761, WCAG 2.4.3).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className={styles.index}>
      <h2 ref={headingRef} tabIndex={-1} className={styles.heading}>
        Problem docs
      </h2>
      <p className={styles.intro}>
        Every problem code the composer can raise: what it means, why Lattice or Studio enforces it, and how to fix it. Available offline,
        precached with the app.
      </p>
      {FAMILIES.map((family) => (
        <section key={family} aria-label={family} className={styles.family}>
          <h3 className={styles.familyHeading}>{family}</h3>
          <ul className={styles.list}>
            {PROBLEM_DOC_ENTRIES.filter((entry) => entry.family === family).map((entry) => (
              <DocLink key={entry.code} code={entry.code} title={entry.title} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
