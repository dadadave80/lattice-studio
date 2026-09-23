/**
 * S1's command registrations (contracts §5.3). The definitions live in `cmd/`.
 */
import { defineCommands } from "@/contracts";
import { S1_COMMANDS } from "./cmd";

defineCommands(S1_COMMANDS);
