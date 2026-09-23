/**
 * S1's commands (contracts §5.3): every command that edits the document, plus undo, redo and acknowledgements.
 * Definitions only; `state/commands.ts` registers them.
 */

import { placeCommand, removeCommand, routeContestedCommand } from "./facets";
import { addStepCommand, moveStepCommand, removeStepCommand, reorderAutoCommand, setArgCommand } from "./init";
import { flipPinsCommand, tidyCommand, tidySelectionCommand, toggleExpandCommand } from "./layout";
import { keepImmutableCommand, loadCommand, replaceCommand } from "./recipe";
import { clearOwnerCommand, excludeCommand, includeCommand, routeCommand } from "./selectors";
import { ackCommand, redoCommand, renameCommand, undoCommand } from "./session";

/** In registration order: `route <facet> <selector>` is tried before `route <facet>` (contracts §5.3). */
export const S1_COMMANDS = [
  placeCommand,
  removeCommand,
  routeCommand,
  routeContestedCommand,
  clearOwnerCommand,
  excludeCommand,
  includeCommand,
  loadCommand,
  replaceCommand,
  keepImmutableCommand,
  setArgCommand,
  addStepCommand,
  removeStepCommand,
  moveStepCommand,
  reorderAutoCommand,
  flipPinsCommand,
  toggleExpandCommand,
  tidyCommand,
  tidySelectionCommand,
  ackCommand,
  undoCommand,
  redoCommand,
  renameCommand,
];


