/**
 * S8c: the deploy engine (Flow 12, contracts §5.2 "deploy"). The controller loads through `deployController()`
 * (contracts) in its own chunk; this barrel is light: the commands, the copy and the types other modules read.
 */
export { DEPLOY_COMMANDS, missingNames, signTitle } from "./deploy-commands";
export { CHANGED_SINCE_REVIEW, DEPLOY_BANNER_ID, DEPLOYING_BANNER, MISMATCH, notSeenFor, OFFLINE_TRACKING } from "./copy";
export type { MissingItem, MissingStep } from "./machine";
