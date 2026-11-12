import { expect, test } from "bun:test";
import { prepareCliPackage } from "./prepare-cli-package.ts";

test("removes private and bundled workspace dependencies while retaining public package metadata", () => {
  const manifest = {
    name: "lattice-studio",
    version: "0.2.0-dev.1794443077.gabcdef",
    private: true,
    repository: { type: "git", url: "git+https://github.com/dadadave80/lattice-studio.git", directory: "packages/cli" },
    bin: { "lattice-studio": "./dist/main.js" },
    files: ["dist", "README.md"],
    scripts: { build: "bun build src/main.ts" },
    dependencies: { "@lattice-studio/core": "workspace:*", viem: "^2.56.8" },
    devDependencies: { "@lattice-studio/catalog-gen": "workspace:^", typescript: "~6.0.3" },
    peerDependencies: { "@lattice-studio/other": "workspace:~", react: "^19.0.0" },
  };
  const original = structuredClone(manifest);
  expect(prepareCliPackage(manifest)).toEqual({
    name: manifest.name,
    version: manifest.version,
    repository: manifest.repository,
    bin: manifest.bin,
    files: manifest.files,
    scripts: manifest.scripts,
    dependencies: { viem: "^2.56.8" },
    devDependencies: { typescript: "~6.0.3" },
    peerDependencies: { react: "^19.0.0" },
  });
  expect(manifest).toEqual(original);
});

test("handles absent dependency fields and repeated preparation", () => {
  const manifest = { name: "lattice-studio", version: "0.2.0" };
  expect(prepareCliPackage(manifest)).toEqual(manifest);
  expect(prepareCliPackage(prepareCliPackage(manifest))).toEqual(manifest);
});

test("rejects malformed package metadata rather than producing a broken publication", () => {
  for (const manifest of [null, [], "package", { dependencies: [] }, { dependencies: null }, { dependencies: { viem: 3 } }]) {
    expect(() => prepareCliPackage(manifest)).toThrow();
  }
});
