import { plural } from "@lattice-studio/core";
import { useMemo } from "react";
import { useAnalysis, useOnline } from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { Section } from "../../shared/Section";
import sheet from "../../shared/sheet.module.css";
import { explorerUrl, useDeployStatus } from "../../shared/use-deploy-status";
import { DeploymentRecord } from "./DeploymentRecord";
import { groupDeployments, recordKey } from "./diamond-words";
import { useRecordChecks } from "./use-record-checks";
import styles from "./diamond.module.css";

const FOCUS = { kind: "section", section: "deployments" } as const;

/**
 * Every deployment record, grouped by chain, newest first (Flow 13, spec L584, L698). `autoCheck`: read the
 * records on the chain when shown (deployments.show asked for this list); otherwise the Check button does.
 */
export function DeploymentsList({ autoCheck }: { autoCheck: boolean }) {
  const { deployments, chain, chains, chainName } = useDeployStatus({ recordChains: true });
  const currentHash = useAnalysis((a) => a.recipeHash);
  const online = useOnline();
  const checks = useRecordChecks(deployments, chain, online, autoCheck);
  const groups = useMemo(() => groupDeployments(deployments ?? []), [deployments]);
  const count = deployments?.length ?? 0;

  return (
    <Section label="Deployments" focusTarget={FOCUS}>
      {deployments !== null && deployments.length === 0 ? <p className={sheet.muted}>Not deployed yet.</p> : null}
      {checks.checking > 0 ? (
        <output className={`${sheet.muted} ${styles.status}`}>{`Checking ${plural(checks.checking, "deployment")}…`}</output>
      ) : count > 0 && checks.ready ? (
        <div className={sheet.actions}>
          <Button size="small" onClick={checks.checkAll}>
            {`Check ${plural(count, "deployment")} on chain`}
          </Button>
        </div>
      ) : null}
      {groups.map((group) => {
        const name = chainName(group.chainId);
        // Only a loaded list that truly lacks this chain id says so; loading or unavailable never claims that
        // (the command needs only the chain id it already has, spec L606, L661: the reason shown must be true).
        const known = chain.status !== "ready" || chains.some((c) => c.id === group.chainId);
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
                  chainKnown={known}
                  check={checks.checkOf(record)}
                  online={online}
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
