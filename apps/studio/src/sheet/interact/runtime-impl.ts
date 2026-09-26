/**
 * The interactions runtime's module (see `runtime.ts`): the handlers and the command runs, registered when it
 * evaluates. The interactions layer imports it, so it loads with the layer.
 */
import { handlers } from "./handlers";
import { runs } from "./runs";
import { provideRuntime } from "./runtime";

provideRuntime({ handlers, runs });

export const loaded = true;
