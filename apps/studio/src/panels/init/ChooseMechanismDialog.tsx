import type { Catalog, Mechanism, MechanismChange, MechanismOptions, Recipe, Result } from "@lattice-studio/core";
import { formatAddress, isNotImplemented, lines, mechanismOptions, planMechanismChange, validateArg, fieldModel } from "@lattice-studio/core";
import { useEffect, useId, useRef, useState } from "react";
import {
  announce, closeDialog, doc, layoutMetrics, log, useCatalog, useDocument, useSession, type DialogComponentProps,
} from "@/contracts";
import { Button, Checkbox, Dialog, NumberField, RadioGroup } from "@/ui";
import styles from "./ChooseMechanismDialog.module.css";
import { CodeText } from "./CodeText";
import { bestUnit, DURATION_UNITS, durationEcho, toSeconds, type DurationUnit } from "./duration";
import { literalAddress, probeCode } from "./hooks";
import {
  applyLabel, currentValues, formInputs, initialChoice, needsOf, optionDescription, type MechanismForm,
} from "./mechanism-form";
import { applyMechanismOp } from "./ops";
import { SafeAddressField } from "./SafeAddressField";

const UNIT_OPTIONS = DURATION_UNITS.map((u) => ({ value: u.value, label: u.label }));
const TITLE = "Choose an upgrade mechanism";

function optionsOf(recipe: Recipe, catalog: Catalog): Result<MechanismOptions, string> {
  try {
    return { ok: true, value: mechanismOptions(recipe, catalog) };
  } catch (error) {
    if (isNotImplemented(error)) return { ok: false, error: error.message };
    throw error;
  }
}

function previewOf(recipe: Recipe, catalog: Catalog, form: MechanismForm, inputs: Parameters<typeof planMechanismChange>[3]): Result<MechanismChange, string> {
  try {
    return planMechanismChange(recipe, catalog, form.choice, inputs);
  } catch (error) {
    if (isNotImplemented(error)) return { ok: false, error: error.message };
    throw error;
  }
}

function startForm(recipe: Recipe, options: MechanismOptions | null, preset: "safe" | "governance" | undefined): MechanismForm {
  const values = currentValues(recipe);
  const delay = values.delay === "" ? { amount: "", unit: "days" as DurationUnit } : bestUnit(values.delay);
  return {
    choice: options ? initialChoice(options.options, options.current, preset) : "immutable",
    keep: false,
    safe: values.safe,
    threshold: values.threshold,
    delay: delay.amount,
    delayUnit: delay.unit,
  };
}

/** The Safe's code on the selected chain, for INIT-01's "No Safe at this address on Sepolia yet." (spec L650). */
function useSafeWarning(catalog: Catalog | null, address: string | null, choice: Mechanism): string | null {
  const [warning, setWarning] = useState<{ address: string; text: string | null } | null>(null);
  useEffect(() => {
    if (!catalog || !address) return;
    let live = true;
    const spec = catalog.inits.find((i) => i.name === (choice === "safe-delay" ? "GovernedSafeDiamondCutInit" : "SafeDiamondCutInit"));
    const param = spec?.params.find((p) => p.name === "safe");
    void probeCode(address as `0x${string}`).then((chain) => {
      if (!live || !chain || !spec || !param) return;
      const checked = validateArg(fieldModel(spec, param, "safe"), address, { chain });
      setWarning({ address, text: checked.ok ? null : checked.error });
    });
    return () => {
      live = false;
    };
  }, [catalog, address, choice]);
  return warning && warning.address === address ? warning.text : null;
}

/**
 * Choose an upgrade mechanism (Flow 17, spec L640-L652; IR L175): five options, each saying who can upgrade and how
 * fast; only the inputs the choice needs; the preview from C4c's `planMechanismChange`; Use {mechanism} applies it
 * as one undo step and says "Upgrade mechanism: SafeDiamondCut · Safe 0x71C7…976F." Initial focus is the current
 * option. When a bundle sets up its own mechanism, the dialog says so and offers no other choice.
 */
export function ChooseMechanismDialog({ entry, top }: DialogComponentProps<"choose-mechanism">) {
  const catalog = useCatalog();
  const recipe = useDocument((s) => s.project.recipe);
  const readOnly = useSession((s) => s.readOnly);
  const bodyRef = useRef<HTMLDivElement>(null);
  const previewId = useId();
  const loaded = catalog ? optionsOf(recipe, catalog) : null;
  const options = loaded?.ok ? loaded.value : null;
  const [form, setForm] = useState<MechanismForm>(() => startForm(recipe, options, entry.props.preset));
  const update = (patch: Partial<MechanismForm>) => setForm((f) => ({ ...f, ...patch }));

  const close = () => closeDialog("choose-mechanism");
  const option = options?.options.find((o) => o.id === form.choice);
  const needs = needsOf(form);
  const { inputs, errors } = catalog ? formInputs(form, catalog) : { inputs: {}, errors: {} };
  const preview = catalog && options && !options.bundle ? previewOf(recipe, catalog, form, inputs) : null;
  const safeAddress = needs.safe ? literalAddress(inputs.safe) : null;
  const safeWarning = useSafeWarning(catalog, safeAddress, form.choice);
  const canKeep = options?.current === "admin" && form.choice === "admin";
  const label = applyLabel(option);
  const inputError = errors.safe ?? errors.threshold ?? errors.delay ?? null;

  const reason =
    readOnly ??
    (loaded && !loaded.ok ? loaded.error : null) ??
    (options?.bundle ? `${options.bundle} sets up the upgrade mechanism itself, so the bundle decides it.` : null) ??
    (option && !option.enabled ? (option.reason ?? `${option.label} isn't available.`) : null) ??
    inputError ??
    (preview && !preview.ok ? preview.error : null);

  const apply = () => {
    if (!catalog || !preview?.ok || reason !== null) return;
    const result = doc.apply(label, applyMechanismOp(preview.value.next, catalog, layoutMetrics, label));
    if (!result.changed) return;
    const line = lines.mechanismChanged({
      facet: option?.facet ?? "Immutable",
      ...(safeAddress ? { holder: formatAddress(safeAddress) } : {}),
    });
    log(line);
    announce(line.text);
    close();
  };

  const initialFocus = () =>
    bodyRef.current?.querySelector<HTMLElement>("[role='radio'][aria-checked='true']") ??
    bodyRef.current?.querySelector<HTMLElement>("[role='radio']") ??
    null;

  const delaySeconds = toSeconds(form.delay, form.delayUnit);

  return (
    <Dialog
      open
      top={top}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={TITLE}
      initialFocus={initialFocus}
      {...(options?.bundle ? { description: `${options.bundle} sets up the upgrade mechanism itself, so the bundle decides it.` } : {})}
      footer={
        options?.bundle ? (
          <Button onClick={close}>Close</Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" disabledReason={reason} onClick={apply}>
              {label}
            </Button>
          </>
        )
      }
    >
      <div ref={bodyRef} className={styles.body}>
        {!catalog ? <p className={styles.note}>The catalog hasn't loaded yet.</p> : null}
        {loaded && !loaded.ok ? <p className={styles.note}>{loaded.error}</p> : null}
        {options ? (
          <RadioGroup
            label="Upgrade mechanism"
            value={form.choice}
            onValueChange={(next) => update({ choice: next as Mechanism })}
            options={options.options.map((o) => ({
              value: o.id,
              label: o.label,
              description: optionDescription(o),
              ...(o.enabled ? {} : { disabledReason: o.reason ?? `${o.label} isn't available.` }),
            }))}
          />
        ) : null}

        {canKeep && !options?.bundle ? (
          <Checkbox
            label="Use a Safe: keep AccessControlDiamondCut and hand DEFAULT_ADMIN_ROLE to a Safe"
            checked={form.keep}
            onCheckedChange={(keep) => update({ keep })}
            disabledReason={readOnly}
          />
        ) : null}

        {!options?.bundle && (needs.safe || needs.threshold || needs.delay) ? (
          <div className={styles.inputs}>
            {needs.safe ? (
              <SafeAddressField
                value={form.safe}
                onChange={(safe) => update({ safe })}
                error={errors.safe ?? null}
                warning={safeWarning}
                disabledReason={readOnly}
              />
            ) : null}
            {needs.threshold ? (
              <NumberField
                label="Minimum threshold"
                value={form.threshold}
                onValueChange={(threshold) => update({ threshold })}
                min="1"
                description="The fewest Safe signatures a cut needs. The init reads the Safe's own threshold and checks it's at least this."
                error={errors.threshold ?? null}
                disabledReason={readOnly}
              />
            ) : null}
            {needs.delay ? (
              <NumberField<DurationUnit>
                label="Delay"
                value={form.delay}
                onValueChange={(delay) => update({ delay })}
                units={UNIT_OPTIONS}
                unit={form.delayUnit}
                onUnitChange={(delayUnit) => update({ delayUnit })}
                description={
                  <>
                    How long a scheduled cut waits before it can run.
                    {durationEcho(delaySeconds, form.delayUnit) ? ` ${durationEcho(delaySeconds, form.delayUnit) ?? ""}` : null}
                  </>
                }
                error={errors.delay ?? null}
                disabledReason={readOnly}
              />
            ) : null}
          </div>
        ) : null}

        {preview ? (
          <section aria-labelledby={previewId} className={styles.preview}>
            <h3 id={previewId} className={styles.eyebrow}>
              What changes
            </h3>
            {preview.ok ? (
              <ul className={styles.changes}>
                {preview.value.changes.map((change) => (
                  <li key={`${change.kind}|${change.text}`} data-kind={change.kind}>
                    <CodeText text={change.text} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.note}>{inputError ?? preview.error}</p>
            )}
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}
