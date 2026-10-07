import type { Facet } from "@lattice-studio/core";
import { commandRef, useDocument } from "@/contracts";
import { CommandButton, cx } from "@/ui";
import { Section } from "../../shared/Section";
import sheet from "../../shared/sheet.module.css";
import { requirementStatus } from "./facet-model";
import styles from "./facet.module.css";
import { breakIdentifier } from "@/ui/text/Identifier";

/**
 * Requires (IR L118, Flow 5): each requirement with its status. A missing one offers Place {option} per option
 * and Compare options… when there's more than one; a convention says so and never blocks.
 */
export function RequiresSection({ facet, readOnly }: { facet: Facet; readOnly: boolean }) {
  const placed = useDocument((s) => s.project.recipe.facets);
  return (
    <Section label="Requires">
      {facet.requires.length === 0 ? (
        <p className={sheet.muted}>none</p>
      ) : (
        <ul className={sheet.list}>
          {facet.requires.map((requirement) => {
            const status = requirementStatus(requirement, placed);
            const key = requirement.anyOf.join("|");
            const word =
              status.status === "met" ? `Met by ${status.by}` : status.convention ? "Convention" : "Missing";
            return (
              <li key={key} className={cx(sheet.item, styles.requirement)} data-requirement={key}>
                <div className={sheet.itemLine}>
                  <span className={sheet.mono}>{breakIdentifier(requirement.anyOf.join(" or "))}</span>
                  <span className={cx(sheet.muted, status.status === "missing" && !status.convention && styles.contested)}>
                    {word}
                  </span>
                </div>
                <p className={sheet.muted}>{requirement.reason}</p>
                {status.status === "missing" && !readOnly ? (
                  <div className={sheet.actions}>
                    {requirement.anyOf.map((option) => (
                      <CommandButton key={option} command={commandRef("facet.place", { facet: option })} size="small" />
                    ))}
                    {requirement.anyOf.length > 1 ? (
                      <CommandButton
                        command={commandRef("dependency.compare", { options: [...requirement.anyOf] })}
                        size="small"
                        variant="quiet"
                      />
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
