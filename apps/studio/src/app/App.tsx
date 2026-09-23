import { useRegion } from "@/contracts";
import { ConsolePanel } from "@/panels/console";
import { InspectorPanel } from "@/panels/inspector";
import { Sheet } from "@/sheet/canvas";
import { LeftPane, TitleBar } from "@/shell";
import styles from "./App.module.css";

/**
 * Placeholder until WP-S3: the five regions of the desktop layout (spec L353-L359), each a landmark from
 * `useRegion`.
 */
export function App() {
  const titlebar = useRegion("titlebar");
  const left = useRegion("left");
  const sheet = useRegion("sheet");
  const inspector = useRegion("inspector");
  const console = useRegion("console");

  return (
    <div className={styles.app}>
      <header {...titlebar} className={styles.titlebar}>
        <TitleBar />
      </header>
      <aside {...left} className={styles.left}>
        <LeftPane />
      </aside>
      <main {...sheet} className={styles.sheet}>
        <Sheet />
      </main>
      <aside {...inspector} className={styles.inspector}>
        <InspectorPanel />
      </aside>
      <section {...console} className={styles.console}>
        <ConsolePanel />
      </section>
    </div>
  );
}
