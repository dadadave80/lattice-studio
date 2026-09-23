import { comparePlan } from "@lattice-studio/core";
import { useMemo } from "react";
import { commandRef, useAnalysis, useCatalog, useOnline, type InspectorViewProps } from "@/contracts";
import { Button, CommandButton, copyText } from "@/ui";
import { Section } from "../../shared/Section";
import { SpecRow } from "../../shared/SpecRow";
import { SpecRows } from "../../shared/SpecRows";
import { ViewHeader } from "../../shared/ViewHeader";
import sheet from "../../shared/sheet.module.css";
import { chainNameOf, useChainService, useChains } from "../../shared/use-chain";
import { useDeployStatus } from "../../shared/use-deploy-status";
import { CompareColumns } from "./CompareColumns";
import { comparisonText, signatureLookup, verdict } from "./comparison-text";
import styles from "./ComparisonView.module.css";
import { useLoupe } from "./use-loupe";

/**
 * Compare with the sheet (IR L116, spec L576): a Mismatch record's diamond, its `facets()` beside the plan,
 * differences marked, with the record's recipe hash beside the sheet's. Copy details, Use a new salt.
 */
export function ComparisonView({ view }: InspectorViewProps<"comparison">) {
  const { chainId, address } = view;
  const online = useOnline();
  const access = useChainService(true);
  const chain = chainNameOf(useChains(access), chainId);
  const plan = useAnalysis((a) => a.plan);
  const sheetHash = useAnalysis((a) => a.recipeHash);
  const catalog = useCatalog();
  const signatureOf = useMemo(() => signatureLookup(catalog), [catalog]);
  const { deployments } = useDeployStatus();
  const record = deployments?.find((d) => d.chainId === chainId && d.address.toLowerCase() === address.toLowerCase());

  const service = online && access.status === "ready" ? access.service : null;
  const { read, retry } = useLoupe(service, chainId, address);
  const comparison = useMemo(() => (read.status === "ready" ? comparePlan(plan, read.facets) : null), [plan, read]);

  let status: string;
  if (!online) status = "Chain checks need a connection.";
  else if (access.status === "unavailable") status = access.reason;
  else if (read.status === "error") status = read.error;
  else if (comparison) status = verdict(comparison, plan);
  else status = `Checking ${chain}…`;

  const copyDetails = () => {
    const text = comparisonText(
      {
        chain,
        chainId,
        address,
        recordHash: record?.recipeHash ?? null,
        sheetHash,
        plan,
        comparison,
        ...(comparison ? {} : { status }),
      },
      signatureOf,
    );
    void copyText(text, { label: "comparison" });
  };

  return (
    <div className={sheet.view} data-view="comparison">
      <ViewHeader title="Compare with the sheet" kind="Mismatch" />
      <Section label="Diamond">
        <SpecRows>
          <SpecRow label="Chain">{chain}</SpecRow>
          <SpecRow label="Address">{address}</SpecRow>
          <SpecRow label="Record hash">
            {deployments === null ? "Reading the records…" : (record?.recipeHash ?? "No record")}
          </SpecRow>
          <SpecRow label="Sheet hash">{sheetHash}</SpecRow>
        </SpecRows>
      </Section>
      <Section label="On chain">
        <div className={styles.status}>
          <output className={comparison && !comparison.matches ? `${sheet.text} ${sheet.strong}` : sheet.text}>{status}</output>
          {read.status === "error" && online ? (
            <Button size="small" onClick={retry}>
              Retry
            </Button>
          ) : null}
        </div>
        {comparison && read.status === "ready" ? (
          <CompareColumns plan={plan} facets={read.facets} comparison={comparison} signatureOf={signatureOf} />
        ) : null}
      </Section>
      <Section label="Actions">
        <div className={sheet.actions}>
          <Button onClick={copyDetails} icon="copy">
            Copy details
          </Button>
          <CommandButton command={commandRef("deploy.newSalt")}>Use a new salt</CommandButton>
        </div>
      </Section>
    </div>
  );
}
