import type { Json } from "./json";
import type { WpId } from "./wp";

/**
 * Every command id and the work package that registers it (contracts §5.3). The app's registry holds a
 * placeholder for each id until its owner's `commands.ts` replaces it.
 */
const OWNERS = {
  // S1: document edits
  "facet.place": "S1",
  "facet.remove": "S1",
  "facet.routeContested": "S1",
  "selector.route": "S1",
  "selector.clearOwner": "S1",
  "selector.exclude": "S1",
  "selector.include": "S1",
  "recipe.load": "S1",
  "recipe.replace": "S1",
  "recipe.keepImmutable": "S1",
  "init.setArg": "S1",
  "init.addStep": "S1",
  "init.removeStep": "S1",
  "init.moveStep": "S1",
  "init.reorderAuto": "S1",
  "layout.flipPins": "S1",
  "layout.toggleExpand": "S1",
  "layout.tidy": "S1",
  "layout.tidySelection": "S1",
  "ack.set": "S1",
  "history.undo": "S1",
  "history.redo": "S1",
  "project.rename": "S1",
  // S2
  "ui.escape": "S2",
  "shortcuts.open": "S2",
  // S3
  "app.menu": "S3",
  "pane.toggle": "S3",
  "pane.show": "S3",
  // S4b
  "tool.select": "S4b",
  "tool.hand": "S4b",
  "sheet.zoomIn": "S4b",
  "sheet.zoomOut": "S4b",
  "sheet.zoom100": "S4b",
  "sheet.zoomFit": "S4b",
  "sheet.zoomSelection": "S4b",
  "sheet.zoomTo": "S4b",
  "sheet.locate": "S4b",
  "sheet.backToContent": "S4b",
  "sheet.minimapToggle": "S4b",
  // S4e
  "sheet.selectAll": "S4e",
  "sheet.clearSelection": "S4e",
  "sheet.moveTo": "S4e",
  "sheet.nudge": "S4e",
  "sheet.focusDirection": "S4e",
  "sheet.focusFirst": "S4e",
  "sheet.focusLast": "S4e",
  "sheet.enterRows": "S4e",
  "sheet.addFacetHere": "S4e",
  "facet.removeSelected": "S4e",
  "selector.copy": "S4e",
  "selector.copySignature": "S4e",
  "selector.showOwner": "S4e",
  // S4c
  "problem.next": "S4c",
  "problem.prev": "S4c",
  "problem.focus": "S4c",
  "collision.choosePerSelector": "S4c",
  "collision.resolve": "S4c",
  // S4d
  "initOrder.toggle": "S4d",
  "recipe.browse": "S4d",
  // S5a
  "catalog.focusSearch": "S5a",
  "catalog.preview": "S5a",
  // S5c
  "inspector.show": "S5c",
  "inspector.focusSelectors": "S5c",
  "dependency.compare": "S5c",
  "plan.copyJson": "S5c",
  "deploy.compare": "S5c",
  "deployments.show": "S5c",
  // S5d
  "init.open": "S5d",
  "init.focusField": "S5d",
  "init.confirmAddress": "S5d",
  "authority.chooseMechanism": "S5d",
  // S5e
  "console.toggle": "S5e",
  "console.maximize": "S5e",
  "console.clear": "S5e",
  "console.help": "S5e",
  "console.find": "S5e",
  "problem.list": "S5e",
  "export.foundry": "S5e",
  "export.brief": "S5e",
  "export.recipeJson": "S5e",
  "export.safe": "S5e",
  // S6
  "palette.open": "S6",
  // S7b
  "project.new": "S7b",
  "project.open": "S7b",
  "project.save": "S7b",
  "project.saveCopy": "S7b",
  "project.list": "S7b",
  "project.duplicate": "S7b",
  "project.exportFile": "S7b",
  "project.delete": "S7b",
  "project.restore": "S7b",
  "project.deleteForGood": "S7b",
  "data.exportAll": "S7b",
  "data.clear": "S7b",
  // S8a
  "chain.select": "S8a",
  "chain.retryRead": "S8a",
  "chain.useAnotherRpc": "S8a",
  "wallet.connect": "S8a",
  "wallet.switchNetwork": "S8a",
  // S8b
  "deploy.open": "S8b",
  "deploy.again": "S8b",
  "deploy.newSalt": "S8b",
  "deploy.usePath": "S8b",
  "deploy.setScope": "S8b",
  "deploy.previewFor": "S8b",
  "deploy.copyAddress": "S8b",
  "deploy.removeFacets": "S8b",
  "deploy.downloadSafeBatch": "S8b",
  "chain.focusPicker": "S8b",
  // S8c
  "deploy.missingContracts": "S8c",
  "deploy.sign": "S8c",
  "deploy.keepWaiting": "S8c",
  "deploy.checkWallet": "S8c",
  "deploy.reviewAgain": "S8c",
  "deploy.discardProposal": "S8c",
  "deploy.showProgress": "S8c",
  // S8d
  "deploy.retryVerification": "S8d",
  // S9
  "region.next": "S9",
  "region.prev": "S9",
  "region.focus": "S9",
  // S10
  "settings.open": "S10",
  "theme.set": "S10",
  "tour.start": "S10",
  "tour.end": "S10",
  "about.open": "S10",
  // S11a
  "app.reload": "S11a",
  "app.saveAndReload": "S11a",
  // S12
  "help.open": "S12",
  // S13
  "share.copyLink": "S13",
  "link.confirmAddresses": "S13",
  "project.takeOverEditing": "S13",
  "catalog.migrate": "S13",
} as const satisfies Record<string, WpId>;

/** Every command id (contracts §5.3). */
export type CommandId = keyof typeof OWNERS;

/** Who registers each command (contracts §5.3). */
export const COMMAND_OWNERS: Readonly<Record<CommandId, WpId>> = OWNERS;

/** Every command id, in §5.3's order. */
export const COMMAND_IDS = Object.keys(OWNERS) as CommandId[];

/** A command with its arguments, as problems offer fixes (contracts §3.1). */
export type CommandRef = { id: CommandId; args?: Record<string, Json> };

/** Guard for ids read from outside (console input, stored keymaps). */
export function isCommandId(value: unknown): value is CommandId {
  return typeof value === "string" && Object.hasOwn(OWNERS, value);
}
