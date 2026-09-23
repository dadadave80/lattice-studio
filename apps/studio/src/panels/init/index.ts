/**
 * S5d: the init plan editor and Choose an upgrade mechanism. Other modules reach them through the inspector view
 * "init", the "choose-mechanism" dialog and the commands; this barrel holds only light helpers, so importing it
 * never pulls the editor into the entry chunk.
 */
export { showInitPlan } from "./navigation";
