// Settings and About load in their own chunks (spec L822); nothing outside this folder needs them
// eagerly, so the barrel only re-exports the lazy wrappers, never `./SettingsDialog` or `./AboutDialog`
// themselves (see `entry-chunk.test.ts`).
export { AboutDialogChunk } from "./AboutDialogChunk";
export { SettingsDialogChunk } from "./SettingsDialogChunk";
