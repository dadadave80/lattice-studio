/**
 * The app's routes (S3 owns every one). Pure: the location in, the route out.
 *
 * - `#/` or `/`: the composer.
 * - `#s=1.…`: a share link (Flow 10), opened by S13.
 * - `#open=eip155:11155111:0x…`: a live diamond (Flow 15, v2).
 * - `#/__ui`: S0's primitives gallery, in dev builds only.
 * - `#/docs` and `#/docs/problems/SEL-01`: the help index and a problem's page (spec L905, IR L124), in the
 *   inspector. A code that isn't one opens the index.
 * - `#/settings`: Settings.
 *
 * Share and open links live in the hash so they never reach a server. The other routes are also read from the
 * path (`/docs/problems/SEL-01`), which the Vercel build serves, unless routes live only in the hash (the IPFS
 * build, `env.hashRouting`).
 */
import { isProblemCode, type ProblemCode } from "@lattice-studio/core";

export type Route =
  | { kind: "home" }
  | { kind: "share"; link: string }
  | { kind: "open"; target: string }
  | { kind: "gallery" }
  | { kind: "docs"; code?: ProblemCode; invalid?: string }
  | { kind: "settings" }
  | { kind: "unknown"; path: string };

export type RouteLocation = { hash: string; pathname: string };

export type RouteOptions = {
  /** Read routes from the path as well as the hash (false in the IPFS build). */
  paths: boolean;
  /** The app's base path ("/" on Vercel). */
  base: string;
};

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The path under the app's base: "/docs/problems/SEL-01" for "/studio/docs/problems/SEL-01" under "/studio/". */
function underBase(pathname: string, base: string): string {
  const root = base.endsWith("/") ? base : `${base}/`;
  if (root.startsWith("/") && pathname.startsWith(root)) return `/${pathname.slice(root.length)}`;
  return pathname;
}

/** A route path ("/docs/problems/SEL-01") as a route. */
export function routeForPath(path: string): Route {
  const parts = decode(path)
    .split("/")
    .filter((part) => part !== "");
  const [first, second, third, ...rest] = parts;
  if (first === undefined) return { kind: "home" };
  if (first === "__ui" && second === undefined) return { kind: "gallery" };
  if (first === "settings" && second === undefined) return { kind: "settings" };
  if (first === "docs") {
    if (second === undefined || (second === "problems" && third === undefined)) return { kind: "docs" };
    if (second === "problems" && third !== undefined && rest.length === 0) {
      const code = third.toUpperCase();
      return isProblemCode(code) ? { kind: "docs", code } : { kind: "docs", invalid: third };
    }
  }
  return { kind: "unknown", path: `/${parts.join("/")}` };
}

/** Which route a location names. The hash wins; an empty hash reads the path when routes live there. */
export function parseRoute({ hash, pathname }: RouteLocation, options: RouteOptions): Route {
  if (hash.startsWith("#s=")) return { kind: "share", link: hash.slice(1) };
  if (hash.startsWith("#open=")) return { kind: "open", target: decode(hash.slice("#open=".length)) };
  if (hash.startsWith("#/")) return routeForPath(hash.slice(1));
  if (options.paths) return routeForPath(underBase(pathname, options.base));
  return { kind: "home" };
}
