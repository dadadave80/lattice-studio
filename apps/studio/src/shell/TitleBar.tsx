import { useLayoutEffect, useRef } from "react";
import { commandRef, useDocument, useSaveStatus } from "@/contracts";
import { CommandButton } from "@/ui/buttons/CommandButton";
import { cx } from "@/ui/shared/cx";
import { AppMenu } from "./AppMenu";
import { DeployButton } from "./DeployButton";
import { isDrawerTier, useLayoutTier } from "./layout-tier";
import { OverflowMenu } from "./OverflowMenu";
import { PaneToggles } from "./PaneToggles";
import { ProjectName } from "./ProjectName";
import { ProjectStatusChip } from "./ProjectStatusChip";
import { SaveStatus } from "./SaveStatus";
import { SearchField } from "./SearchField";
import { useStatusChip } from "./status";
import { ThemeSwitch } from "./ThemeSwitch";
import { setTitleNameHidden } from "./title-name";
import { useCrowded } from "./use-crowded";
import styles from "./TitleBar.module.css";

/**
 * The title bar (spec L355, IR L60-L74), 40 px tall. At every width: the App menu, the project name, the
 * status chip and an overflow menu (⋯) that holds Share. 1024 px and wider: Undo, Redo, the save status, the
 * search field and Light/Dark; 768-1279 px adds the pane toggles. Below 1024 px Deploy… moves here, the product
 * name, the save status and the search field shrink to icons, and the overflow menu also takes the theme and the
 * palette; under 768 px it also takes Undo, Redo, Export and the tool strip, and the save status shows only
 * when something needs saying. When the middle runs out of room, the name truncates first, then the chip
 * shrinks, then the save status moves into the overflow menu; under 768 px the name then moves to the
 * switcher's Sheet tab rather than show fewer than a few letters.
 */
export function TitleBar() {
  const tier = useLayoutTier();
  const saveState = useSaveStatus().state;
  const name = useDocument((s) => s.project.name);
  const chip = useStatusChip();
  const middle = useRef<HTMLDivElement>(null);
  const phone = tier === "phone";
  const short = tier === "narrow" || phone;
  const showSave = !phone || saveState === "not-saved" || saveState === "read-only";
  const crowded = useCrowded(middle, `${tier}|${name}|${chip.text}|${saveState}`);
  // Under 768 px the name keeps a few letters while the chip shrinks; if the middle still overflows, the name
  // gives way altogether and the switcher's Sheet tab carries it, rather than show one letter.
  const stillCrowded = useCrowded(middle, `${tier}|${name}|${chip.text}|${saveState}|${String(crowded)}`);
  const nameHidden = phone && crowded && stillCrowded;
  useLayoutEffect(() => {
    setTitleNameHidden(nameHidden);
  }, [nameHidden]);
  useLayoutEffect(() => () => setTitleNameHidden(false), []);
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
        {nameHidden ? null : <ProjectName />}
        {showSave && !saveInMenu ? <SaveStatus compact={short} /> : null}
        <ProjectStatusChip chip={chip} compact={crowded} />
      </div>
      <div className={styles.end}>
        {short ? (
          <>
            <SearchField compact />
            <DeployButton again={chip.deployAgain} />
            <OverflowMenu saveStatus={saveInMenu} partial={!phone} />
          </>
        ) : (
          <>
            <SearchField />
            <ThemeSwitch className={cx(styles.theme)} />
            <OverflowMenu saveStatus={false} shareOnly />
          </>
        )}
      </div>
    </div>
  );
}
