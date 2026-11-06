import { appendFileSync, existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type SourceKind = "list" | "sources" | "mirrors";
type Rewrite = { text: string; changed: number; official: number; unsupported: boolean; stockMirrorList: boolean };
export type MirrorChange = { state: "changed" | "already-official"; files: number; uris: number };

/** Replace only an active, exact Azure Ubuntu URI; leave signatures, suites and other repositories alone. */
export function rewriteAptSource(text: string, kind: SourceKind): Rewrite {
  let changed = 0;
  let official = 0;
  let unsupported = false;
  let stockMirrorList = false;
  const uri = (value: string): string => {
    if (kind !== "mirrors" && value === "mirror+file:/etc/apt/apt-mirrors.txt") { stockMirrorList = true; return value; }
    if (value.startsWith("mirror+file:")) { unsupported = true; return value; }
    const azure = /^https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu(\/?)$/i.exec(value);
    if (azure) { changed++; return `https://archive.ubuntu.com/ubuntu${azure[1]}`; }
    if (/^https?:\/\/archive\.ubuntu\.com\/ubuntu\/?$/i.test(value)) official++;
    else {
      try { if (new URL(value).hostname === "azure.archive.ubuntu.com") unsupported = true; } catch { /* Other apt syntax is untouched. */ }
    }
    return value;
  };
  const blocks = kind === "sources" ? text.split(/(\r?\n[ \t]*\r?\n)/) : [text];
  const rewritten = blocks.map((block) => {
    // Deb822 comments and continuation lines apply to Enabled too.
    const unfolded = block.replace(/^[ \t]*#[^\r\n]*(?:\r?\n|$)/gm, "").replace(/\r?\n[ \t]+/g, " ");
    if (kind === "sources" && /^[ \t]*Enabled:[ \t]*no[ \t]*\r?$/im.test(unfolded)) return block;
    return block.replace(/[^\r\n]+/g, (line) => {
      if (/^[ \t]*(?:#|$)/.test(line)) return line;
      if (kind === "mirrors") {
        const match = /^([ \t]*)(https?:\/\/(?:azure\.archive|archive|security)\.ubuntu\.com\/ubuntu\/?)([ \t]+priority:\d+[ \t]*(?:#.*)?)$/i.exec(line);
        if (match) return `${match[1]}${uri(match[2] ?? "")}${match[3]}`;
        unsupported = true;
      } else if (kind === "sources") {
        const match = /^([ \t]*URIs:[ \t]*)(.*)$/i.exec(line);
        if (match) return `${match[1]}${match[2]?.replace(/\S+/g, uri) ?? ""}`;
      } else {
        const match = /^([ \t]*deb(?:-src)?[ \t]+(?:\[[^\]]*\][ \t]+)?)(\S+)(.*)$/.exec(line);
        if (match) return `${match[1]}${uri(match[2] ?? "")}${match[3]}`;
      }
      if (/https?:\/\/(?:[^/\s@]*@)?azure\.archive\.ubuntu\.com(?=[:/\s]|$)/i.test(line)) unsupported = true;
      return line;
    });
  }).join("");
  return { text: rewritten, changed, official, unsupported, stockMirrorList };
}

/** Inspect all candidates before writing: unsupported layouts cannot produce a partial mirror change. */
export function rewriteUbuntuAptSources(apt: string): MirrorChange {
  const main = join(apt, "sources.list");
  const directory = join(apt, "sources.list.d");
  if ((existsSync(main) && !lstatSync(main).isFile()) || (existsSync(directory) && !lstatSync(directory).isDirectory())) {
    throw new Error("APT source paths must be regular files and directories; files unchanged.");
  }
  const files = [
    ...(existsSync(main) ? [main] : []),
    ...(existsSync(directory) ? readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(list|sources)$/.test(entry.name)).map((entry) => join(directory, entry.name)) : []),
  ];
  const changes = files.map((file) => ({ file, ...rewriteAptSource(readFileSync(file, "utf8"), file.endsWith(".sources") ? "sources" : "list") }));
  if (changes.some((change) => change.unsupported)) throw new Error("Found an unsupported Azure Ubuntu apt source layout; files unchanged.");
  if (changes.some((change) => change.stockMirrorList)) {
    // The stock runner's referenced failover list is the only indirect source this experiment supports.
    const file = join(apt, "apt-mirrors.txt");
    if (!existsSync(file) || !lstatSync(file).isFile()) throw new Error("The referenced stock mirror list must be a regular file; files unchanged.");
    const mirror = rewriteAptSource(readFileSync(file, "utf8"), "mirrors");
    if (mirror.unsupported) throw new Error("Found an unsupported stock mirror-list layout; files unchanged.");
    changes.push({ file, ...mirror });
  }
  const changed = changes.filter((change) => change.changed > 0);
  if (changed.length === 0 && !changes.some((change) => change.official > 0)) {
    throw new Error("No recognized Azure Ubuntu apt source was found; files unchanged.");
  }
  for (const change of changed) writeFileSync(change.file, change.text);
  return { state: changed.length > 0 ? "changed" : "already-official", files: changed.length, uris: changed.reduce((sum, change) => sum + change.changed, 0) };
}

if (import.meta.main) {
  try {
    if (process.argv.length > 2) throw new Error("apt-mirror accepts no arguments; only system apt sources are supported.");
    const result = rewriteUbuntuAptSources("/etc/apt");
    console.log(`apt-mirror · ${result.state}; ${result.uris} URI(s) in ${result.files} file(s).`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `state=${result.state}\n`);
  } catch (error) {
    console.error(`apt-mirror · ${error instanceof Error ? error.message : "Source inspection failed."}`);
    process.exitCode = 1;
  }
}
