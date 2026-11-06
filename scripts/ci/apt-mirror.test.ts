import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rewriteAptSource, rewriteUbuntuAptSources } from "./apt-mirror.ts";

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

test("changes only the active Azure URI in a deb822 source", () => {
  const source = "# http://azure.archive.ubuntu.com/ubuntu/\nTypes: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n";
  const result = rewriteAptSource(source, "sources");
  expect(result.text).toBe(source.replace("URIs: http://azure.archive.ubuntu.com/ubuntu/", "URIs: https://archive.ubuntu.com/ubuntu/"));
  expect(result.changed).toBe(1);
});

test("preserves legacy options, trailing slashes and security sources", () => {
  const source = "deb [arch=amd64 signed-by=/key.gpg] https://azure.archive.ubuntu.com/ubuntu noble main\ndeb http://security.ubuntu.com/ubuntu/ noble-security main\ndeb-src http://azure.archive.ubuntu.com/ubuntu/ noble universe\n";
  expect(rewriteAptSource(source, "list")).toEqual({
    text: source.replace("https://azure.archive.ubuntu.com/ubuntu", "https://archive.ubuntu.com/ubuntu").replace("http://azure.archive.ubuntu.com/ubuntu/", "https://archive.ubuntu.com/ubuntu/"),
    changed: 2, official: 0, unsupported: false,
  });
});

test("leaves comments, other hosts and nonstandard Azure paths alone", () => {
  const source = "# deb http://azure.archive.ubuntu.com/ubuntu noble main\ndeb https://azure.archive.ubuntu.com.evil.test/ubuntu noble main\ndeb http://azure.archive.ubuntu.com/ubuntu/extra noble main\n";
  const result = rewriteAptSource(source, "list");
  expect(result.text).toBe(source);
  expect(result.changed).toBe(0);
  expect(result.unsupported).toBe(true);
});

test("recognizes an already official active URI without changing it", () => {
  const source = "Types: deb\nURIs: https://archive.ubuntu.com/ubuntu/\nSuites: noble\n";
  expect(rewriteAptSource(source, "sources")).toEqual({ text: source, changed: 0, official: 1, unsupported: false });
});

test("does not silently treat a continuation URI as a supported layout", () => {
  const source = "Types: deb\nURIs:\n http://azure.archive.ubuntu.com/ubuntu/\nSuites: noble\n";
  expect(rewriteAptSource(source, "sources")).toEqual({ text: source, changed: 0, official: 0, unsupported: true });
});

test.each(["Enabled: no", "Enabled:\n no", "Enabled:\n # Continued after a comment.\n no"])("preserves a disabled deb822 stanza (%s), including unsupported inactive URIs", (enabled) => {
  const inactive = `# Keep disabled repositories untouched.\nTypes: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu/\n http://azure.archive.ubuntu.com/ubuntu/extra\n${enabled}\nSuites: noble\n`;
  const active = "Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu/\nEnabled: yes\nSuites: noble\n";
  const source = `${inactive}\n${active}`;
  const result = rewriteAptSource(source, "sources");
  expect(result).toEqual({ text: `${inactive}\n${active.replace("http://azure.archive.ubuntu.com/ubuntu/", "https://archive.ubuntu.com/ubuntu/")}`, changed: 1, official: 0, unsupported: false });
});

test("checks every source before writing, so an unsupported source cannot cause partial changes", () => {
  const root = mkdtempSync(join(tmpdir(), "studio-apt-")); temporary.push(root);
  mkdirSync(join(root, "sources.list.d"));
  const file = join(root, "sources.list");
  const original = "deb http://azure.archive.ubuntu.com/ubuntu noble main\n";
  writeFileSync(file, original);
  writeFileSync(join(root, "sources.list.d", "unknown.sources"), "URIs:\n http://azure.archive.ubuntu.com/ubuntu/\n");
  expect(() => rewriteUbuntuAptSources(root)).toThrow("unsupported");
  expect(readFileSync(file, "utf8")).toBe(original);
});

test("rewrites recognized source files and reports the actual state", () => {
  const root = mkdtempSync(join(tmpdir(), "studio-apt-")); temporary.push(root);
  mkdirSync(join(root, "sources.list.d"));
  const file = join(root, "sources.list.d", "ubuntu.sources");
  writeFileSync(file, "URIs: http://azure.archive.ubuntu.com/ubuntu/\nSuites: noble\n");
  expect(rewriteUbuntuAptSources(root)).toEqual({ state: "changed", files: 1, uris: 1 });
  expect(readFileSync(file, "utf8")).toBe("URIs: https://archive.ubuntu.com/ubuntu/\nSuites: noble\n");
  expect(rewriteUbuntuAptSources(root)).toEqual({ state: "already-official", files: 0, uris: 0 });
});

test("rejects unknown sources without printing or changing their potentially private URI", () => {
  const root = mkdtempSync(join(tmpdir(), "studio-apt-")); temporary.push(root);
  const file = join(root, "sources.list");
  const source = "deb https://private.test/ubuntu noble main\n";
  writeFileSync(file, source);
  expect(() => rewriteUbuntuAptSources(root)).toThrow("No recognized Azure Ubuntu apt source");
  expect(readFileSync(file, "utf8")).toBe(source);
});
