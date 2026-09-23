import type { Catalog } from "@lattice-studio/core";
import { commandRef, runCommand } from "@/contracts";
import { Button, CommandButton } from "@/ui";
import { Section } from "../../shared/Section";
import { SpecRow } from "../../shared/SpecRow";
import { SpecRows } from "../../shared/SpecRows";
import sheet from "../../shared/sheet.module.css";
import type { InitPlacement } from "./facet-model";

export type InitSectionProps = {
  /** The facet's own init spec, if it has one. */
  spec: string | undefined;
  placement: InitPlacement;
  catalog: Catalog;
  readOnly: boolean;
};

function position(placement: InitPlacement): string {
  switch (placement.kind) {
    case "step":
      return `Step ${placement.index + 1} of ${placement.count}`;
    case "bundle":
      return `In ${placement.spec} (bundle), whose order is fixed`;
    case "absent":
      return "Not in the init plan";
    case "none":
      return "none";
  }
}

/**
 * Init (IR L118, Flow 7): its init spec and its position in the plan. A step moves up or down (the keyboard
 * alternative to dragging a badge; locked steps and bundles don't move) and opens in the plan with Fill in.
 */
export function InitSection({ spec, placement, catalog, readOnly }: InitSectionProps) {
  const shown = placement.kind === "bundle" ? placement.spec : spec;
  const initSpec = shown === undefined ? undefined : catalog.inits.find((init) => init.name === shown);
  const step = !readOnly && placement.kind === "step" && !placement.locked ? placement : null;
  const move = (path: string, to: number) => {
    void runCommand(commandRef("init.moveStep", { path, to }), "button");
  };
  return (
    <Section label="Init">
      <SpecRows>
        <SpecRow label="Spec">{initSpec ? `${initSpec.name} · ${initSpec.fn}` : (shown ?? "none")}</SpecRow>
        <SpecRow label="Position">{position(placement)}</SpecRow>
      </SpecRows>
      {readOnly || placement.kind === "none" || placement.kind === "absent" ? null : (
        <div className={sheet.actions}>
          {step ? (
            <>
              <Button
                size="small"
                disabledReason={step.recipeIndex === 0 ? "It's already the first step." : null}
                onClick={() => move(step.path, step.recipeIndex - 1)}
              >
                Move step up
              </Button>
              <Button
                size="small"
                disabledReason={step.recipeIndex >= step.recipeSteps - 1 ? "It's already the last step." : null}
                onClick={() => move(step.path, step.recipeIndex + 1)}
              >
                Move step down
              </Button>
            </>
          ) : null}
          <CommandButton command={commandRef("init.open", { focus: placement.path })} size="small">
            Fill in
          </CommandButton>
        </div>
      )}
    </Section>
  );
}
