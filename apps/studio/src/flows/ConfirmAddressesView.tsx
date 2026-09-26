import type { Address, Analysis, EditResult, Project } from "@lattice-studio/core";
import { isAddress, isNotImplemented } from "@lattice-studio/core";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  announce, chainService, commandRef, doc, log, useAnalysis, useCatalog, useDocument, useOnline, useSession,
  type InspectorViewProps,
} from "@/contracts";
import { planField, planOf } from "@/panels/init/navigation";
import { Button } from "@/ui/buttons/Button";
import { CommandButton } from "@/ui/buttons/CommandButton";
import styles from "./flows.module.css";

/** Confirming waits for the ENS lookup, as S5d's Confirm address… does (spec L334, L504). */
export const LOOKING_UP = "Looking up the ENS name…";

export type LinkedAddress = { path: string; address: Address; message: string; source: "link" | "file" };

/** Every LINK-01 in the analysis: an authority address from a link or a file, not confirmed yet, in check order. */
export function linkedAddresses(analysis: Analysis): LinkedAddress[] {
  return analysis.problems.flatMap((p): LinkedAddress[] => {
    if (p.code !== "LINK-01") return [];
    const { path, address, source } = p.params;
    if (typeof path !== "string" || typeof address !== "string" || !isAddress(address)) return [];
    return [{ path, address, message: p.message, source: source === "file" ? "file" : "link" }];
  });
}

/** Marks the argument at `path` confirmed (LINK-01 clears): one undo step. */
function confirmOp(path: string, label: string): (project: Project) => EditResult {
  return (project) => {
    if (project.provenance[path] === "confirmed") return { project, changed: false, summary: `${label} is already confirmed.` };
    return { project: { ...project, provenance: { ...project.provenance, [path]: "confirmed" } }, changed: true, summary: `Confirmed ${label}` };
  };
}

type Ens = { kind: "loading" } | { kind: "name"; name: string } | { kind: "none" } | { kind: "note"; text: string };

function ensText(ens: Ens): string {
  if (ens.kind === "name") return `ENS name: ${ens.name}`;
  if (ens.kind === "none") return "No ENS name.";
  if (ens.kind === "loading") return LOOKING_UP;
  return ens.text;
}

function useEns(address: Address | undefined): Ens {
  const chainId = useSession((s) => s.chainId);
  const online = useOnline();
  const [ens, setEns] = useState<Ens>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    const settle = (next: Ens) => {
      if (live) setEns(next);
    };
    if (!address) settle({ kind: "none" });
    else if (!online) settle({ kind: "note", text: "ENS names can't be looked up offline." });
    else if (chainId === null) settle({ kind: "note", text: "Choose a chain to look up its ENS name." });
    else {
      settle({ kind: "loading" });
      chainService()
        .then((service) => service.reverseEns(address, chainId))
        .then((found) => settle(found.ok ? (found.value ? { kind: "name", name: found.value } : { kind: "none" }) : { kind: "note", text: found.error }))
        .catch((error: unknown) => settle({ kind: "note", text: isNotImplemented(error) ? error.message : String(error) }));
    }
    return () => {
      live = false;
    };
  }, [address, chainId, online]);
  return ens;
}

/**
 * Confirm addresses… (IR L203, spec L334, L504, L857): each From link address that receives authority, one at a
 * time and in full, with any ENS name, before it counts. Address poisoning forges the first and last characters,
 * so the whole address is shown. No board yet (PA L72-L84): built from S5d's Confirm address panel.
 */
export function ConfirmAddressesView({ view }: InspectorViewProps<"confirm-addresses">) {
  const analysis = useAnalysis();
  const catalog = useCatalog();
  const recipe = useDocument((s) => s.project.recipe);
  const readOnly = useSession((s) => s.readOnly);
  const rootRef = useRef<HTMLElement>(null);
  const headingId = useId();
  const items = useMemo(() => linkedAddresses(analysis), [analysis]);
  const [wanted, setWanted] = useState<string | undefined>(view.path);
  const at = Math.max(0, items.findIndex((i) => i.path === wanted));
  const item = items[at];
  const ens = useEns(item?.address);
  const label = useMemo(() => {
    if (!item) return "";
    return (catalog ? planField(planOf(recipe, catalog), item.path)?.label : undefined) ?? item.path;
  }, [catalog, recipe, item]);

  // Each address arrives with focus on the view, so a screen reader reads it from the top.
  const shown = item?.path ?? null;
  useEffect(() => {
    rootRef.current?.focus();
  }, [shown]);

  const next = () => {
    const following = items[(at + 1) % items.length];
    if (following) setWanted(following.path);
  };
  const confirm = () => {
    if (!item) return;
    const result = doc.apply(`Confirmed ${label}`, confirmOp(item.path, label));
    if (!result.changed) return; // The store said why (read-only), or it was already confirmed.
    const text = `Confirmed ${label}: ${item.address}.`;
    log({ tag: "Init", text });
    announce(text);
    const following = items[at + 1] ?? items.find((i) => i.path !== item.path);
    setWanted(following?.path);
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the view takes focus so each address is read from its heading
    <section ref={rootRef} tabIndex={-1} className={styles.view} aria-labelledby={headingId} data-confirm-addresses="">
      <h3 id={headingId} className={styles.title}>
        Confirm addresses
      </h3>
      {item ? (
        <>
          <p className={styles.eyebrow}>{`Address ${at + 1} of ${items.length}`}</p>
          <div className={styles.card}>
            <p className={styles.eyebrow}>{label}</p>
            <p className={styles.note}>{item.message}</p>
            <p className={styles.address}>{item.address}</p>
            <p className={styles.note} aria-live="polite">
              {ensText(ens)}
            </p>
            <div className={styles.actions}>
              <Button variant="primary" size="small" disabledReason={readOnly ?? (ens.kind === "loading" ? LOOKING_UP : null)} onClick={confirm}>
                Confirm address
              </Button>
              <CommandButton size="small" command={commandRef("init.focusField", { path: item.path })} />
              {items.length > 1 ? (
                <Button size="small" onClick={next}>
                  Next address
                </Button>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <p className={styles.note}>Every address that came from a link or a file is confirmed.</p>
      )}
    </section>
  );
}
