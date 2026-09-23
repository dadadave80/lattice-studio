/**
 * Copies the previous release's hashed chunks into this build's `dist/` (spec L831, L947): a tab that never
 * finished precaching keeps running its own build, and still finds the chunks it asks for after a release.
 * Run after `bun run build`, on Vercel and for IPFS alike:
 *
 *   bun apps/studio/build/carry-previous.ts --out apps/studio/dist --from <previous dist folder or URL>
 *
 * It reads the previous release's `release.json`, copies every file it lists that this build lacks (never
 * overwriting one), and records them under `carried` in this build's `release.json`. Only the previous
 * release's own files move forward, so releases don't pile up. Old tabs still check each carried chunk
 * against their own import map's integrity. With `--from` empty it says so and carries nothing (a first
 * release has no previous one).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { formatJson } from "./headers.ts";
import { RELEASE_MANIFEST, type ReleaseManifest } from "./precache.ts";

/** A file a release may carry: a plain name under `assets/`, nothing that climbs out of `dist/`. */
const ASSET_PATH = /^assets\/[A-Za-z0-9._-]+$/;

export type Source = {
  describe: string;
  read(path: string): Promise<Uint8Array>;
};

export function sourceFor(from: string, fetcher: typeof fetch = fetch): Source {
  if (/^https?:\/\//.test(from)) {
    const base = from.endsWith("/") ? from : `${from}/`;
    return {
      describe: base,
      async read(path) {
        const response = await fetcher(new URL(path, base));
        if (!response.ok) throw new Error(`${new URL(path, base)} answered ${response.status}.`);
        return new Uint8Array(await response.arrayBuffer());
      },
    };
  }
  return {
    describe: from.endsWith("/") ? from : `${from}/`,
    async read(path) {
      const file = join(from, path);
      if (!existsSync(file)) throw new Error(`${file} doesn't exist.`);
      return new Uint8Array(readFileSync(file));
    },
  };
}

export function parseRelease(text: string, where: string): ReleaseManifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${where} isn't JSON.`);
  }
  const assets = (json as { assets?: unknown }).assets;
  if (!Array.isArray(assets) || !assets.every((a): a is string => typeof a === "string")) {
    throw new Error(`${where} has no list of assets.`);
  }
  const bad = assets.find((a) => !ASSET_PATH.test(a));
  if (bad !== undefined) throw new Error(`${where} lists "${bad}", which isn't a file under assets/.`);
  const notPrecached = (json as { notPrecached?: unknown }).notPrecached;
  return { assets, notPrecached: Array.isArray(notPrecached) ? notPrecached.filter((n): n is string => typeof n === "string") : [] };
}

export type CarryResult = { carried: string[]; alreadyPresent: number };

/** Copies the previous release's files that `out` lacks, and records them in `out/release.json`. */
export async function carryPrevious(source: Source, out: string): Promise<CarryResult> {
  const ownFile = join(out, RELEASE_MANIFEST);
  if (!existsSync(ownFile)) throw new Error(`${ownFile} doesn't exist: run the build first.`);
  const own = parseRelease(readFileSync(ownFile, "utf8"), ownFile);
  const previous = parseRelease(new TextDecoder().decode(await source.read(RELEASE_MANIFEST)), `${source.describe}${RELEASE_MANIFEST}`);

  const carried: string[] = [];
  let alreadyPresent = 0;
  for (const asset of previous.assets) {
    const target = join(out, asset);
    if (existsSync(target)) {
      alreadyPresent += 1;
      continue;
    }
    const bytes = await source.read(asset);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    carried.push(asset);
  }
  writeFileSync(ownFile, formatJson({ ...own, carried: carried.sort() }));
  return { carried, alreadyPresent };
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main(args: string[]): Promise<number> {
  const out = option(args, "out") ?? "dist";
  const from = option(args, "from")?.trim() ?? "";
  if (!from) {
    console.log("No previous release given (--from is empty), so nothing was carried. Pass the previous release's URL or dist folder.");
    return 0;
  }
  try {
    const result = await carryPrevious(sourceFor(from), out);
    console.log(
      `Carried ${result.carried.length} files from ${from} into ${out}` +
        (result.alreadyPresent ? ` (${result.alreadyPresent} were already there).` : "."),
    );
    return 0;
  } catch (error) {
    console.error(`Couldn't carry the previous release's chunks: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
