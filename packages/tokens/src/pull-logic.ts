// Pure logic behind `bun run tokens:pull` (and its `--check`), so it's
// testable without spawning a process or touching real `.handoff` files.

import { existsSync } from "node:fs";

export interface PullResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface PullIo {
  readonly sourceExists: () => boolean;
  readonly vendoredExists: () => boolean;
  readonly readSource: () => Promise<string>;
  readonly readVendored: () => Promise<string>;
  readonly writeVendored: (contents: string) => Promise<void>;
}

export function fileIo(sourcePath: string, vendoredPath: string): PullIo {
  return {
    sourceExists: () => existsSync(sourcePath),
    vendoredExists: () => existsSync(vendoredPath),
    readSource: () => Bun.file(sourcePath).text(),
    readVendored: () => Bun.file(vendoredPath).text(),
    writeVendored: (contents) => Bun.write(vendoredPath, contents).then(() => undefined),
  };
}

export async function pullTokens(
  io: PullIo,
  options: { readonly check: boolean; readonly sourcePath: string; readonly vendoredPath: string },
): Promise<PullResult> {
  if (!io.sourceExists()) {
    return {
      ok: true,
      message: `tokens:pull · skipped, .handoff/design/tokens.json not present (expected in CI); using the vendored copy at ${options.vendoredPath}`,
    };
  }

  const source = await io.readSource();

  if (options.check) {
    if (!io.vendoredExists()) {
      return {
        ok: false,
        message: `tokens:pull --check · fail, no vendored copy at ${options.vendoredPath}; run \`bun run tokens:pull\``,
      };
    }
    const vendored = await io.readVendored();
    if (vendored !== source) {
      return {
        ok: false,
        message: `tokens:pull --check · fail, ${options.vendoredPath} drifted from .handoff/design/tokens.json; run \`bun run tokens:pull\``,
      };
    }
    return { ok: true, message: "tokens:pull --check · pass, vendored copy matches .handoff/design/tokens.json" };
  }

  await io.writeVendored(source);
  return { ok: true, message: `tokens:pull · copied .handoff/design/tokens.json to ${options.vendoredPath}` };
}
