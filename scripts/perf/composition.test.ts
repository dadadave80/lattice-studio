import { describe, expect, test } from "bun:test";
import { compose, groupOf, Q19_OPTIONS } from "./composition.ts";
import type { CompositionResult } from "./types.ts";

describe("groupOf", () => {
  test.each([
    ["node_modules/react-dom/cjs/react-dom-client.production.js", "react-dom"],
    ["node_modules/@xyflow/react/dist/esm/index.js", "@xyflow/react"],
    ["node_modules/@base-ui/react/menu/root/MenuRoot.mjs", "@base-ui/react/menu"],
    ["node_modules/@base-ui/react/esm/tooltip/root/TooltipRoot.js", "@base-ui/react/tooltip"],
    ["node_modules/@base-ui/react/merge-props/mergeProps.mjs", "@base-ui/react/merge-props"],
    ["node_modules/.pnpm/x/node_modules/d3-zoom/src/zoom.js", "d3-zoom"],
    ["packages/core/src/checks/sel.ts", "core/checks"],
    ["packages/core/src/index.ts", "core/index"],
    ["apps/studio/src/state/document-store.ts", "app/state"],
    ["apps/studio/src/sheet/card/FacetCard.tsx", "app/sheet/card"],
    ["apps/studio/src/main.tsx", "app/main"],
    ["packages/tokens/dist/index.js", "tokens"],
    ["rolldown/runtime.js", "other"],
  ])("%s → %s", (id, group) => {
    expect(groupOf(id)).toBe(group);
  });
});

describe("Q19 options", () => {
  const option = (name: string) => Q19_OPTIONS.find((o) => o.name.includes(name));
  test("the sheet covers React Flow, d3 and the app's sheet folder", () => {
    const sheet = option("sheet");
    expect(sheet?.matches("node_modules/@xyflow/system/dist/esm/index.js")).toBe(true);
    expect(sheet?.matches("node_modules/d3-drag/src/drag.js")).toBe(true);
    expect(sheet?.matches("apps/studio/src/sheet/card/FacetCard.tsx")).toBe(true);
    expect(sheet?.matches("apps/studio/src/shell/Shell.tsx")).toBe(false);
  });
  test("analysis covers core's analysis and checks and the document commands", () => {
    const analysis = option("analysis");
    expect(analysis?.matches("packages/core/src/checks/sel.ts")).toBe(true);
    expect(analysis?.matches("apps/studio/src/state/cmd/facets.ts")).toBe(true);
    expect(analysis?.matches("packages/core/src/canonical/hash.ts")).toBe(false);
  });
  test("popups cover Base UI's menus, tooltips, positioning and Floating UI, not its buttons", () => {
    const popups = option("popups");
    expect(popups?.matches("node_modules/@base-ui/react/menu/root/MenuRoot.mjs")).toBe(true);
    expect(popups?.matches("node_modules/@base-ui/react/floating-ui-react/hooks/useFloating.mjs")).toBe(true);
    expect(popups?.matches("node_modules/@floating-ui/dom/dist/floating-ui.dom.mjs")).toBe(true);
    expect(popups?.matches("node_modules/@base-ui/react/button/Button.mjs")).toBe(false);
  });
});

describe("compose", () => {
  const result: CompositionResult = {
    entryFile: "assets/index-a.js",
    recordEntryFile: "assets/index-a.js",
    firstLoad: ["assets/index-a.js", "assets/runtime-b.js"],
    unmatched: [],
    chunks: [
      {
        file: "assets/index-a.js",
        isEntry: true,
        imports: ["assets/runtime-b.js"],
        raw: 1000,
        gz: 300,
        modules: [
          { id: "node_modules/react-dom/index.js", rendered: 500, gz: 200 },
          { id: "node_modules/@xyflow/react/dist/esm/index.js", rendered: 300, gz: 100 },
          { id: "apps/studio/src/sheet/card/FacetCard.tsx", rendered: 100, gz: 100 },
        ],
      },
      { file: "assets/runtime-b.js", isEntry: false, imports: [], raw: 10, gz: 10, modules: [] },
      { file: "assets/lazy-c.js", isEntry: false, imports: [], raw: 99, gz: 50, modules: [] },
    ],
  };

  test("splits each first-load chunk's measured size by module share; lazy chunks don't count", () => {
    const c = compose(result, new Map([["assets/index-a.js", 400]]));
    expect(c.total).toBe(410);
    expect(c.chunks).toEqual([
      { name: "assets/index-a.js", gz: 400 },
      { name: "assets/runtime-b.js", gz: 10 },
    ]);
    expect(c.groups[0]).toEqual({ name: "react-dom", gz: 200 });
    expect(c.options.find((o) => o.name.includes("sheet"))?.gz).toBe(200);
    expect(c.matchesRecord).toBe(true);
  });

  test("a different entry or an unmatched chunk means the composition isn't the build of record's", () => {
    expect(compose({ ...result, recordEntryFile: "assets/index-z.js" }).matchesRecord).toBe(false);
    expect(compose({ ...result, unmatched: ["assets/x.js"] }).matchesRecord).toBe(false);
  });
});
