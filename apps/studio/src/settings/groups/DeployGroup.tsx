import type { DeployPath } from "@lattice-studio/core";
import { useState } from "react";
import { settings, useSettings } from "@/contracts";
import { etherscanKeyFrom } from "@/chain/verify/key";
import { NumberField, RadioGroup, TextField } from "@/ui";
import styles from "./DeployGroup.module.css";

/** Settings → Deploy (Flow 16 L629, L778 announcements). No board yet (PA L72-L84). */
export function DeployGroup() {
  const defaultPath = useSettings((s) => s.defaultPath);
  const receiptTimeout = useSettings((s) => s.receiptTimeout);
  const deployAnnouncements = useSettings((s) => s.deployAnnouncements);
  const [timeoutText, setTimeoutText] = useState(String(receiptTimeout));
  // The setting can change from outside this field (a reset, another tab): adjusted during render (the
  // documented React pattern), not an effect, so it never shows a stale value for even one frame.
  const [syncedWith, setSyncedWith] = useState(receiptTimeout);
  if (receiptTimeout !== syncedWith) {
    setSyncedWith(receiptTimeout);
    setTimeoutText(String(receiptTimeout));
  }
  const etherscanApiKey = useSettings((s) => s.etherscanApiKey);
  const [keyText, setKeyText] = useState(etherscanApiKey);
  const [keySyncedWith, setKeySyncedWith] = useState(etherscanApiKey);
  if (etherscanApiKey !== keySyncedWith) {
    setKeySyncedWith(etherscanApiKey);
    setKeyText(etherscanApiKey);
  }
  // Committed whole, on blur or Enter: a key saved on every keystroke would be tried against Etherscan half-typed.
  const commitKey = (): void => {
    if (keyText.trim() !== etherscanApiKey) settings.set({ etherscanApiKey: keyText.trim() });
  };
  const buildHasKey = etherscanKeyFrom("") !== undefined;

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
          A project can switch paths in its deploy review, where the CreateX address scope is set too.
        </p>
      </div>
      <NumberField
        label="Receipt timeout (seconds)"
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
      <TextField
        label="Etherscan API key"
        value={keyText}
        onValueChange={setKeyText}
        onBlur={commitKey}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitKey();
        }}
        mono
        autoComplete="off"
        description={
          etherscanApiKey === "" && buildHasKey
            ? "Leave empty to use this build's key. A key typed here stays in this browser and is sent only to Etherscan."
            : `${etherscanApiKey === "" ? "Not set up. " : ""}Verifies a diamond on Etherscan after a deploy, alongside Sourcify. The key stays in this browser and is sent only to Etherscan.`
        }
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
