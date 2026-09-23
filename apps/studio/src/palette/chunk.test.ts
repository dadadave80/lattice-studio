// The palette is its own chunk (spec L822): what the entry loads (the host, `commands.ts`, `services.ts`)
// reaches the palette's UI only through a dynamic `import()`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const here = import.meta.dir;

/** Value imports and re-exports (not `import type`), as written. */
function staticImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  const pattern = /^(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)"|^import\s+"([^"]+)"/gm;
  for (const match of source.matchAll(pattern)) found.push(match[1] ?? match[2] ?? "");
  return found;
}

function resolveLocal(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = join(dirname(from), specifier);
  for (const ext of [".ts", ".tsx", "/index.ts"]) {
    try {
      readFileSync(base + ext);
      return base + ext;
    } catch {
      // Try the next extension.
    }
  }
  return null;
}

/** Every file and package the entry points reach through static imports inside the palette folder. */
function reach(entries: string[]): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = entries.map((e) => join(here, e));
  while (queue.length) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of staticImports(file)) {
      const local = resolveLocal(file, specifier);
      if (local) queue.push(local);
      else packages.add(specifier);
    }
  }
  return { files, packages };
}

describe("the palette's chunk", () => {
  const entry = reach(["index.ts", "commands.ts", "services.ts"]);
  const names = [...entry.files].map((f) => f.slice(here.length + 1)).sort();

  test("the entry side is the host, the state and the command, nothing more", () => {
    expect(names).toEqual(["CommandPalette.tsx", "commands.ts", "index.ts", "open-command.ts", "palette-state.ts", "services.ts"]);
  });

  test("Base UI's Autocomplete and Dialog stay out of the entry", () => {
    expect([...entry.packages].filter((p) => p.startsWith("@base-ui/"))).toEqual([]);
  });

  test("the state module loads the popup with a dynamic import", () => {
    expect(readFileSync(join(here, "palette-state.ts"), "utf8")).toContain('import("./PalettePopup")');
  });
});
