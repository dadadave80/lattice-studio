import { useCatalogStatus } from "@/contracts";
import pkg from "../../../package.json";
import styles from "./AboutGroup.module.css";

const RUNTIME_PACKAGES = [
  "react",
  "react-dom",
  "@xyflow/react",
  "@base-ui/react",
  "zustand",
  "viem",
  "wagmi",
  "@walletconnect/ethereum-provider",
  "zod",
  "shiki",
  "idb",
  "fflate",
];

function catalogLine(status: ReturnType<typeof useCatalogStatus>): string {
  if (status.status === "loading") return "Catalog: loading…";
  if (status.status === "error") return "Catalog: couldn't load.";
  const { catalog } = status;
  return `Catalog: Lattice ${catalog.lattice.tag} · ${catalog.lattice.commit} · ${catalog.hash}`;
}

/** Settings → About (Flow 16 L629): version, catalog and licenses. No board yet (PA L72-L84). */
export function AboutGroup() {
  const status = useCatalogStatus();
  const provisional = status.status === "ready" ? status.catalog.provisional : undefined;

  return (
    <>
      <p className={styles.line}>Version {pkg.version}</p>
      <p className={styles.line}>{catalogLine(status)}</p>
      {provisional ? <p className={styles.note}>{provisional}</p> : null}
      <div>
        <h3 className={styles.heading}>Licenses</h3>
        <ul className={styles.list}>
          {RUNTIME_PACKAGES.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p className={styles.note}>See each project's own license.</p>
      </div>
    </>
  );
}
