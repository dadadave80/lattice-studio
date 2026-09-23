// S6's command (contracts §5.3): palette.open, ⌘/Ctrl K (IR L9, L162-L168).
import { defineCommands } from "@/contracts";
import { paletteOpenCommand } from "./open-command";

defineCommands([paletteOpenCommand]);
