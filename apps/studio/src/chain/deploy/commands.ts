/**
 * S8c's command registrations (contracts §5.3). The definitions live in `deploy-commands.ts`. Light: in the entry
 * chunk, like every `commands.ts`.
 */
import { defineCommands } from "@/contracts";
import { DEPLOY_COMMANDS } from "./deploy-commands";

defineCommands(DEPLOY_COMMANDS);
