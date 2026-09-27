#!/usr/bin/env bun
// `bun scripts/ci/append-catalog-hash-to-release.ts <tag>`: appends the committed catalog's hash to a GitHub
// release's notes (§16 audit #7, spec L855 "the catalog hash is published with the release"). Only
// `release-please.yml` runs this, right after `googleapis/release-please-action` creates a release; it never
// runs as part of any agent's build. Needs `gh` on PATH and `GH_TOKEN`/`GITHUB_TOKEN` in the environment.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withCatalogNotesLine, type CatalogManifest } from "./catalog-hash-logic.ts";

const root = join(import.meta.dir, "..", "..");

function run(cmd: string[]): string {
  const p = Bun.spawnSync(cmd, { cwd: root, stdout: "pipe", stderr: "inherit" });
  if (p.exitCode !== 0) {
    console.error(`append-catalog-hash-to-release · \`${cmd.join(" ")}\` failed.`);
    process.exit(1);
  }
  return p.stdout.toString();
}

function main(): void {
  const tag = process.argv[2];
  if (!tag) {
    console.error("append-catalog-hash-to-release · usage: bun scripts/ci/append-catalog-hash-to-release.ts <tag>");
    process.exit(2);
  }

  const manifest = JSON.parse(readFileSync(join(root, "catalog", "manifest.json"), "utf8")) as CatalogManifest;
  const entry = manifest.catalogs.find((c) => c.id === manifest.default);
  if (!entry) {
    console.error(`append-catalog-hash-to-release · catalog/manifest.json's default "${manifest.default}" isn't in its catalogs list.`);
    process.exit(1);
  }

  const body = run(["gh", "release", "view", tag, "--json", "body", "--jq", ".body"]);
  const nextBody = withCatalogNotesLine(body, entry.id, entry.hash);
  if (nextBody === body) {
    console.log(`append-catalog-hash-to-release · ${tag} already carries the catalog hash; nothing to do.`);
    return;
  }
  run(["gh", "release", "edit", tag, "--notes", nextBody]);
  console.log(`append-catalog-hash-to-release · added the catalog hash to ${tag}'s release notes.`);
}

main();
