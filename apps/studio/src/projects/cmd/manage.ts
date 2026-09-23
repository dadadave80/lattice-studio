/**
 * Duplicate, Delete, Restore and Delete for good (the Projects dialog and Recently deleted, spec L502).
 * Delete asks nothing (it goes to Recently deleted with Undo); Delete for good confirms in its own dialog.
 */
import { command, openDialog, type CommandArgsOf } from "@/contracts";
import { disabled, isString, OK } from "./shared";

type IdArgs = CommandArgsOf<"project.duplicate">;

function idOr(args: IdArgs): { ok: true; id: string } | { ok: false } {
  return isString(args.id) ? { ok: true, id: args.id } : { ok: false };
}

export const duplicateCommand = command<IdArgs>({
  id: "project.duplicate",
  title: () => "Duplicate",
  category: "Session",
  enabled: (_ctx, args) => (isString(args.id) ? OK : disabled("Choose a project to duplicate")),
  async run(_ctx, args) {
    const picked = idOr(args);
    if (!picked.ok) return;
    const { duplicateProject } = await import("../actions");
    await duplicateProject(picked.id);
  },
});

export const deleteCommand = command<IdArgs>({
  id: "project.delete",
  title: () => "Delete",
  category: "Session",
  enabled: (_ctx, args) => (isString(args.id) ? OK : disabled("Choose a project to delete")),
  async run(_ctx, args) {
    const picked = idOr(args);
    if (!picked.ok) return;
    const { deleteProject } = await import("../actions");
    await deleteProject(picked.id);
  },
});

export const restoreCommand = command<IdArgs>({
  id: "project.restore",
  title: () => "Restore",
  category: "Session",
  enabled: (_ctx, args) => (isString(args.id) ? OK : disabled("Choose a project to restore")),
  async run(_ctx, args) {
    const picked = idOr(args);
    if (!picked.ok) return;
    const { restoreProject } = await import("../actions");
    await restoreProject(picked.id);
  },
});

export const deleteForGoodCommand = command<IdArgs>({
  id: "project.deleteForGood",
  title: () => "Delete for good",
  category: "Session",
  enabled: (_ctx, args) => (isString(args.id) ? OK : disabled("Choose a project to delete for good")),
  run(_ctx, args) {
    const picked = idOr(args);
    if (!picked.ok) return;
    openDialog("delete-for-good", { projectId: picked.id });
  },
});
