import type { Severity } from "@lattice-studio/core";
import { useMemo } from "react";
import {
  commandRef, openProblemDoc, useAnalysis, useCatalog, useSession, type InspectorViewProps,
} from "@/contracts";
import { Button, CommandButton, Icon, VisuallyHidden, type IconName } from "@/ui";
import { Section } from "../../shared/Section";
import { ViewHeader } from "../../shared/ViewHeader";
import sheet from "../../shared/sheet.module.css";
import { chainNameOf, useChainService, useChains } from "../../shared/use-chain";
import { signatureLookup } from "../comparison/comparison-text";
import { AnchorItem } from "./AnchorItem";
import { InlineCode } from "./InlineCode";
import styles from "./ProblemView.module.css";

const SEVERITY: Record<Severity, { word: string; icon: IconName }> = {
  blocker: { word: "Blocker", icon: "error" },
  warning: { word: "Warning", icon: "warning" },
  info: { word: "Info", icon: "info" },
};

/** Fixes that already are the acknowledgement: CORE-02's Keep immutable, INIT-05's Keep example values. */
const ACK_FIXES = new Set<string>(["ack.set", "recipe.keepImmutable"]);

/**
 * One problem (IR L124): its severity in words, the message, where it is with a way to each place, the fixes,
 * and Learn more, which opens the problem's doc page in place (precached, so offline too; spec L905).
 */
export function ProblemView({ view }: InspectorViewProps<"problem">) {
  const problem = useAnalysis((a) => a.problems.find((p) => p.id === view.id));
  const catalog = useCatalog();
  const signatureOf = useMemo(() => signatureLookup(catalog), [catalog]);
  const selectedChain = useSession((s) => s.chainId);
  const chains = useChains(useChainService(selectedChain !== null));
  const recipeHash = useAnalysis((a) => a.recipeHash);
  const acked = useSession((s) => (problem ? (s.acks[recipeHash]?.includes(problem.id) ?? false) : false));

  if (!problem) {
    const code = view.id.split(":")[0] ?? view.id;
    return (
      <div className={sheet.view} data-view="problem">
        <ViewHeader title={code} kind="Problem" />
        <Section label="Problem">
          <p className={sheet.muted}>This problem no longer applies.</p>
        </Section>
      </div>
    );
  }

  const severity = SEVERITY[problem.severity];
  const offerAck = problem.ack === true && !problem.fixes.some((fix) => ACK_FIXES.has(fix.id));
  const chainName = (chainId: number) => chainNameOf(chains, chainId);
  // SEL-01's contenders are equals: no accent on either, so neither reads as the recommendation.

  return (
    <div className={sheet.view} data-view="problem">
      <ViewHeader title={problem.code} kind="Problem" />
      <Section label="Problem">
        <span className={problem.severity === "blocker" ? `${styles.severity} ${styles.blocker}` : styles.severity}>
          <Icon name={severity.icon} />
          {severity.word}
        </span>
        <p className={styles.message}>
          <InlineCode text={problem.message} codeClassName={sheet.mono} />
        </p>
      </Section>
      {problem.where.length > 0 ? (
        <Section label="Where">
          <ul className={sheet.list}>
            {problem.where.map((anchor, index) => (
              <AnchorItem key={index} anchor={anchor} signatureOf={signatureOf} chainName={chainName} />
            ))}
          </ul>
        </Section>
      ) : null}
      {problem.fixes.length > 0 || problem.ack ? (
        <Section label="Fixes">
          {problem.ack ? (
            <p className={sheet.muted}>
              {acked
                ? "Acknowledged for this recipe."
                : "The deploy review asks you to acknowledge this warning before deploying."}
            </p>
          ) : null}
          <div className={sheet.actions}>
            {problem.fixes.map((fix, index) => (
              <CommandButton key={`${fix.id}-${index}`} command={fix} variant={index === 0 && problem.code !== "SEL-01" ? "primary" : "secondary"} />
            ))}
            {offerAck ? <CommandButton command={commandRef("ack.set", { problemId: problem.id })} /> : null}
          </div>
        </Section>
      ) : null}
      <Section label="Docs">
        <div className={sheet.actions}>
          <Button icon="help" onClick={() => openProblemDoc(problem.code)}>
            Learn more<VisuallyHidden> about {problem.code}</VisuallyHidden>
          </Button>
        </div>
      </Section>
    </div>
  );
}
