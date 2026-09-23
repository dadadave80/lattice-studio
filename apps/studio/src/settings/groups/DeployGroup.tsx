import type { DeployPath } from "@lattice-studio/core";
import { useState } from "react";
import { settings, useSettings } from "@/contracts";
import { NumberField, RadioGroup } from "@/ui";
import styles from "./DeployGroup.module.css";

/** Settings → Deploy (Flow 16 L629, L778 announcements). No board yet (PA L72-L84). */
export function DeployGroup() {
  const defaultPath = useSettings((s) => s.defaultPath);
  const receiptTimeout = useSettings((s) => s.receiptTimeout);
  const deployAnnouncements = useSettings((s) => s.deployAnnouncements);
  const [timeoutText, setTimeoutText] = useState(String(receiptTimeout));

  return (
    <>
      <div className={styles.stack}>
        <RadioGroup
          label="Default diamond path"
          value={defaultPath}
          onValueChange={(value) => settings.set({ defaultPath: value as DeployPath })}
          options={[
            { value: "factory", label: "LatticeFactory" },
            { value: "createx", label: "CreateX CREATE3" },
          ]}
        />
        <p className={styles.note}>
          A project can switch paths in its own deploy review, where the CreateX address scope is set too.
        </p>
      </div>
      <NumberField
        label="Receipt timeout"
        value={timeoutText}
        onValueChange={(text) => {
          setTimeoutText(text);
          const parsed = Number.parseInt(text, 10);
          if (Number.isFinite(parsed) && parsed >= 1 && String(parsed) === text.trim()) {
            settings.set({ receiptTimeout: parsed });
          }
        }}
        step={1}
        min="1"
      />
      <div className={styles.stack}>
        <RadioGroup
          label="Deploy announcements"
          value={deployAnnouncements}
          onValueChange={(value) => settings.set({ deployAnnouncements: value as typeof deployAnnouncements })}
          options={[
            { value: "errors", label: "Errors" },
            { value: "all", label: "Everything" },
            { value: "none", label: "Nothing" },
          ]}
        />
        <p className={styles.note}>What deploy progress announces to screen readers.</p>
      </div>
    </>
  );
}
