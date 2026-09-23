/**
 * The hash router: reads the location (never writes it, so S7a's boot and S13 see the link as opened) and
 * applies each route once, when the app mounts and whenever the hash or history changes.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { announce, commandRef, env, log, openShareLink, runCommand } from "@/contracts";
import { parseRoute, type Route, type RouteLocation } from "./routes";

function readLocation(): string {
  return typeof location === "undefined" ? "|/" : `${location.hash}|${location.pathname}`;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function toLocation(key: string): RouteLocation {
  const at = key.lastIndexOf("|");
  return { hash: key.slice(0, at), pathname: key.slice(at + 1) };
}

/** The current route, re-rendering when the hash or history changes. */
export function useRoute(): Route {
  const key = useSyncExternalStore(subscribe, readLocation, () => "|/");
  return useMemo(
    () => parseRoute(toLocation(key), { paths: !env.hashRouting, base: import.meta.env.BASE_URL ?? "/" }),
    [key],
  );
}

function say(text: string): void {
  log({ tag: "Note", text });
  announce(text);
}

/** Does what a route asks. Every route says what it did, or why it didn't. */
export async function applyRoute(route: Route): Promise<void> {
  switch (route.kind) {
    case "home":
      return;
    case "gallery":
      // Dev builds show the gallery instead of the composer; elsewhere there's none to show.
      if (!env.dev) say("There's no page at /__ui. Showing the sheet.");
      return;
    case "share":
      // S13 opens it (and says what happened); the whole fragment, "#s=1.…", as it stands in the address.
      openShareLink(route.link);
      return;
    case "open":
      say("Open diamond… arrives in v2.");
      return;
    case "settings":
      await runCommand(commandRef("settings.open"), "api");
      return;
    case "docs": {
      if (route.invalid !== undefined) say(`"${route.invalid}" isn't a problem code. Showing the help index.`);
      const help = route.code === undefined ? commandRef("help.open") : commandRef("help.open", { code: route.code });
      const opened = await runCommand(help, "api");
      if (opened.ok) await runCommand(commandRef("pane.show", { pane: "inspector" }), "api");
      return;
    }
    case "unknown":
      say(`There's no page at ${route.path}. Showing the sheet.`);
      return;
  }
}

/**
 * Applies the route whenever it changes (`useRoute` keeps one object per location). The work waits a tick,
 * so React's development double mount applies it once.
 */
export function useRouter(route: Route): void {
  useEffect(() => {
    const timer = setTimeout(() => void applyRoute(route), 0);
    return () => clearTimeout(timer);
  }, [route]);
}
