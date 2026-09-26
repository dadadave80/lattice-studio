import { describe, expect, test } from "bun:test";
import { attribute, BROWSER_WORK, scriptName } from "./profile.ts";
import { decodeMap } from "./sourcemap.ts";
import type { Profile } from "./types.ts";

// One generated line: columns 0-9 map to a.ts line 1, from column 10 to d3-drag's line 3.
const MAP = decodeMap({ sources: ["packages/core/src/layout/geometry.ts", "node_modules/d3-drag/src/drag.js"], mappings: "AAAA,UCEA" });

describe("attribute", () => {
  const profile: Profile = {
    label: "drag",
    total: 100,
    frames: [
      { url: "", line: -1, column: -1, fn: "(idle)", self: 50 },
      { url: "", line: -1, column: -1, fn: "(program)", self: 20 },
      { url: "http://localhost:1/assets/index-a.js", line: 0, column: 4, fn: "ud", self: 15 },
      { url: "http://localhost:1/assets/index-a.js", line: 0, column: 12, fn: "t", self: 10 },
      { url: "http://localhost:1/assets/other.js", line: 0, column: 0, fn: "x", self: 3 },
      { url: "", line: -1, column: -1, fn: "getBoundingClientRect", self: 2 },
    ],
  };
  const a = attribute(profile, (script) => (script === "index-a.js" ? MAP : null));

  test("idle isn't busy; browser work, native calls and unmapped scripts are named as such", () => {
    expect(a.busy).toBe(50);
    expect(a.bySource.map((s) => s.name)).toEqual([
      BROWSER_WORK,
      "packages/core/src/layout/geometry.ts",
      "node_modules/d3-drag/src/drag.js",
      "other.js (unmapped)",
      "(native getBoundingClientRect)",
    ]);
  });

  test("groups follow the composition's, and lines name where each function starts", () => {
    expect(a.byGroup.find((g) => g.name === "core/layout")?.ms).toBe(15);
    expect(a.byGroup.find((g) => g.name === "d3-drag")?.ms).toBe(10);
    expect(a.byLine[0]).toEqual({ name: "packages/core/src/layout/geometry.ts:1", ms: 15 });
    expect(a.byLine[1]).toEqual({ name: "node_modules/d3-drag/src/drag.js:3", ms: 10 });
  });

  test("scriptName", () => {
    expect(scriptName("http://localhost:20200/assets/index-B4.js?v=1")).toBe("index-B4.js");
    expect(scriptName("perf-analysis.js")).toBe("perf-analysis.js");
  });
});
