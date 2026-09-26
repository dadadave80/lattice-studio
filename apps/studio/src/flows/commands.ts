/**
 * S13's commands (contracts §5.3): Share, Confirm addresses…, Take over editing and Migrate to 0.4.1…. The entry
 * chunk holds only these registrations; the codec, the dialogs and the confirm view load on use.
 */
import {
  command, defineCommands, doc, getCatalogStatus, log, openDialog, session, type CommandArgsOf, type CommandContext,
  type Enablement,
} from "@/contracts";
import { editLockState, persistence } from "@/persist/current";
import { migrateTitle, PLACE_FACETS_FIRST } from "./copy";
import { currentMigrationTag, migrationTarget } from "./read-only";

const OK: Enablement = { ok: true };

function disabled(reason: string): Enablement {
  return { ok: false, reason };
}

/** LINK-01 problems in the analysis now: the fields Confirm addresses… steps through (spec L334, IR L203). */
function unconfirmed(ctx: CommandContext): number {
  return ctx.analysis.problems.filter((p) => p.code === "LINK-01").length;
}

const share = command({
  id: "share.copyLink",
  title: () => "Copy share link",
  category: "Session",
  palette: true,
  // Share doesn't edit the document, so a read-only project can still be shared.
  enabled: (ctx) => (ctx.project.recipe.facets.length === 0 ? disabled(PLACE_FACETS_FIRST) : OK),
  async run(ctx) {
    const { copyShareLink } = await import("./share-link");
    await copyShareLink(ctx.project);
  },
});

const confirmAddresses = command({
  id: "link.confirmAddresses",
  title: () => "Confirm addresses…",
  category: "Build",
  palette: true,
  enabled(ctx) {
    if (ctx.session.readOnly !== null) return disabled(ctx.session.readOnly);
    return unconfirmed(ctx) === 0 ? disabled("No address is waiting to be confirmed") : OK;
  },
  run() {
    session.set((s) => ({
      panes: { ...s.panes, narrow: "inspector", inspector: { ...s.panes.inspector, open: true, view: { kind: "confirm-addresses" } } },
    }));
  },
});

const takeOver = command({
  id: "project.takeOverEditing",
  // The same command gives editing back to a tab that handed it over (IR L205).
  title: () => (editLockState().state === "handed-over" ? "Take back editing" : "Take over editing"),
  category: "Session",
  palette: true,
  enabled() {
    const lock = editLockState().state;
    return lock === "elsewhere" || lock === "handed-over" ? OK : disabled("This tab is editing this project");
  },
  async run() {
    const taken = await (await persistence()).takeOverEditing();
    if (taken.ok) return; // S7a loads the saved project and logs that history starts over (spec L494).
    // S7a logs a lock it couldn't get; anything else (no project, a failed read) is said here.
    const lock = editLockState().state;
    if (lock !== "elsewhere" && lock !== "handed-over") log({ tag: "Error", text: `Couldn't take over editing. ${taken.error}` });
  },
});

const migrate = command<CommandArgsOf<"catalog.migrate">>({
  id: "catalog.migrate",
  title: () => migrateTitle(currentMigrationTag(doc.get().recipe.catalog)),
  category: "Session",
  palette: true,
  enabled(ctx) {
    const target = migrationTarget(ctx.project.recipe.catalog, getCatalogStatus());
    return target.ok ? OK : disabled(target.reason);
  },
  run(ctx, { target }) {
    const found = migrationTarget(ctx.project.recipe.catalog, getCatalogStatus());
    const id = target ?? (found.ok ? found.entry.id : undefined);
    openDialog("migrate", id === undefined ? {} : { target: id });
  },
});

defineCommands([share, confirmAddresses, takeOver, migrate]);
