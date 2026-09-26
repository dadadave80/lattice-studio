/** S10's dialog registrations (contracts §5.2 "dialogs"): Settings and About, each in its own chunk. */
import { registerDialog } from "@/contracts";
import { AboutDialogChunk } from "./AboutDialogChunk";
import { SettingsDialogChunk } from "./SettingsDialogChunk";

registerDialog("settings", SettingsDialogChunk);
registerDialog("about", AboutDialogChunk);
