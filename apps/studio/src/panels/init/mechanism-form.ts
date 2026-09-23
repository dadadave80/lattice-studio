/**
 * Flow 17's Fill in step (spec L650), pure: what each choice asks for, the inputs `planMechanismChange` takes,
 * and what's wrong with what was typed, in the words of the init fields that will hold it.
 */
import type { Arg, Catalog, FieldModel, InitParam, Mechanism, MechanismInputs, MechanismOption, Recipe } from "@lattice-studio/core";
import { fieldModel, validateArg } from "@lattice-studio/core";
import { toSeconds, type DurationUnit } from "./duration";
import { argAt, displayText, refFromText } from "./field-value";

export type MechanismForm = {
  choice: Mechanism;
  /** Admin role's "Use a Safe…": keep AccessControlDiamondCut and hand `DEFAULT_ADMIN_ROLE` to the Safe. */
  keep: boolean;
  safe: string;
  threshold: string;
  delay: string;
  delayUnit: DurationUnit;
};

export type FormNeeds = { safe: boolean; threshold: boolean; delay: boolean };

/** Only what the choice needs (spec L650): a Safe address and minimum threshold, or a delay as well. */
export function needsOf(form: Pick<MechanismForm, "choice" | "keep">): FormNeeds {
  const safe = form.choice === "safe" || form.choice === "safe-delay";
  return { safe: safe || (form.choice === "admin" && form.keep), threshold: safe, delay: form.choice === "safe-delay" };
}

/** The init param a form input lands in, as a field: SafeDiamondCutInit's `safe` and `minThreshold`. */
function fieldFor(catalog: Catalog, spec: string, name: string): FieldModel | null {
  const init = catalog.inits.find((i) => i.name === spec);
  const param: InitParam | undefined = init?.params.find((p) => p.name === name);
  return init && param ? fieldModel(init, param, name) : null;
}

function specFor(choice: Mechanism): string {
  return choice === "safe-delay" ? "GovernedSafeDiamondCutInit" : "SafeDiamondCutInit";
}

export type FormResult = {
  inputs: MechanismInputs;
  errors: { safe?: string; threshold?: string; delay?: string };
};

/** The inputs for `planMechanismChange`, and each field's error. Empty fields have no error: the preview asks for them. */
export function formInputs(form: MechanismForm, catalog: Catalog): FormResult {
  const needs = needsOf(form);
  const inputs: MechanismInputs = {};
  const errors: FormResult["errors"] = {};
  if (form.choice === "admin" && form.keep) inputs.keepMechanism = true;
  const spec = specFor(form.choice);

  if (needs.safe && form.safe.trim() !== "") {
    const ref = refFromText(form.safe);
    if (ref) inputs.safe = { $ref: ref };
    else {
      const field = fieldFor(catalog, spec, "safe");
      const checked = field ? validateArg({ ...field, label: "Safe" }, form.safe.trim(), {}) : { ok: true as const, value: form.safe.trim() as Arg };
      if (checked.ok) inputs.safe = checked.value;
      else errors.safe = checked.error;
    }
  }
  if (needs.threshold && form.threshold.trim() !== "") {
    const field = fieldFor(catalog, spec, "minThreshold");
    const checked = field ? validateArg({ ...field, label: "Minimum threshold" }, form.threshold.trim(), {}) : { ok: true as const, value: form.threshold.trim() as Arg };
    if (checked.ok && typeof checked.value === "string") inputs.minThreshold = checked.value;
    else if (!checked.ok) errors.threshold = checked.error;
  }
  if (needs.delay && form.delay.trim() !== "") {
    const seconds = toSeconds(form.delay, form.delayUnit);
    if (seconds === null) errors.delay = `Delay is ${form.delay.trim()} ${form.delayUnit}; it must come to a whole number of seconds.`;
    else inputs.delay = seconds;
  }
  return { inputs, errors };
}

/** The option to preselect: the preset, else the current mechanism, else the first one that can be chosen. */
export function initialChoice(options: readonly MechanismOption[], current: Mechanism | null, preset: "safe" | "governance" | undefined): Mechanism {
  if (preset && options.some((o) => o.id === preset)) return preset;
  if (current) return current;
  return options.find((o) => o.enabled)?.id ?? "immutable";
}

/** What the recipe already says for the Safe, its threshold and delay, so the form starts from it. */
export function currentValues(recipe: Recipe): Pick<MechanismForm, "safe" | "threshold" | "delay"> {
  const steps = recipe.init.kind === "steps" ? recipe.init.steps : [];
  const step = steps.find((s) => s.spec === "SafeDiamondCutInit" || s.spec === "GovernedSafeDiamondCutInit");
  const read = (name: string) => (step ? displayText(argAt(step.args, [name])) : "");
  return { safe: read("safe"), threshold: read("minThreshold"), delay: read("minDelay") };
}

/** The primary button (spec L652): "Use SafeDiamondCut"; Immutable is Keep immutable (spec L649). */
export function applyLabel(option: MechanismOption | undefined): string {
  if (!option || option.id === "immutable" || !option.facet) return "Keep immutable";
  return `Use ${option.facet}`;
}

/** An option's line under its name: "SafeDiamondCut: only the pinned Safe cuts, at its threshold." */
export function optionDescription(option: MechanismOption): string {
  const summary = option.summary.replaceAll("`", "");
  const sentence = `${summary.charAt(0).toUpperCase()}${summary.slice(1)}${summary.endsWith(".") ? "" : "."}`;
  return option.facet ? `${option.facet}: ${summary}${summary.endsWith(".") ? "" : "."}` : sentence;
}
