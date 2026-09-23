import { describe, expect, test } from "bun:test";
import { parseRoute, routeForPath } from "./routes";

const hashOnly = { paths: false, base: "./" };
const withPaths = { paths: true, base: "/" };

describe("routes", () => {
  test("the empty hash and #/ are the composer", () => {
    expect(parseRoute({ hash: "", pathname: "/" }, withPaths)).toEqual({ kind: "home" });
    expect(parseRoute({ hash: "#/", pathname: "/" }, withPaths)).toEqual({ kind: "home" });
    expect(parseRoute({ hash: "#sheet", pathname: "/" }, withPaths)).toEqual({ kind: "home" });
  });

  test("share and open links stay whole", () => {
    expect(parseRoute({ hash: "#s=1.eJyrVkrLz1eyUkpKLFKqBQAvRQVn", pathname: "/" }, withPaths)).toEqual({
      kind: "share", link: "#s=1.eJyrVkrLz1eyUkpKLFKqBQAvRQVn",
    });
    expect(parseRoute({ hash: "#open=eip155:11155111:0xabc", pathname: "/" }, hashOnly)).toEqual({
      kind: "open", target: "eip155:11155111:0xabc",
    });
  });

  test("problem docs: a code opens its page, anything else the index", () => {
    expect(routeForPath("/docs/problems/SEL-01")).toEqual({ kind: "docs", code: "SEL-01" });
    expect(routeForPath("/docs/problems/sel-01")).toEqual({ kind: "docs", code: "SEL-01" });
    expect(routeForPath("/docs/problems/XYZ-99")).toEqual({ kind: "docs", invalid: "XYZ-99" });
    expect(routeForPath("/docs")).toEqual({ kind: "docs" });
    expect(routeForPath("/docs/problems/")).toEqual({ kind: "docs" });
  });

  test("the gallery, settings and unknown paths", () => {
    expect(routeForPath("/__ui")).toEqual({ kind: "gallery" });
    expect(routeForPath("/settings")).toEqual({ kind: "settings" });
    expect(routeForPath("/nowhere/at/all")).toEqual({ kind: "unknown", path: "/nowhere/at/all" });
  });

  test("paths count only where routes live outside the hash", () => {
    expect(parseRoute({ hash: "", pathname: "/docs/problems/NET-06" }, withPaths)).toEqual({ kind: "docs", code: "NET-06" });
    expect(parseRoute({ hash: "", pathname: "/ipfs/bafy/docs" }, hashOnly)).toEqual({ kind: "home" });
    expect(parseRoute({ hash: "#/docs/problems/NET-06", pathname: "/ipfs/bafy/" }, hashOnly)).toEqual({
      kind: "docs", code: "NET-06",
    });
    expect(parseRoute({ hash: "", pathname: "/studio/settings" }, { paths: true, base: "/studio/" })).toEqual({
      kind: "settings",
    });
  });
});
