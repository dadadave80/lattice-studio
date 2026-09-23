// S5e's command registrations (contracts §5.3). The definitions live in `definitions.ts`.
import { defineCommands } from "@/contracts";
import { S5E_COMMANDS } from "./definitions";

defineCommands(S5E_COMMANDS);
