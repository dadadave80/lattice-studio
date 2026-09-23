import { useEffect, useState } from "react";
import { closeDialog, type DialogComponentProps } from "@/contracts";
import { persistence, subscribeProjects, type ProjectSummary, type TrashSummary } from "@/persist";
import { Button, Dialog, Tabs, TabPanel } from "@/ui";
import { ProjectRow } from "./ProjectRow";
import styles from "./ProjectsDialogPanel.module.css";
import { TrashRow } from "./TrashRow";

type Tab = "recent" | "deleted";

/** Projects (IR "Projects" table): Recent first, with Recently deleted alongside (30-day expiry, spec L502). */
export function ProjectsDialogPanel({ entry, top }: DialogComponentProps<"projects">) {
  const [tab, setTab] = useState<Tab>(entry.props.tab ?? "recent");
  const [recent, setRecent] = useState<ProjectSummary[] | null>(null);
  const [trash, setTrash] = useState<TrashSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const store = await persistence();
      const [projects, deleted] = await Promise.all([store.listProjects(), store.listTrash()]);
      if (cancelled) return;
      setRecent(projects);
      setTrash(deleted);
    };
    const safe = () => void load().catch(() => {});
    safe();
    const stop = subscribeProjects(safe);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  const close = () => closeDialog("projects");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Projects"
      lossless
      top={top}
      size="wide"
      footer={<Button onClick={close}>Close</Button>}
    >
      <Tabs
        label="Projects"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "recent", label: "Recent", ...(recent ? { count: recent.length } : {}) },
          { value: "deleted", label: "Recently deleted", ...(trash ? { count: trash.length } : {}) },
        ]}
      >
        <TabPanel value="recent">
          {recent === null ? (
            <p className={styles.empty}>Loading…</p>
          ) : recent.length === 0 ? (
            <p className={styles.empty}>No projects yet.</p>
          ) : (
            <ul className={styles.list}>
              {recent.map((row) => (
                <ProjectRow key={row.id} summary={row} onClose={close} />
              ))}
            </ul>
          )}
        </TabPanel>
        <TabPanel value="deleted">
          {trash === null ? (
            <p className={styles.empty}>Loading…</p>
          ) : trash.length === 0 ? (
            <p className={styles.empty}>Nothing in Recently deleted.</p>
          ) : (
            <ul className={styles.list}>
              {trash.map((row) => (
                <TrashRow key={row.id} summary={row} />
              ))}
            </ul>
          )}
        </TabPanel>
      </Tabs>
    </Dialog>
  );
}
