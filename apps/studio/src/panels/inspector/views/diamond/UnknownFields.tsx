import { plural, validateProject } from "@lattice-studio/core";
import { useMemo } from "react";
import { useDocument } from "@/contracts";
import { Section } from "../../shared/Section";
import sheet from "../../shared/sheet.module.css";
import styles from "./diamond.module.css";
import { breakIdentifier } from "@/ui/text/Identifier";

/** Fields Studio kept but doesn't recognize, listed read-only (spec L289). Nothing when there are none. */
export function UnknownFields() {
  const project = useDocument((s) => s.project);
  const fields = useMemo(() => {
    const result = validateProject(project);
    return result.ok ? result.value.unknownFields : [];
  }, [project]);
  if (fields.length === 0) return null;
  return (
    <Section label="Unknown fields">
      <p className={sheet.text}>{`Studio kept ${plural(fields.length, "field")} it doesn't recognize`}</p>
      <ul className={styles.plainList} aria-label="Unrecognized fields">
        {fields.map((path) => (
          <li key={path} className={sheet.mono}>
            {breakIdentifier(path)}
          </li>
        ))}
      </ul>
    </Section>
  );
}
