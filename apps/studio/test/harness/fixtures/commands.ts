/**
 * A module-level `commands.ts` registration, written the way every module writes one, for the registry's
 * own tests. It lives outside `src/`, so no discovery glob ever loads it; import it only after
 * `snapshotCommands({ pristine: true })`, and restore after.
 */
import { command, defineCommands } from "../../../src/contracts/commands";
import { log } from "../../../src/contracts/kernel";

defineCommands([
  command<{ tab?: string }>({
    id: "about.open",
    title: () => "About Lattice Studio",
    category: "Session",
    palette: true,
    console: { verb: "about", syntax: "about", parse: () => ({ ok: true, value: {} }) },
    enabled: () => ({ ok: true }),
    run: () => log({ tag: "Note", text: "Opened About." }),
  }),
]);
