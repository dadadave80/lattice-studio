import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { cx } from "@/ui/shared/cx";
import { CodeTab } from "./CodeTab";
import { CommandLine } from "./CommandLine";
import styles from "./ConsolePanel.module.css";
import { LogView } from "./LogView";

/**
 * The console drawer's body (IR L134-L137): the Log, Script and Recipe JSON panels and the command line. Its own
 * chunk, loaded when the drawer first opens (spec L822); `ConsolePanel` draws the frame around it and the tabs
 * that name these panels, so it renders inside that frame's `Tabs.Root`. The code tabs are part of it; Shiki and
 * the exporters still load only when a code tab first opens.
 */
export function ConsoleBody() {
  return (
    <>
      {/* The Log's own controls and lines take focus, so its panel isn't another Tab stop (the code panels scroll). */}
      <BaseTabs.Panel value="log" keepMounted className={styles.panel} tabIndex={-1}>
        <LogView />
      </BaseTabs.Panel>
      <BaseTabs.Panel value="script" className={cx(styles.panel, styles.codePanel)}>
        <CodeTab kind="script" />
      </BaseTabs.Panel>
      <BaseTabs.Panel value="recipe" className={cx(styles.panel, styles.codePanel)}>
        <CodeTab kind="recipe" />
      </BaseTabs.Panel>
      <CommandLine />
    </>
  );
}
