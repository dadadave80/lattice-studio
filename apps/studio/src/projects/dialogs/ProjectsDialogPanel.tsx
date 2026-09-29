import { useEffect, useRef, useState } from "react";
import { chainService, closeDialog, type DialogComponentProps } from "@/contracts";
import { persistence, subscribeProjects, type ProjectSummary, type TrashSummary } from "@/persist";
import { Button, Dialog, Tabs, TabPanel } from "@/ui";
import { subscribeProjectsRefresh } from "../list-refresh";
import { registerListFocus } from "./list-focus";
import { ProjectRow } from "./ProjectRow";
import styles from "./ProjectsDialogPanel.module.css";
import { TrashRow } from "./TrashRow";

type Tab = "recent" | "deleted";

/** Projects (IR "Projects" table): Recent first, with Recently deleted alongside (30-day expiry, spec L502). */
export function ProjectsDialogPanel({ entry, top }: DialogComponentProps<"projects">) {
  const [tab, setTab] = useState<Tab>(entry.props.tab ?? "recent");
  const [recent, setRecent] = useState<ProjectSummary[] | null>(null);
  const [trash, setTrash] = useState<TrashSummary[] | null>(null);
  const recentRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLDivElement>(null);
  const [chainNames, setChainNames] = useState<Map<number, string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    chainService()
      .then((service) => {
        if (!cancelled) setChainNames(new Map(service.chains().map((c) => [c.id, c.name])));
      })
      .catch(() => {
        // Not built yet, or it failed to load: status chips fall back to "Chain <id>".
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    // An in-place `project.rename` (the open project's own row) never reaches `subscribeProjects` (it edits
    // the document only); `renameStoredProject` notifies here once the rename is flushed to storage.
    const stopRefresh = subscribeProjectsRefresh(safe);
    return () => {
      cancelled = true;
      stop();
      stopRefresh();
    };
  }, []);

  // A row a command removed (Delete, Restore, Delete for good) hands focus back here, never the body.
  useEffect(() => {
    const stops = [
      registerListFocus("recent", () => recentRef.current?.focus()),
      registerListFocus("deleted", () => trashRef.current?.focus()),
    ];
    return () => {
      for (const stop of stops) stop();
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
          <div ref={recentRef} tabIndex={-1} className={styles.listContainer}>
            {recent === null ? (
              <p className={styles.empty}>Loading…</p>
            ) : recent.length === 0 ? (
              <p className={styles.empty}>No projects yet.</p>
            ) : (
              <ul className={styles.list}>
                {recent.map((row) => (
                  <ProjectRow key={row.id} summary={row} onClose={close} {...(chainNames ? { chainNames } : {})} />
                ))}
              </ul>
            )}
          </div>
        </TabPanel>
        <TabPanel value="deleted">
          <div ref={trashRef} tabIndex={-1} className={styles.listContainer}>
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
          </div>
        </TabPanel>
      </Tabs>
    </Dialog>
  );
}
