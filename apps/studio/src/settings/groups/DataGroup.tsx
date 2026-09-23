import { useEffect, useState } from "react";
import { commandRef } from "@/contracts";
import { persistence, type StorageInfo } from "@/persist";
import { CommandButton } from "@/ui";
import styles from "./DataGroup.module.css";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function storageText(info: StorageInfo): string {
  if (info.usage === null || info.quota === null) return "Storage use isn't available in this browser.";
  return `${formatBytes(info.usage)} of ${formatBytes(info.quota)} used`;
}

/** Settings → Data (Flow 16 L629, spec L882 privacy note). No board yet (PA L72-L84). */
export function DataGroup() {
  const [info, setInfo] = useState<StorageInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const store = await persistence();
      const result = await store.storageInfo();
      if (!cancelled) setInfo(result);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {info ? (
        <div className={styles.storage}>
          <p className={styles.line}>{storageText(info)}</p>
          {info.persisted === null ? null : (
            <p className={styles.line}>Persistent storage: {info.persisted ? "on." : "off."}</p>
          )}
        </div>
      ) : null}
      <p className={styles.note}>
        RPC providers see the addresses Studio reads, and Sourcify receives the sources it verifies, which are
        public anyway.
      </p>
      <div className={styles.actions}>
        <CommandButton command={commandRef("data.exportAll")} />
        <CommandButton command={commandRef("data.clear")} />
      </div>
    </>
  );
}
