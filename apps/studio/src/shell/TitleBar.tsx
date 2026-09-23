import { useRef } from "react";
import { commandRef, useDocument, useSaveStatus } from "@/contracts";
import { CommandButton } from "@/ui";
import { AppMenu } from "./AppMenu";
import { DeployButton } from "./DeployButton";
import { isDrawerTier, useLayoutTier } from "./layout-tier";
import { OverflowMenu } from "./OverflowMenu";
import { PaletteChip } from "./PaletteChip";
import { PaneToggles } from "./PaneToggles";
import { ProjectName } from "./ProjectName";
import { ProjectStatusChip } from "./ProjectStatusChip";
import { SaveStatus } from "./SaveStatus";
import { useStatusChip } from "./status";
import { ThemeSwitch } from "./ThemeSwitch";
import { useCrowded } from "./use-crowded";
import styles from "./TitleBar.module.css";

/**
 * The title bar (spec L355, IR L60-L74), 40 px tall. At every width: the App menu, the project name, the
 * status chip. 1024 px and wider: Undo, Redo, the save status, Share, Shop/Draft and ⌘K; 768-1279 px adds the
 * pane toggles. Below 1024 px Deploy… moves here, the product name shrinks to its icon, the save status shows
 * only when something needs saying, and an overflow menu (⋯) takes Share, the theme and ⌘K; under 768 px it
 * also takes Undo, Redo, Export and the tool strip. When the middle runs out of room, the name truncates
 * first, then the chip shrinks, then the save status moves into the overflow menu.
 */
export function TitleBar() {
  const tier = useLayoutTier();
  const saveState = useSaveStatus().state;
  const name = useDocument((s) => s.project.name);
  const chip = useStatusChip();
  const middle = useRef<HTMLDivElement>(null);
  const phone = tier === "phone";
  const short = tier === "narrow" || phone;
  const showSave = !short || saveState === "not-saved" || saveState === "read-only";
  const crowded = useCrowded(middle, `${tier}|${name}|${chip.text}|${saveState}`);
  const saveInMenu = showSave && short && crowded;
  return (
    <div className={styles.bar} data-layout={tier}>
      <div className={styles.start}>
        <AppMenu compact={short} />
        {phone ? null : (
          <>
            <CommandButton command={commandRef("history.undo")} icon="undo" iconOnly size="small" />
            <CommandButton command={commandRef("history.redo")} icon="redo" iconOnly size="small" />
          </>
        )}
        {isDrawerTier(tier) ? <PaneToggles tier={tier} /> : null}
      </div>
      <div ref={middle} className={styles.middle} data-crowded={crowded ? "" : undefined}>
        <ProjectName />
        {showSave && !saveInMenu ? <SaveStatus compact={short} /> : null}
        <ProjectStatusChip chip={chip} compact={crowded} />
      </div>
      <div className={styles.end}>
        {short ? (
          <>
            <DeployButton again={chip.deployAgain} />
            <OverflowMenu saveStatus={saveInMenu} partial={!phone} />
          </>
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
