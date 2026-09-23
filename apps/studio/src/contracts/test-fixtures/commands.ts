/**
 * A module-level `commands.ts` registration, as every module writes one, for the registry's tests.
 * `discover.ts` skips `src/contracts/**`, so the app never loads it.
 */
import { command, defineCommands } from "../commands";
import { log } from "../services";

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
