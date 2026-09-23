import { formatTime, type Deployment } from "@lattice-studio/core";
import { useEffect, useRef, useState } from "react";
import { runCommand } from "@/contracts";
import { persistence, type ProjectSummary } from "@/persist";
import { Button, StatusChip, TextField, Tooltip } from "@/ui";
import { projectRowStatus } from "../status";
import styles from "./ProjectRow.module.css";

export type ProjectRowProps = {
  summary: ProjectSummary;
  /** Closes the Projects dialog after a row's project opens (spec L502: "click opens"). */
  onClose: () => void;
};

/** One row of the Recent tab: name, status chip, last saved; Rename, Duplicate, Export, Delete. */
export function ProjectRow({ summary, onClose }: ProjectRowProps) {
  const { id, project } = summary;
  const [deployments, setDeployments] = useState<readonly Deployment[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project.name);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const store = await persistence();
      const rows = await store.deployments.listDeployments(id);
      if (!cancelled) setDeployments(rows);
    })().catch(() => {
      // Closed before the deployments came back: the status chip stays "Not deployed".
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Focus follows Rename opening: an imperative move on interaction, not a page-load autofocus.
  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  const status = projectRowStatus(project, deployments);
  const saved = formatTime(new Date(summary.savedAt).toISOString(), new Date().toISOString());

  const open = async () => {
    const result = await runCommand({ id: "project.open", args: { id } }, "button");
    if (result.ok) onClose();
  };

  const submitRename = async () => {
    const trimmed = name.trim();
    setRenaming(false);
    if (trimmed === "" || trimmed === project.name) {
      setName(project.name);
      return;
    }
    const { renameStoredProject } = await import("../actions");
    const result = await renameStoredProject(id, trimmed);
    if (!result.ok) setName(project.name);
  };

  return (
    <li className={styles.row}>
      {renaming ? (
        <TextField
          label="Project name"
          value={name}
          onValueChange={setName}
          inputRef={renameRef}
          onBlur={() => void submitRename()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submitRename();
            } else if (event.key === "Escape") {
              setName(project.name);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <button type="button" className={styles.name} onClick={() => void open()}>
          {project.name}
        </button>
      )}
      <StatusChip tone={status.tone} text={status.text} compact />
      <Tooltip content={saved.title}>
        <span className={styles.saved}>saved {saved.text}</span>
      </Tooltip>
      <span className={styles.actions}>
        <Button size="small" onClick={() => setRenaming(true)}>
          Rename
        </Button>
        <Button
          size="small"
          icon="copy"
          onClick={async () => {
            const { duplicateProject } = await import("../actions");
            await duplicateProject(id);
          }}
        >
          Duplicate
        </Button>
        <Button
          size="small"
          icon="export"
          onClick={async () => {
            const { exportStoredProject } = await import("../actions");
            await exportStoredProject(id);
          }}
        >
          Export
        </Button>
        <Button
          size="small"
          icon="trash"
          onClick={async () => {
            const { deleteProject } = await import("../actions");
            await deleteProject(id);
          }}
        >
          Delete
        </Button>
      </span>
    </li>
  );
}
