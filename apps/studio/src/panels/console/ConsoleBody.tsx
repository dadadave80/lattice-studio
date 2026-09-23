import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { lazy, Suspense } from "react";
import { cx } from "@/ui/shared/cx";
import { CommandLine } from "./CommandLine";
import styles from "./ConsolePanel.module.css";
import { LogView } from "./LogView";

/** The Script and Recipe JSON tabs load with the first one opened (spec L822). */
const CodeTab = lazy(() => import("./CodeTab").then((m) => ({ default: m.CodeTab })));

/**
 * The console drawer's body (IR L134-L137): the Log, Script and Recipe JSON panels and the command line. Its own
 * chunk, loaded when the drawer first opens (spec L822); `ConsolePanel` draws the frame around it and the tabs
 * that name these panels, so it renders inside that frame's `Tabs.Root`.
 */
export function ConsoleBody() {
  return (
    <>
      <BaseTabs.Panel value="log" keepMounted className={styles.panel}>
        <LogView />
      </BaseTabs.Panel>
      <BaseTabs.Panel value="script" className={cx(styles.panel, styles.codePanel)}>
        <Suspense fallback={null}>
          <CodeTab kind="script" />
        </Suspense>
      </BaseTabs.Panel>
      <BaseTabs.Panel value="recipe" className={cx(styles.panel, styles.codePanel)}>
        <Suspense fallback={null}>
          <CodeTab kind="recipe" />
        </Suspense>
      </BaseTabs.Panel>
      <CommandLine />
    </>
  );
}
