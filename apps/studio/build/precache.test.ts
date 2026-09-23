import { describe, expect, test } from "bun:test";
import { splitPrecache, type GraphNode } from "./precache.ts";

const nm = (pkg: string, file = "index.js") => `/repo/node_modules/${pkg}/${file}`;

function node(file: string, parts: Partial<GraphNode> = {}): GraphNode {
  return { file, isEntry: false, moduleIds: [], imports: [], lazyRefs: [], ...parts };
}

describe("splitPrecache", () => {
  test("leaves out ELK and WalletConnect chunks and what only they load", () => {
    const graph = [
      node("assets/index.js", {
        isEntry: true,
        moduleIds: ["/repo/apps/studio/src/main.tsx", nm("react")],
        imports: ["assets/vendor.js"],
        lazyRefs: ["assets/index.css", "assets/layout.js", "assets/wallet.js", "assets/uses-shared.js"],
      }),
      node("assets/vendor.js", { moduleIds: [nm("zustand")] }),
      node("assets/index.css"),
      node("assets/layout.js", { moduleIds: ["/repo/apps/studio/src/layout/auto.ts"], lazyRefs: ["assets/elk.bundled.js"] }),
      node("assets/elk.bundled.js", { moduleIds: [nm("elkjs", "lib/elk.bundled.js")], lazyRefs: ["assets/elk-worker.min.js"] }),
      node("assets/elk-worker.min.js"),
      node("assets/wallet.js", { moduleIds: ["/repo/apps/studio/src/chain/wallet.ts", nm("wagmi")], lazyRefs: ["assets/wc.js"] }),
      node("assets/wc.js", { moduleIds: [nm("@walletconnect/ethereum-provider")], imports: ["assets/wc-deps.js", "assets/shared.js"] }),
      node("assets/wc-deps.js", { moduleIds: [nm("@reown/appkit"), nm("pino")] }),
      node("assets/shared.js", { moduleIds: [nm("@noble/hashes")] }),
      node("assets/uses-shared.js", { moduleIds: ["/repo/apps/studio/src/x.ts"], imports: ["assets/shared.js"] }),
    ];
    const split = splitPrecache(graph);
    expect(split.excluded).toEqual(["assets/elk-worker.min.js", "assets/elk.bundled.js", "assets/wc-deps.js", "assets/wc.js"]);
    expect(split.eager).toEqual([]);
    // First-party lazy chunks, the wallet stack and a dependency shared with first-party code stay precached.
    for (const kept of ["assets/layout.js", "assets/wallet.js", "assets/shared.js", "assets/index.css"]) {
      expect(split.excluded).not.toContain(kept);
    }
  });

  test("a chunk only excluded chunks load is excluded however deep it sits", () => {
    const graph = [
      node("entry.js", { isEntry: true, lazyRefs: ["elk.js"] }),
      node("elk.js", { moduleIds: [nm("elkjs")], lazyRefs: ["a.js"] }),
      node("a.js", { imports: ["b.js"] }),
      node("b.js", { lazyRefs: ["c.js"] }),
      node("c.js"),
    ];
    expect(splitPrecache(graph).excluded).toEqual(["a.js", "b.js", "c.js", "elk.js"]);
  });

  test("never leaves out what the entry loads at startup, and reports it", () => {
    const graph = [
      node("entry.js", { isEntry: true, imports: ["wc.js"] }),
      node("wc.js", { moduleIds: [nm("@walletconnect/core")] }),
    ];
    expect(splitPrecache(graph)).toEqual({ excluded: [], eager: ["wc.js"] });
  });

  test("keeps every chunk when neither library is in the build", () => {
    const graph = [node("entry.js", { isEntry: true, lazyRefs: ["a.js"] }), node("a.js", { moduleIds: ["/src/a.ts"] })];
    expect(splitPrecache(graph).excluded).toEqual([]);
  });

  test("matches Windows paths too", () => {
    const graph = [
      node("entry.js", { isEntry: true, lazyRefs: ["elk.js"] }),
      node("elk.js", { moduleIds: ["C:\\repo\\node_modules\\elkjs\\lib\\main.js"] }),
    ];
    expect(splitPrecache(graph).excluded).toEqual(["elk.js"]);
  });
});
