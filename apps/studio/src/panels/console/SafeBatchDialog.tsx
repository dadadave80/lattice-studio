import type { Address } from "@lattice-studio/core";
import { isAddress, toChecksum } from "@lattice-studio/core";
import { useRef, useState } from "react";
import { closeDialog, useSession, type DialogComponentProps } from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { Select } from "@/ui/fields/Select";
import { TextField } from "@/ui/fields/TextField";
import { Dialog } from "@/ui/overlays/Dialog";
import { Banner } from "@/ui/status/Banner";
import { exportFailed, exportSafe } from "./actions";
import { studioChains } from "./chains";
import styles from "./SafeBatchDialog.module.css";

export const SAFE_BATCH_TITLE = "Safe batch";
export const SAFE_ADDRESS_LABEL = "Safe address";
export const NOT_AN_ADDRESS = "Enter the Safe's full address: 0x and 40 hex characters.";
export const DOWNLOAD_BATCH = "Download batch";

/**
 * Export → Safe batch… (IR L180, spec L517, L580): asks for the Safe's address and the chain, then downloads a
 * Transaction Builder batch built for that Safe and chain and records the deploy as Proposed. Initial focus is
 * the Safe address; the primary is Download batch.
 */
export function SafeBatchDialog({ entry, top }: DialogComponentProps<"safe-batch">) {
  const chains = studioChains();
  const selected = useSession((s) => s.chainId);
  const fallbackChain = chains.find((c) => c.id === selected)?.id ?? chains[0]?.id ?? 0;
  const [safe, setSafe] = useState<string>(entry.props.safe ?? "");
  const [chainId, setChainId] = useState<number>(entry.props.chainId ?? fallbackChain);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const addressRef = useRef<HTMLInputElement>(null);

  const close = () => closeDialog("safe-batch");

  const submit = async () => {
    const typed = safe.trim();
    if (!isAddress(typed)) {
      setAddressError(NOT_AN_ADDRESS);
      addressRef.current?.focus();
      return;
    }
    setAddressError(null);
    setBusy(true);
    const done = await exportSafe(toChecksum(typed as Address), chainId);
    setBusy(false);
    if (done.ok) {
      close();
      return;
    }
    setFailure(done.error);
    exportFailed(done.error);
  };

  return (
    <Dialog
      open
      top={top}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={SAFE_BATCH_TITLE}
      description="A Transaction Builder batch the Safe imports to deploy the diamond itself. Studio records it as Proposed."
      initialFocus={addressRef}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" icon="download" disabledReason={busy ? "Building the batch…" : null} onClick={() => void submit()}>
            {DOWNLOAD_BATCH}
          </Button>
        </>
      }
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextField
          label={SAFE_ADDRESS_LABEL}
          value={safe}
          onValueChange={(next) => {
            setSafe(next);
            setAddressError(null);
            setFailure(null);
          }}
          mono
          required
          placeholder="0x…"
          error={addressError}
          inputRef={addressRef}
          description="The salt and the diamond's references are built for this Safe."
        />
        <Select
          label="Chain"
          options={chains.map((c) => ({ value: String(c.id), label: c.name }))}
          value={String(chainId)}
          onValueChange={(next) => {
            setChainId(Number(next));
            setFailure(null);
          }}
        />
        {failure ? <Banner tone="error" text={failure} /> : null}
      </form>
    </Dialog>
  );
}
