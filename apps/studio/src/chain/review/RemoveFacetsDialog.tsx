import { plural } from "@lattice-studio/core";
import { useRef, useState } from "react";
import {
  closeDialog, env, runCommand, useAnalysis, useCatalog, useDocument, useSession, type DialogComponentProps,
} from "@/contracts";
import { chainName } from "@/chain/infra/chains";
import { Button, Checkbox, Dialog } from "@/ui";
import { removeTitle } from "./copy";
import { gasByFacet, magnitude, parseGas } from "./model";
import styles from "./RemoveFacetsDialog.module.css";
import { removalBlocker, requiredFacets } from "./remove-facets";
import { useChainService, useReadiness } from "./use-review";

const TITLE = "Remove facets";
const TICK_FIRST = "Tick the facets to remove";
const NO_ESTIMATE = "No gas estimate yet: sorted by selectors cut.";
const NO_LOCKS: ReadonlyMap<string, string> = new Map();

/** A check's message for plain text (a tooltip, a line): its code spans lose their backticks. */
function plain(text: string): string {
  return text.replaceAll("`", "");
}

/**
 * Remove facets (NET-06's fix, Flow 14 spec L595, IR L177): the plan's facets as a checklist sorted by their share
 * of the deploy's gas, with a running total against the chain's per-transaction cap. A facet the diamond can't do
 * without is locked with the blocker its removal would add. Remove {n} facets runs `facet.remove` (one undo step).
 */
export function RemoveFacetsDialog({ entry, top }: DialogComponentProps<"remove-facets">) {
  const catalog = useCatalog();
  const project = useDocument((s) => s.project);
  const plan = useAnalysis((a) => a.plan);
  const readOnly = useSession((s) => s.readOnly);
  const sessionChain = useSession((s) => s.chainId);
  const chainId = entry.props.chainId ?? sessionChain;
  const loaded = useChainService();
  const service = loaded.status === "ready" ? loaded.value : null;
  const readiness = useReadiness(service, chainId);
  const state = readiness.status === "ready" ? readiness.state : undefined;
  const estimate = parseGas(state?.gasEstimate);
  const cap = parseGas(state?.gasCap);
  const name = chainId === null ? null : (service?.chains().find((c) => c.id === chainId)?.name ?? chainName(chainId, env.e2e));

  const listRef = useRef<HTMLFieldSetElement>(null);
  const [ticked, setTicked] = useState<readonly string[]>([]);

  // Without an estimate, a share of the selector count sorts by selectors cut, ties in plan order.
  const selectors = plan.reduce((sum, e) => sum + e.selectors.length, 0);
  const rows = gasByFacet(plan, estimate ?? BigInt(selectors));
  const locked = catalog ? requiredFacets(project, catalog, plan.map((e) => e.facet)) : NO_LOCKS;
  const chosen = rows.filter((r) => ticked.includes(r.facet) && !locked.has(r.facet)).map((r) => r.facet);
  const combined = catalog && chosen.length > 0 ? removalBlocker(project, catalog, chosen) : null;

  const close = () => closeDialog("remove-facets");
  const reason =
    readOnly ??
    (catalog ? null : "The catalog hasn't loaded yet") ??
    (chosen.length === 0 ? TICK_FIRST : null) ??
    (combined === null ? null : plain(combined));

  const remove = async () => {
    if (reason !== null) return;
    const result = await runCommand({ id: "facet.remove", args: { facets: chosen } }, "button");
    if (result.ok) close();
  };

  const toggle = (facet: string, checked: boolean) =>
    setTicked((current) => (checked ? [...current.filter((f) => f !== facet), facet] : current.filter((f) => f !== facet)));

  let total: string;
  if (estimate === undefined) {
    total = NO_ESTIMATE;
  } else {
    const removed = rows.filter((r) => chosen.includes(r.facet)).reduce((sum, r) => sum + r.gas, 0n);
    const remaining = estimate > removed ? estimate - removed : 0n;
    const about = `About ${magnitude(remaining)} gas`;
    total =
      cap === undefined || name === null
        ? `${about}.`
        : `${about} of ${name}'s ${magnitude(cap)} per-transaction cap. ${remaining > cap ? "Still over the cap." : "Within the cap."}`;
  }

  const initialFocus = () =>
    listRef.current?.querySelector<HTMLElement>("[role='checkbox']:not([aria-disabled='true'])") ??
    listRef.current?.querySelector<HTMLElement>("[role='checkbox']") ??
    null;

  return (
    <Dialog
      open
      top={top}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={TITLE}
      initialFocus={initialFocus}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabledReason={reason} onClick={() => void remove()}>
            {removeTitle(chosen.length)}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <fieldset ref={listRef} className={styles.group} aria-label="Facets to remove">
          <ul className={styles.list}>
            {rows.map((row) => {
              const lock = locked.get(row.facet);
              const count = plural(row.selectors, "selector");
              return (
                <li key={row.facet} className={styles.row}>
                  <Checkbox
                    label={row.facet}
                    description={estimate === undefined ? count : `${count} · about ${magnitude(row.gas)} gas`}
                    checked={chosen.includes(row.facet)}
                    onCheckedChange={(checked) => toggle(row.facet, checked)}
                    disabledReason={lock === undefined ? null : plain(lock)}
                  />
                  {lock === undefined ? null : (
                    <p className={styles.lock} aria-hidden="true">
                      {plain(lock)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
        <output className={styles.total}>{total}</output>
      </div>
    </Dialog>
  );
}
