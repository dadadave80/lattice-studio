import { plural } from "@lattice-studio/core";
import { useMemo } from "react";
import { useAnalysis, useOnline } from "@/contracts";
import { Section } from "../../shared/Section";
import sheet from "../../shared/sheet.module.css";
import { explorerUrl, useDeployStatus } from "../../shared/use-deploy-status";
import { DeploymentRecord } from "./DeploymentRecord";
import { groupDeployments, recordKey } from "./diamond-words";
import { useRecordChecks } from "./use-record-checks";
import styles from "./diamond.module.css";

const FOCUS = { kind: "section", section: "deployments" } as const;

/** Every deployment record, grouped by chain, newest first (Flow 13, spec L584, L698). */
export function DeploymentsList() {
  const { deployments, chain, chains, chainName } = useDeployStatus();
  const currentHash = useAnalysis((a) => a.recipeHash);
  const online = useOnline();
  const checks = useRecordChecks(deployments, chain, online);
  const groups = useMemo(() => groupDeployments(deployments ?? []), [deployments]);

  return (
    <Section label="Deployments" focusTarget={FOCUS}>
      {deployments !== null && deployments.length === 0 ? <p className={sheet.muted}>Not deployed yet.</p> : null}
      {checks.checking > 0 ? (
        <output className={`${sheet.muted} ${styles.status}`}>{`Checking ${plural(checks.checking, "deployment")}…`}</output>
      ) : null}
      {groups.map((group) => {
        const name = chainName(group.chainId);
        return (
          <div key={group.chainId} className={styles.group}>
            <h4 className={styles.groupHeading}>{name}</h4>
            <ul className={sheet.list} aria-label={`Deployments on ${name}`}>
              {group.records.map((record) => (
                <DeploymentRecord
                  key={recordKey(record)}
                  record={record}
                  currentHash={currentHash}
                  chainName={name}
                  explorer={explorerUrl(chains, record.chainId, record.address)}
                  check={checks.checkOf(record)}
                  onRetry={() => checks.retry(record)}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </Section>
  );
}
