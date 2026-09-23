/**
 * `lattice-studio`: the command dispatcher. `run` returns the exit code and never exits the process, so tests
 * call it in-process with fake dependencies; `main.ts` wires the real ones.
 */
import { parseCommandLine } from "./args";
import { runCheck } from "./commands/check";
import { runExport } from "./commands/export";
import { runPredict } from "./commands/predict";
import { runVerifyCatalog } from "./commands/verify";
import type { Deps } from "./deps";
import { EXIT, errorMessage, invalid } from "./failure";
import { fail, writeLines } from "./output";
import { usageFor } from "./usage";
import { STUDIO_VERSION } from "./version";

export async function run(argv: readonly string[], deps: Deps): Promise<number> {
  const parsed = parseCommandLine(argv);
  if (!parsed.ok) {
    // parseArgs didn't get as far as reading --json, so look for it in the raw arguments.
    if (argv.includes("--json")) return fail(deps, true, invalid(parsed.error));
    deps.stderr(`${parsed.error}\n\n${usageFor()}\n`);
    return EXIT.invalid;
  }
  const { command, values } = parsed.value;
  if (values.help === true) {
    writeLines(deps, [usageFor(command)]);
    return EXIT.ok;
  }
  if (values.version === true) {
    writeLines(deps, [STUDIO_VERSION]);
    return EXIT.ok;
  }
  try {
    switch (command) {
      case "check":
      case "plan":
        return await runCheck(command, parsed.value, deps);
      case "predict":
        return await runPredict(parsed.value, deps);
      case "export foundry":
        return await runExport("foundry", parsed.value, deps);
      case "export brief":
        return await runExport("brief", parsed.value, deps);
      case "export recipe":
        return await runExport("recipe", parsed.value, deps);
      case "export safe":
        return await runExport("safe", parsed.value, deps);
      case "verify-catalog":
        return await runVerifyCatalog(parsed.value, deps);
      default:
        writeLines(deps, [usageFor()]);
        return EXIT.ok;
    }
  } catch (error) {
    // Core never throws for expected failures; anything here is a bug or a function another WP hasn't built.
    return fail(deps, values.json === true, invalid(`lattice-studio stopped: ${errorMessage(error)}`));
  }
}
