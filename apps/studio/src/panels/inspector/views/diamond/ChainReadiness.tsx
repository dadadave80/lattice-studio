import { commandRef, useOnline, useSession } from "@/contracts";
import { CommandButton } from "@/ui";
import { Section } from "../../shared/Section";
import sheet from "../../shared/sheet.module.css";
import styles from "./diamond.module.css";
import { chainNameOf, useChainService, useChains, useReadiness } from "../../shared/use-chain";
import { ReadinessRows } from "./ReadinessRows";

const FOCUS = { kind: "section", section: "readiness" } as const;

/**
 * The selected chain's readiness (IR L119, spec L697): read from the chain module's last probe, never probed
 * from here.
 */
export function ChainReadiness() {
  const chainId = useSession((s) => s.chainId);
  const online = useOnline();
  const access = useChainService(chainId !== null);
  const chains = useChains(access);
  const readiness = useReadiness(access, chainId);
  const known = chainId !== null && chains.some((chain) => chain.id === chainId);
  const name = chainId === null ? "" : chainNameOf(chains, chainId);

  let body;
  if (chainId === null) {
    body = (
      <>
        <p className={sheet.muted}>Choose a chain to check readiness.</p>
        <div className={sheet.actions}>
          <CommandButton command={commandRef("chain.focusPicker")} size="small">
            Choose a chain
          </CommandButton>
        </div>
      </>
    );
  } else if (!online) {
    body = <p className={sheet.muted}>Chain checks need a connection.</p>;
  } else if (access.status === "unavailable") {
    body = <p className={sheet.muted}>{access.reason}</p>;
  } else if (access.status !== "ready" || readiness.status === "checking") {
    body = (
      <output className={`${sheet.muted} ${styles.status}`}>{known ? `Checking ${name}…` : "Checking…"}</output>
    );
  } else if (readiness.status === "unknown") {
    body = <p className={sheet.muted}>Not checked yet.</p>;
  } else if (readiness.status === "error") {
    body = (
      <>
        <p className={sheet.text}>{`Couldn't read ${name}: the RPC didn't answer.`}</p>
        <div className={sheet.actions}>
          <CommandButton command={commandRef("chain.retryRead")} size="small">
            {`Retry reading ${name}`}
          </CommandButton>
          <CommandButton command={commandRef("chain.useAnotherRpc")} size="small">
            Use another RPC…
          </CommandButton>
        </div>
      </>
    );
  } else {
    body = <ReadinessRows state={readiness.state} name={name} />;
  }

  return (
    <Section label="Chain readiness" aside={known ? name : undefined} focusTarget={FOCUS}>
      {body}
    </Section>
  );
}
