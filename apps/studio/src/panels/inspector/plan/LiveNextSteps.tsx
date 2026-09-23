import type { Deployment } from "@lattice-studio/core";
import { commandRef, useDocument, type ChainInfo } from "@/contracts";
import { Button, CommandButton, copyText } from "@/ui";
import { explorerUrl, louperUrl } from "../shared/use-deploy-status";
import styles from "./CutPlanFooter.module.css";

/** Governed upgrade mechanisms: their diamonds get the recommended first proposal (spec L578). */
const GOVERNED = ["GovernedDiamondCut", "GovernedSafeDiamondCut"];

/**
 * Next steps once live (spec L578, L384): explorer, Louper, copy address, save a file copy, and for governed
 * diamonds the recommended first proposal.
 */
export function LiveNextSteps({ record, chains }: { record: Deployment; chains: readonly ChainInfo[] }) {
  const governed = useDocument((s) => s.project.recipe.facets.some((name) => GOVERNED.includes(name)));
  const explorer = explorerUrl(chains, record.chainId, record.address);
  return (
    <>
      <p className={styles.links}>
        {explorer ? (
          <a className={styles.link} href={explorer} target="_blank" rel="noreferrer">
            Open in explorer
          </a>
        ) : null}
        <a className={styles.link} href={louperUrl(chains, record.chainId, record.address)} target="_blank" rel="noreferrer">
          Open in Louper
        </a>
      </p>
      <div className={styles.nextSteps}>
        <Button size="small" variant="quiet" onClick={() => void copyText(record.address)}>
          Copy address
        </Button>
        <CommandButton command={commandRef("project.exportFile")} size="small" variant="quiet">
          Save a file copy
        </CommandButton>
      </div>
      {governed ? (
        <p className={styles.empty}>
          Recommended first proposal: freeze the loupe selectors, <code>diamondCut</code> and <code>emergencyRemoveCut</code>.
        </p>
      ) : null}
    </>
  );
}
