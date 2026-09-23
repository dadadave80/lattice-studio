import { useCatalogStatus } from "@/contracts";
import { version } from "../../../package.json";
import baseUiPkg from "@base-ui/react/package.json";
import fflatePkg from "fflate/package.json";
import idbPkg from "idb/package.json";
import reactDomPkg from "react-dom/package.json";
import reactPkg from "react/package.json";
import shikiPkg from "shiki/package.json";
import viemPkg from "viem/package.json";
import wagmiPkg from "wagmi/package.json";
// @walletconnect/ethereum-provider's own `exports` map doesn't expose `./package.json` to package-specifier
// resolution, so this reads the file directly instead (bun hoists workspace dependencies to the repo root).
import walletConnectPkg from "../../../../../node_modules/@walletconnect/ethereum-provider/package.json";
import xyflowPkg from "@xyflow/react/package.json";
import zodPkg from "zod/package.json";
import zustandPkg from "zustand/package.json";
import styles from "./AboutGroup.module.css";

/** Each bundled runtime package's own declared `license` field, read from its own `package.json`. */
const RUNTIME_PACKAGES: readonly { name: string; license: string }[] = [
  { name: "react", license: reactPkg.license },
  { name: "react-dom", license: reactDomPkg.license },
  { name: "@xyflow/react", license: xyflowPkg.license },
  { name: "@base-ui/react", license: baseUiPkg.license },
  { name: "zustand", license: zustandPkg.license },
  { name: "viem", license: viemPkg.license },
  { name: "wagmi", license: wagmiPkg.license },
  { name: "@walletconnect/ethereum-provider", license: walletConnectPkg.license },
  { name: "zod", license: zodPkg.license },
  { name: "shiki", license: shikiPkg.license },
  { name: "idb", license: idbPkg.license },
  { name: "fflate", license: fflatePkg.license },
];

function catalogLine(status: ReturnType<typeof useCatalogStatus>): string {
  if (status.status === "loading") return "Catalog: loading…";
  if (status.status === "error") return "Catalog: couldn't load.";
  const { id, catalog } = status;
  return `Catalog: Lattice ${catalog.lattice.tag} (${id}) · ${catalog.lattice.commit} · ${catalog.hash}`;
}

/** Settings → About (Flow 16 L629): version, catalog id/tag/commit/hash and licenses. No board yet (PA L72-L84). */
export function AboutGroup() {
  const status = useCatalogStatus();
  const provisional = status.status === "ready" ? status.catalog.provisional : undefined;

  return (
    <>
      <p className={styles.line}>Version {version}</p>
      <p className={styles.line}>{catalogLine(status)}</p>
      {provisional ? <p className={styles.note}>{provisional}</p> : null}
      <div>
        <h3 className={styles.heading}>Licenses</h3>
        <ul className={styles.list}>
          {RUNTIME_PACKAGES.map((pkg) => (
            <li key={pkg.name}>
              {pkg.name} — {pkg.license}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
