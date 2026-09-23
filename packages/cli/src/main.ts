// `lattice-studio` (spec L921). The build adds the `#!/usr/bin/env node` banner; `bun src/main.ts` runs it in dev.
import { run } from "./cli";
import { processDeps } from "./deps";

// exitCode, not exit(): stdout drains before the process ends, so a long export piped to a file is complete.
process.exitCode = await run(process.argv.slice(2), processDeps());
