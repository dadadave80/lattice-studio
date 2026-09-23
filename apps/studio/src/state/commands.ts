/**
 * S1's commands (contracts §5.3): every command that edits the document, plus undo, redo and acknowledgements.
 * Registration only; the definitions live in `cmd/`.
 */
import { defineCommands } from "@/contracts";
import { placeCommand, removeCommand, routeContestedCommand } from "./cmd/facets";
import { addStepCommand, moveStepCommand, removeStepCommand, reorderAutoCommand, setArgCommand } from "./cmd/init";
import { flipPinsCommand, tidyCommand, tidySelectionCommand, toggleExpandCommand } from "./cmd/layout";
import { keepImmutableCommand, loadCommand, replaceCommand } from "./cmd/recipe";
import { clearOwnerCommand, excludeCommand, includeCommand, routeCommand } from "./cmd/selectors";
import { ackCommand, redoCommand, renameCommand, undoCommand } from "./cmd/session";

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

defineCommands(S1_COMMANDS);
