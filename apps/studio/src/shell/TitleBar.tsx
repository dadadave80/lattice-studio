import { commandRef, useSaveStatus } from "@/contracts";
import { CommandButton } from "@/ui";
import { AppMenu } from "./AppMenu";
import { DeployButton } from "./DeployButton";
import { isDrawerTier, useCompactChip, useLayoutTier } from "./layout-tier";
import { OverflowMenu } from "./OverflowMenu";
import { PaletteChip } from "./PaletteChip";
import { PaneToggles } from "./PaneToggles";
import { ProjectName } from "./ProjectName";
import { ProjectStatusChip } from "./ProjectStatusChip";
import { SaveStatus } from "./SaveStatus";
import { ThemeSwitch } from "./ThemeSwitch";
import styles from "./TitleBar.module.css";

/**
 * The title bar (spec L355, IR L60-L74), 40 px tall. At every width: the App menu, the project name, the
 * status chip. 1280 px and wider adds Undo, Redo, the save status, Share, Shop/Draft and ⌘K; 768-1279 px
 * adds the pane toggles; below 1024 px Deploy… moves here; under 768 px Undo, Redo, Share, the theme, ⌘K and
 * the tool strip move into the overflow menu (⋯), and the save status shows only when something needs saying.
 */
export function TitleBar() {
  const tier = useLayoutTier();
  const compactChip = useCompactChip();
  const saveState = useSaveStatus().state;
  const phone = tier === "phone";
  const showSave = !phone || saveState === "not-saved" || saveState === "read-only";
  return (
    <div className={styles.bar} data-layout={tier}>
      <div className={styles.start}>
        <AppMenu compact={phone} />
        {phone ? null : (
          <>
            <CommandButton command={commandRef("history.undo")} icon="undo" iconOnly size="small" />
            <CommandButton command={commandRef("history.redo")} icon="redo" iconOnly size="small" />
          </>
        )}
        {isDrawerTier(tier) ? <PaneToggles tier={tier} /> : null}
      </div>
      <div className={styles.middle}>
        <ProjectName />
        {showSave ? <SaveStatus /> : null}
        <ProjectStatusChip compact={compactChip} />
      </div>
      <div className={styles.end}>
        {tier === "narrow" || phone ? <DeployButton /> : null}
        {phone ? (
          <OverflowMenu />
        ) : (
          <>
            <CommandButton command={commandRef("share.copyLink")} icon="share" size="small">
              Share
            </CommandButton>
            <ThemeSwitch />
            <PaletteChip />
          </>
        )}
      </div>
    </div>
  );
}
