import type { AnalysisContext, AuthorityRow, Refs } from "@lattice-studio/core";
import { authorityTable, isAddress, planInit } from "@lattice-studio/core";
import { useEnsLabels } from "@/panels/init/init-ui-store";
import { AckTick } from "./AckTick";
import type { SectionStatus } from "./copy";
import { FixButton } from "./FixButton";
import { addressText, ensEntries, refIn, refText, type EnsEntry } from "./init-view";
import { problemStatus } from "./model";
import { ProblemList } from "./ProblemList";
import { problemsIn, useReview } from "./review-data";
import styles from "./review.module.css";
import { Section } from "./Section";

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Who holds it, in full (spec L568): "this diamond (0x…)", "deploying account (0x…)", an address, "anyone" or "none". */
function holderText(row: AuthorityRow, refs: Refs, ens: readonly EnsEntry[]): string {
  if (row.anyone) return "anyone";
  if (row.holder === null) return "none";
  const ref = refIn(row.holder);
  if (ref !== null) return refText(ref, row.resolved ?? refs[ref]);
  if (typeof row.holder === "string") return isAddress(row.holder) ? addressText(row.holder, ens, row.path ?? null) : row.holder;
  return JSON.stringify(row.holder);
}

/**
 * Authority after deploy (spec L568): role to holder with full addresses, and how each holder gets it. AUTH-01 needs
 * its box ticked (Keep single key), with Use a Safe… and Use governance… beside it; AUTH-02 and LINK-01 block.
 */
export function AuthoritySection() {
  const review = useReview();
  const { project, catalog, prediction, analysis, acked, chainId } = review;
  const problems = problemsIn(review, "authority");
  const ticks = problems.filter((p) => p.code === "AUTH-01");
  const shown = problems.filter((p) => p.code !== "AUTH-01");
  const refs: Refs = prediction.status === "ready" ? { self: prediction.address, deployer: prediction.from } : {};
  const labels = useEnsLabels();

  let rows: AuthorityRow[] | string;
  let ens: EnsEntry[] = [];
  try {
    const ctx: AnalysisContext = { known: [], unconfirmed: [], ...(prediction.status === "ready" ? { refs } : {}) };
    rows = authorityTable(project.recipe, catalog, ctx);
    ens = ensEntries(labels, project.id, chainId, planInit(project.recipe, catalog));
  } catch (error) {
    rows = reasonOf(error);
  }

  const status: SectionStatus = problemStatus(problems, acked);

  return (
    <Section id="authority" status={status}>
      {typeof rows === "string" ? (
        <p className={styles.muted}>{rows}</p>
      ) : rows.length === 0 ? (
        <p className={styles.muted}>No init argument grants a role.</p>
      ) : (
        <table className={styles.table} aria-label="Authority after deploy">
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">Holder</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.role}|${row.path ?? row.via}|${i}`} data-authority-row={row.role}>
                <th scope="row">{row.role}</th>
                <td>
                  <p className={styles.line}>{holderText(row, refs, ens)}</p>
                  <p className={styles.muted}>{row.via}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ProblemList problems={shown} />
      {ticks.map((problem) => {
        const fixes = problem.fixes.filter((fix) => fix.id !== "ack.set");
        return (
          <div key={problem.id} className={styles.problem} data-problem={problem.id}>
            <AckTick problem={problem} recipeHash={analysis.recipeHash} acked={acked.includes(problem.id)} />
            {fixes.length > 0 ? (
              <div className={styles.actions}>
                {fixes.map((fix) => (
                  <FixButton key={`${fix.id}|${JSON.stringify(fix.args ?? {})}`} command={fix} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </Section>
  );
}
