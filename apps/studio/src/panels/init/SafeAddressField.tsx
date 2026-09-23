import { Button } from "@/ui/buttons/Button";
import { TextField } from "@/ui/fields/TextField";
import { VisuallyHidden } from "@/ui/shared/VisuallyHidden";
import { REF_LABELS, refFromText, type Ref } from "./field-value";
import { resolvedRef, useRefAddresses } from "./hooks";
import styles from "./InitEditor.module.css";

/**
 * The Safe's address in Choose an upgrade mechanism (spec L650): "This diamond", "Deploying account" or a pasted
 * address, shown in full, with what a reference resolves to.
 */
export function SafeAddressField({ value, onChange, error, warning, disabledReason }: {
  value: string;
  onChange: (text: string) => void;
  error: string | null;
  /** A chain check that doesn't stop the change but will block deploy (INIT-01: "No Safe at this address on Sepolia yet."). */
  warning: string | null;
  disabledReason: string | null;
}) {
  const refs = useRefAddresses();
  const ref = refFromText(value);
  const resolved = ref ? resolvedRef(refs, ref) : null;
  const pick = (which: Ref) => onChange(REF_LABELS[which]);
  return (
    <div className={styles.field}>
      <TextField
        label="Safe address"
        value={value}
        onValueChange={onChange}
        mono
        autoComplete="off"
        placeholder="0x…"
        error={error ?? warning}
        disabledReason={disabledReason}
        description="The Safe that will hold the upgrade rights. It must already be deployed on the chain you deploy to."
      />
      {ref ? (
        <span className={styles.resolved}>{resolved ? `${REF_LABELS[ref]} (${resolved})` : `${REF_LABELS[ref]}: ${refs.reason ?? "resolved when the transaction is built"}`}</span>
      ) : null}
      <fieldset className={styles.picks}>
        <legend>
          <VisuallyHidden>Safe address quick picks</VisuallyHidden>
        </legend>
        <Button size="small" variant="quiet" aria-pressed={ref === "self"} disabledReason={disabledReason} onClick={() => pick("self")}>
          This diamond
        </Button>
        <Button size="small" variant="quiet" aria-pressed={ref === "deployer"} disabledReason={disabledReason} onClick={() => pick("deployer")}>
          Deploying account
        </Button>
      </fieldset>
    </div>
  );
}
