// S2's command registrations (contracts §5.3). The definitions live in `definitions.ts`.
import { defineCommands } from "@/contracts";
import { S2_COMMANDS } from "./definitions";

defineCommands(S2_COMMANDS);
