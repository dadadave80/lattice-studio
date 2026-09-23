import type { DeployPath } from "@lattice-studio/core";
import { commandRef, env, runCommand, useCommandState, useDocument, useSession } from "@/contracts";
import { chainName, pickerChains } from "@/chain/infra/chains";
import { Button } from "@/ui/buttons/Button";
import { Menu } from "@/ui/overlays/Menu";
import { MenuRadioGroup } from "@/ui/overlays/MenuRadioGroup";
import { MenuRadioItem } from "@/ui/overlays/MenuRadioItem";
import { MenuSeparator } from "@/ui/overlays/MenuSeparator";
import { NO_CHAIN, pathName } from "./copy";
import { cx } from "@/ui/shared/cx";
import styles from "./chrome.module.css";

const PATHS: readonly DeployPath[] = ["factory", "createx"];

/** "Sepolia · LatticeFactory" (spec L362); "Choose a chain · LatticeFactory" before one is chosen. */
export function chainPathText(chainId: number | null, path: DeployPath): string {
  return `${chainId === null ? NO_CHAIN : chainName(chainId, env.e2e)} · ${pathName(path)}`;
}

function ChainItem({ chainId, name }: { chainId: number; name: string }) {
  const state = useCommandState(commandRef("chain.select", { chainId }), "menu");
  return <MenuRadioItem value={String(chainId)} label={name} disabledReason={state.ok ? null : state.reason} />;
}

function PathItem({ path }: { path: DeployPath }) {
  const state = useCommandState(commandRef("deploy.usePath", { path }), "menu");
  return <MenuRadioItem value={path} label={pathName(path)} disabledReason={state.ok ? null : state.reason} />;
}

/**
 * The title block's chain and path (spec L362): a picker. The chain group selects the chain readiness and the
 * prediction follow (`chain.select`, S8a); the path group switches between LatticeFactory and CreateX
 * (`deploy.usePath`, S8b). Each item carries its command's reason while it can't be chosen.
 */
export function ChainPathPicker() {
  const chainId = useSession((s) => s.chainId);
  const path = useDocument((s) => s.project.deploy.path);
  const text = chainPathText(chainId, path);
  return (
    <Menu
      label="Chain and path"
      side="top"
      trigger={
        <Button size="small" variant="quiet" aria-label={`Chain and path: ${text}`} className={cx(styles.picker)}>
          {text}
        </Button>
      }
    >
      <MenuRadioGroup
        label="Chain"
        value={chainId === null ? "" : String(chainId)}
        onValueChange={(next) => void runCommand(commandRef("chain.select", { chainId: Number(next) }), "menu")}
      >
        {pickerChains(env.e2e).map((chain) => (
          <ChainItem key={chain.id} chainId={chain.id} name={chain.name} />
        ))}
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuRadioGroup
        label="Path"
        value={path}
        onValueChange={(next) => {
          if (next === "factory" || next === "createx") void runCommand(commandRef("deploy.usePath", { path: next }), "menu");
        }}
      >
        {PATHS.map((p) => (
          <PathItem key={p} path={p} />
        ))}
      </MenuRadioGroup>
    </Menu>
  );
}
