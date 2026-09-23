import type { Arg } from "@lattice-studio/core";
import { isNotImplemented } from "@lattice-studio/core";
import { useEffect, useState } from "react";
import { chainService, session, useOnline, useSession } from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { TextField } from "@/ui/fields/TextField";
import { VisuallyHidden } from "@/ui/shared/VisuallyHidden";
import type { FieldControlProps } from "./field-props";
import { displayText, isEnsName, parseFieldText, REF_LABELS, refOf, ZERO_ADDRESS, type Ref } from "./field-value";
import { literalAddress, probeCode, resolvedRef, useRefAddresses } from "./hooks";
import { dropLabelsNotOn, ensLabel, setEnsLabel, useEnsLabels } from "./init-ui-store";
import styles from "./InitEditor.module.css";
import { setArg, useDraft } from "./use-draft";

/** Offline or with no chain picked, an ENS name can't be resolved (spec L462). */
export const ENS_OFFLINE = "ENS names resolve only while online. Paste the address instead.";
export const ENS_NO_CHAIN = "Choose a chain to resolve ENS names.";

/** A resolution that finished after the chain changed resolved for the wrong chain (spec L462). */
export function ensChainChanged(name: string): string {
  return `The chain changed while ${name} was resolving. Enter it again to resolve it for this chain.`;
}

/**
 * An address (spec L462): checksummed, paste-friendly (spaces trimmed, any case accepted and stored checksummed),
 * with quick picks "This diamond" and "Deploying account", stored as references and shown with the address they
 * resolve to, and "Zero address" where the rule allows it. An ENS name resolves through the chain service when
 * online; the address is stored and the name kept as its label. Where the contract needs code there, the
 * address is read on the selected chain, so INIT-01's chain rule can say "No Safe at this address on Sepolia yet."
 */
export function AddressInput({ field, value, description, error, disabledReason, projectId }: FieldControlProps) {
  const refs = useRefAddresses();
  useEnsLabels();
  const online = useOnline();
  const chainId = useSession((s) => s.chainId);
  const [status, setStatus] = useState<string | null>(null);
  const ref = refOf(value);
  const label = ensLabel(projectId, field.path, value, chainId);

  // A chain switch drops names resolved for the old chain: they may point elsewhere on this one.
  useEffect(() => {
    dropLabelsNotOn(chainId);
  }, [chainId]);

  const store = async (next: Arg): Promise<string | null> => {
    const failed = await setArg(field.path, next);
    const address = literalAddress(next);
    if (failed === null && address && field.needsCode) void probeCode(address);
    return failed;
  };

  const resolveName = async (name: string): Promise<string | null> => {
    if (!online) return ENS_OFFLINE;
    if (chainId === null) return ENS_NO_CHAIN;
    setStatus(`Resolving ${name}…`);
    try {
      const service = await chainService();
      const resolved = await service.resolveEns(name, chainId);
      if (session.get().chainId !== chainId) return ensChainChanged(name);
      if (!resolved.ok) return resolved.error;
      if (resolved.value === null) return `${name} doesn't resolve to an address.`;
      const failed = await store(resolved.value);
      if (failed === null) setEnsLabel(projectId, field.path, { name, address: resolved.value, chainId });
      return failed;
    } catch (caught) {
      if (isNotImplemented(caught)) return caught.message;
      throw caught;
    } finally {
      setStatus(null);
    }
  };

  const draft = useDraft(displayText(value), async (text) => {
    const trimmed = text.trim();
    if (isEnsName(trimmed)) return resolveName(trimmed);
    const parsed = parseFieldText(field, trimmed);
    if (!parsed.ok) return parsed.error;
    setEnsLabel(projectId, field.path, null);
    return store(parsed.value);
  });

  const pick = (next: Arg) => {
    draft.revert();
    setEnsLabel(projectId, field.path, null);
    void store(next);
  };

  const refLine = (which: Ref) => {
    const address = resolvedRef(refs, which);
    return address ? `${REF_LABELS[which]} (${address})` : `${REF_LABELS[which]}: ${refs.reason ?? "resolved when the transaction is built"}`;
  };

  return (
    <div className={styles.field} onBlur={draft.onBlur}>
      <TextField
        label={field.label}
        value={draft.text}
        onValueChange={draft.change}
        onKeyDown={draft.onKeyDown}
        description={description}
        error={draft.error ?? (draft.editing ? null : error)}
        disabledReason={disabledReason}
        required={field.required}
        placeholder="0x… or name.eth"
        autoComplete="off"
        mono
      />
      {status ? <output className={styles.status}>{status}</output> : null}
      {ref && !draft.editing ? <span className={styles.resolved}>{refLine(ref)}</span> : null}
      {label && !draft.editing ? <span className={styles.resolved}>{`${label} (${String(value)})`}</span> : null}
      <fieldset className={styles.picks}>
        <legend>
          <VisuallyHidden>{`${field.label} quick picks`}</VisuallyHidden>
        </legend>
        <Button size="small" variant="quiet" aria-pressed={ref === "self"} disabledReason={disabledReason} onClick={() => pick({ $ref: "self" })}>
          This diamond
        </Button>
        <Button size="small" variant="quiet" aria-pressed={ref === "deployer"} disabledReason={disabledReason} onClick={() => pick({ $ref: "deployer" })}>
          Deploying account
        </Button>
        {field.allowZero ? (
          <Button size="small" variant="quiet" aria-pressed={value === ZERO_ADDRESS} disabledReason={disabledReason} onClick={() => pick(ZERO_ADDRESS)}>
            Zero address
          </Button>
        ) : null}
      </fieldset>
    </div>
  );
}
