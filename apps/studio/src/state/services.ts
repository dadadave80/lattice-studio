/**
 * S1's registrations: the document, session and settings stores and the analysis provider (contracts §5.1),
 * installed at module evaluation. Nothing here reads IndexedDB or the network: deployment records and the chain
 * module are read later, when a project opens or a chain is selected.
 */
import { createStudioState, installStudioState } from "./runtime";

installStudioState(createStudioState());
