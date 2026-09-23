import { useRef, useState } from "react";
import { closeDialog, type DialogComponentProps, type SettingsGroup } from "@/contracts";
import { Button, Dialog, Tabs, TabPanel, type TabItem } from "@/ui";
import { AboutGroup } from "./groups/AboutGroup";
import { AppearanceGroup } from "./groups/AppearanceGroup";
import { CanvasGroup } from "./groups/CanvasGroup";
import { DataGroup } from "./groups/DataGroup";
import { DeployGroup } from "./groups/DeployGroup";
import { KeyboardGroup } from "./groups/KeyboardGroup";
import { NetworksGroup } from "./groups/NetworksGroup";
import { WalletGroup } from "./groups/WalletGroup";
import styles from "./SettingsDialog.module.css";

const GROUPS: readonly TabItem<SettingsGroup>[] = [
  { value: "appearance", label: "Appearance" },
  { value: "canvas", label: "Canvas" },
  { value: "keyboard", label: "Keyboard" },
  { value: "networks", label: "Networks" },
  { value: "wallet", label: "Wallet" },
  { value: "deploy", label: "Deploy" },
  { value: "data", label: "Data" },
  { value: "about", label: "About" },
];

/**
 * Settings (Flow 16, IR L183): eight groups, one per left-hand tab. `group` picks which one opens (a fix
 * such as chain.useAnotherRpc opens straight to Networks, IR L236); without it the first group opens, as the
 * dialog's initial focus (IR L183 "First group").
 */
export function SettingsDialog({ entry, top }: DialogComponentProps<"settings">) {
  const [group, setGroup] = useState<SettingsGroup>(entry.props.group ?? "appearance");
  const tabsRef = useRef<HTMLDivElement>(null);
  const close = () => closeDialog("settings");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Settings"
      initialFocus={() => tabsRef.current?.querySelector<HTMLElement>('[role="tab"]') ?? null}
      lossless
      top={top}
      size="wide"
      footer={<Button onClick={close}>Close</Button>}
      {...(styles.dialog ? { className: styles.dialog } : {})}
    >
      <div ref={tabsRef} className={styles.layout}>
        <Tabs
          label="Settings groups"
          orientation="vertical"
          value={group}
          onValueChange={setGroup}
          tabs={GROUPS}
          listClassName={styles.tabList}
        >
          {GROUPS.map((item) => (
            <TabPanel key={item.value} value={item.value} className={styles.panel}>
              <GroupContent group={item.value} />
            </TabPanel>
          ))}
        </Tabs>
      </div>
    </Dialog>
  );
}

function GroupContent({ group }: { group: SettingsGroup }) {
  switch (group) {
    case "appearance":
      return <AppearanceGroup />;
    case "canvas":
      return <CanvasGroup />;
    case "keyboard":
      return <KeyboardGroup />;
    case "networks":
      return <NetworksGroup />;
    case "wallet":
      return <WalletGroup />;
    case "deploy":
      return <DeployGroup />;
    case "data":
      return <DataGroup />;
    case "about":
      return <AboutGroup />;
  }
}
