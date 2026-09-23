import type { Arg, FieldModel, InitStepView } from "@lattice-studio/core";
import { commandRef, useDocument, useSession } from "@/contracts";
import { CommandButton } from "@/ui/buttons/CommandButton";
import { CodeText } from "./CodeText";
import { ConfirmPanel } from "./ConfirmPanel";
import { FieldControl } from "./FieldControl";
import { argAt, fieldKeys } from "./field-value";
import { usePathProblems } from "./hooks";
import { useConfirming } from "./init-ui-store";
import styles from "./InitEditor.module.css";
import { ValueDot, type DotState } from "./ValueDot";

function isEmpty(value: Arg | undefined): boolean {
  return value === undefined || value === "";
}

/**
 * One init field (spec L461-L466): its control, the dot ("Example" or "Set by you") and help from NatSpec or the
 * overlay, its problems inline, and From link with Confirm address… until the address is confirmed (LINK-01).
 * A tuple shows as a group of its components.
 */
export function FieldRow({ field, step, projectId }: { field: FieldModel; step: InitStepView; projectId: string }) {
  const problems = usePathProblems(field.path);
  const readOnly = useSession((s) => s.readOnly);
  const source = useDocument((s) => s.project.provenance[field.path]);
  const confirming = useConfirming(projectId) === field.path;

  if (field.kind === "tuple" && field.components) {
    return (
      <fieldset className={styles.group} data-init-path={field.path}>
        <legend className={styles.legend}>{field.label}</legend>
        {field.components.map((component) => (
          <FieldRow key={component.path} field={component} step={step} projectId={projectId} />
        ))}
      </fieldset>
    );
  }

  const value = argAt(step.args, fieldKeys(field.path));
  const example = step.examples.includes(field.path);
  const dot: DotState | null = example ? "example" : isEmpty(value) ? null : "set";
  const link = problems.find((p) => p.code === "LINK-01");
  const error = problems.filter((p) => p.code !== "LINK-01").map((p) => p.message).join(" ") || null;
  const exampleSource = example && field.exampleSource ? (field.exampleSource === "studio" ? "Studio" : field.exampleSource) : undefined;
  const description = (
    <>
      {dot ? <ValueDot state={dot} source={exampleSource} /> : null}
      <span className={styles.help}>
        <CodeText text={field.doc} />
      </span>
    </>
  );
  // LINK-01's scope (spec L334): addresses that receive authority. Both sources read "From link" (spec L466).
  const fromLink = field.kind === "address" && field.authority && (source === "link" || source === "file") ? source : null;

  return (
    <div className={styles.field} data-init-path={field.path}>
      <FieldControl field={field} value={value} description={description} error={error} disabledReason={readOnly} projectId={projectId} />
      {fromLink ? (
        <div className={styles.origin}>
          <span className={styles.originMark}>From link</span>
          {link ? (
            <span>
              <CodeText text={link.message} />
            </span>
          ) : null}
          <CommandButton size="small" command={commandRef("init.confirmAddress", { path: field.path })} />
        </div>
      ) : null}
      {confirming && fromLink ? <ConfirmPanel field={field} value={value} source={fromLink} projectId={projectId} /> : null}
    </div>
  );
}
