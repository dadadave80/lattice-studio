/** The problem docs index (`help.open` with no code, IR L64's App menu "Help"): every code, grouped by family. */
import type { ProblemCode } from "@lattice-studio/core";
import { useEffect, useRef } from "react";
import { commandRef, runCommand, useCommandState } from "@/contracts";
import { PROBLEM_DOC_ENTRIES, type DocFamily } from "./content";
import { hasUserInteracted } from "./navigation";
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

  // Coming back here from a code's page (or opening the index) moves focus to this heading, never
  // dropping it to <body> (spec L751-L761, WCAG 2.4.3) — but only once the user has interacted this
  // session: an index restored on load must not steal focus.
  useEffect(() => {
    if (hasUserInteracted()) headingRef.current?.focus();
  }, []);

  return (
    <div className={styles.index}>
      <h2 ref={headingRef} tabIndex={-1} className={styles.heading}>
        Problem docs
      </h2>
      <section className={styles.family} aria-label="Getting started">
        <h3 className={styles.familyHeading}>Getting started</h3>
        <p className={styles.intro}>Build one contract from smaller contracts called facets. The diamond is its shared address. A selector identifies a function, and routing chooses the facet that handles it.</p>
        <ol className={styles.steps}>
          <li>Choose a starter or add facets from the catalog.</li>
          <li>Open Edit setup to review the values used when the diamond deploys.</li>
          <li>Resolve blockers and review warnings in Problems.</li>
          <li>Save a copy for a portable backup, or export a Foundry script or Safe batch.</li>
        </ol>
        <p className={styles.intro}>Studio checks composition and deployment inputs. It does not prove the contract's economic behavior or external integrations.</p>
      </section>
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
