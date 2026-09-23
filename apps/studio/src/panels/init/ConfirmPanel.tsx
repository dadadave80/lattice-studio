import type { Arg, FieldModel } from "@lattice-studio/core";
import { isNotImplemented } from "@lattice-studio/core";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { announce, chainService, doc, log, useOnline, useSession } from "@/contracts";
import { Button } from "@/ui";
import { displayText } from "./field-value";
import { literalAddress } from "./hooks";
import { closeConfirm, ensLabel } from "./init-ui-store";
import styles from "./InitEditor.module.css";
import { confirmAddressOp } from "./ops";

type EnsState = { kind: "name"; name: string } | { kind: "none" } | { kind: "note"; text: string } | { kind: "loading" };

/** Where focus goes when the panel closes: the field it belongs to. */
function focusField(path: string): void {
  const row = document.querySelector(`[data-init-path="${CSS.escape(path)}"]`);
  row?.querySelector<HTMLElement>("input, button, [tabindex]")?.focus();
}

/**
 * Confirm address… (LINK-01, spec L334, L504): the address in full, with any ENS name, before it counts. Confirm
 * address marks it confirmed as one undo step; Cancel or Esc leaves it From link.
 */
export function ConfirmPanel({ field, value, source, projectId }: { field: FieldModel; value: Arg | undefined; source: "link" | "file"; projectId: string }) {
  const panelRef = useRef<HTMLElement>(null);
  const headingId = useId();
  const readOnly = useSession((s) => s.readOnly);
  const chainId = useSession((s) => s.chainId);
  const online = useOnline();
  const address = literalAddress(value);
  const typedName = ensLabel(projectId, field.path, value);
  const [ens, setEns] = useState<EnsState>({ kind: "loading" });

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    const settle = (next: EnsState) => {
      if (live) setEns(next);
    };
    if (typedName) settle({ kind: "name", name: typedName });
    else if (!address) settle({ kind: "none" });
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
  }, [address, chainId, online, typedName]);

  const close = () => {
    closeConfirm();
    focusField(field.path);
  };
  const confirm = () => {
    const shown = address ?? displayText(value);
    const result = doc.apply(`Confirmed ${field.label}`, confirmAddressOp(field.path, field.label));
    if (!result.changed) {
      if (result.summary !== readOnly) log({ tag: "Note", text: result.summary });
      return;
    }
    const text = `Confirmed ${field.label}: ${shown}.`;
    log({ tag: "Init", text });
    announce(text);
    close();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  return (
    // Esc closes the panel from any of its controls (focus lands on the panel itself when it opens).
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section ref={panelRef} data-confirm-panel="" className={styles.confirm} aria-labelledby={headingId} tabIndex={-1} onKeyDown={onKeyDown}>
      <h4 id={headingId} className={styles.eyebrow}>
        Confirm address
      </h4>
      <p className={styles.fullAddress}>{address ?? displayText(value)}</p>
      <p className={styles.empty} aria-live="polite">
        {ens.kind === "name"
          ? `ENS name: ${ens.name}`
          : ens.kind === "none"
            ? "No ENS name."
            : ens.kind === "loading"
              ? "Looking up the ENS name…"
              : ens.text}
      </p>
      <p className={styles.empty}>{`${field.label} came from ${source === "link" ? "a shared link" : "an opened file"}. It counts once you confirm it.`}</p>
      <div className={styles.actions}>
        <Button variant="primary" size="small" disabledReason={readOnly} onClick={confirm}>
          Confirm address
        </Button>
        <Button size="small" onClick={close}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
