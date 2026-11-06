import { useEffect, useSyncExternalStore } from "react";
import { commandRef } from "@/contracts";
import { Button, CommandButton, TextField, copyText } from "@/ui";
import sheet from "@/panels/inspector/shared/sheet.module.css";
import type { CallContext, CallController, PreparedCall } from "./calls";
import { getCallController } from "./call-runtime";
import type { CallOutput } from "./abi";
import styles from "./CallForm.module.css";

function Outputs({ values }: { values: readonly CallOutput[] }) {
  return values.length === 0 ? <p className={sheet.text}>No return values.</p> : <dl className={styles.outputs}>{values.map((value, index) => <div key={index}>
    <dt className={sheet.muted}>{`${value.name} (${value.type})`}</dt>
    <dd className={styles.output}>{typeof value.value === "string" ? value.value : JSON.stringify(value.value, null, 2)}</dd>
  </div>)}</dl>;
}

export type CallFormProps = {
  context: CallContext;
  controller?: CallController;
  onReview?(prepared: PreparedCall): void | Promise<void>;
  onEdit?(): void;
};

/** Typed calls have their own drafts, validation and result cache; they never edit init arguments. */
export function CallForm({ context, controller = getCallController(), onReview, onEdit }: CallFormProps) {
  const state = useSyncExternalStore(controller.subscribe, () => controller.get(context));
  const key = `${context.chainId}:${context.address}:${context.fn.signature}:${context.identity}`;
  useEffect(() => () => { controller.cancel(context); }, [controller, key, context]);
  const busy = state.phase === "resolving" || state.phase === "calling";
  const patch = (change: Parameters<CallController["patch"]>[1]) => { controller.patch(context, change); onEdit?.(); };
  const run = async () => {
    if (context.fn.readOnly) await controller.run(context);
    else {
      const prepared = await controller.prepare(context);
      if (prepared) await onReview?.(prepared);
    }
  };
  return <div className={styles.form}>
    {context.fn.abi.inputs.map((input, index) => <TextField
      key={index} label={`${input.name || `Argument ${index + 1}`} (${input.type})`}
      value={state.draft.args[index] ?? ""} mono error={state.fieldErrors[index]}
      description={input.type.includes("[") || input.type === "tuple" ? "Enter JSON. Quote large integers; nested addresses must be hexadecimal addresses." : input.type === "address" ? "Enter a hexadecimal address or ENS name on the inspected chain." : input.type === "bool" ? "Enter true or false." : /^u?int/.test(input.type) ? "Enter an integer in base 10, without decimals or exponent notation." : undefined}
      onValueChange={(text) => { const args = [...state.draft.args]; args[index] = text; patch({ args }); }}
    />)}
    {context.fn.readOnly ? <TextField label="Caller (optional)" value={state.draft.caller} error={state.callerError} mono
      description="Leave empty to use the RPC's default caller. No wallet is required."
      onValueChange={(caller) => patch({ caller })} /> : null}
    {context.fn.abi.stateMutability === "payable" ? <TextField label="Value (wei)" value={state.draft.value} error={state.valueError} mono inputMode="numeric"
      description="Enter the exact integer amount in wei." onValueChange={(value) => patch({ value })} /> : null}
    <p className={sheet.muted}>{`Observed block ${context.block}. Refresh inspection to read a newer block.`}</p>
    <div className={sheet.actions}>
      <Button variant="primary" disabledReason={busy ? state.phase === "resolving" ? "Resolving call fields…" : "Calling the diamond…" : !context.fn.readOnly && !onReview ? "Transaction review isn't available." : null} onClick={() => void run()}>{context.fn.readOnly ? "Call" : "Review transaction"}</Button>
      <CommandButton size="small" command={commandRef("inspect.refresh", { chainId: context.chainId, address: context.address })}>Refresh inspection</CommandButton>
      {busy ? <Button size="small" onClick={() => controller.cancel(context)}>Cancel call</Button> : null}
    </div>
    {busy ? <output className={sheet.text}>{state.phase === "resolving" ? "Resolving call fields…" : "Calling the diamond…"}</output> : null}
    {state.message ? <output className={sheet.text}>{state.message}</output> : null}
    {state.result ? <div aria-label="Call result" className={styles.result}>
      <p className={sheet.muted}>{`Result at block ${state.result.block}`}</p>
      <Outputs values={state.result.outputs} />
      <Button size="small" onClick={() => void copyText(JSON.stringify(state.result!.outputs, null, 2), { label: "call result" })}>Copy result</Button>
    </div> : null}
    {state.revert ? <div aria-label="Call revert" className={styles.result}>
      <p className={sheet.strong}>{state.revert.errorName ?? "Unknown revert"}</p>
      <Outputs values={state.revert.args} />
    </div> : null}
    {state.raw ?? state.result?.raw ? <details><summary>Raw return data</summary><pre className={styles.raw}>{state.raw ?? state.result?.raw}</pre></details> : null}
  </div>;
}
