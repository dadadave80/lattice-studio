/**
 * S8a's command registrations (contracts §5.3). The definitions live in `chain-commands.ts`. Light: in the entry
 * chunk, like every `commands.ts`.
 */
import { defineCommands } from "@/contracts";
import { CHAIN_COMMANDS } from "./chain-commands";

defineCommands(CHAIN_COMMANDS);
