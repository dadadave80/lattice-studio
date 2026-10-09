/**
 * Facet commands: place (Flow 3, spec L413-L430), remove (IR L143, spec L733) and route a facet's contested
 * selectors to it (`route <facet>`, IR L144). What they do is in `run/facets.ts`, loaded after the first paint.
 */
import { isCoreFacet, plural } from "@lattice-studio/core";
import { command, type CommandArgsOf } from "@/contracts";
import { lazyRun } from "./lazy";
import {
  catalogName, disabled, err, facetOf, guard, isPlaced, isString, notOnSheet, OK, ok, parseFacet, resolveFacetName,
} from "./shared";

type PlaceArgs = CommandArgsOf<"facet.place">;
type RemoveArgs = CommandArgsOf<"facet.remove">;
type RouteContestedArgs = CommandArgsOf<"facet.routeContested">;

export const placeCommand = command<PlaceArgs>({
  id: "facet.place",
  title: ({ facet }) => `Place ${facet}`,
  category: "Build",
  console: {
    verb: "place",
    aliases: ["add"],
    syntax: "place <facet>",
    parse: (argv) => {
      if (argv.length > 1) return err("place takes one facet: place <facet>");
      const facet = parseFacet(argv[0], "place <facet>");
      return facet.ok ? ok({ facet: facet.value }) : facet;
    },
  },
  enabled(ctx, args) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    if (!isString(args.facet)) return disabled("Name a facet to place");
    if (ctx.catalog && !facetOf(ctx.catalog, args.facet)) {
      return disabled(`‘${args.facet}’ isn't a facet in ${catalogName(ctx.catalog)}.`);
    }
    return OK;
  },
  run: lazyRun("place"),
});

export const removeCommand = command<RemoveArgs>({
  id: "facet.remove",
  title: ({ facets }) => (facets.length === 1 ? `Remove ${facets[0] ?? ""}` : `Remove ${plural(facets.length, "facet")}`),
  category: "Build",
  console: {
    verb: "remove",
    aliases: ["rm"],
    syntax: "remove <facet>",
    parse: (argv) => (argv.length === 0 ? err("Name a facet to remove: remove <facet>") : ok({ facets: argv.map(resolveFacetName) })),
  },
  enabled(ctx, args) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    const facets = Array.isArray(args.facets) ? args.facets.filter(isString) : [];
    if (facets.length === 0) return disabled("Select a facet to remove");
    // The core never leaves the diamond (the op says the same when asked).
    const cards = facets.filter((name) => !isCoreFacet(name));
    if (cards.length === 0) return disabled(`${facets[0] ?? ""} is the diamond's core and stays`);
    if (!cards.some((name) => isPlaced(ctx.project, name))) return disabled(notOnSheet(cards));
    return OK;
  },
  run: lazyRun("remove"),
});

export const routeContestedCommand = command<RouteContestedArgs>({
  id: "facet.routeContested",
  title: ({ facet }) => `Route contested selectors to ${facet}`,
  category: "Build",
  console: {
    verb: "route",
    syntax: "route <facet>",
    parse: (argv) => {
      if (argv.length !== 1) return err("route <facet> takes one facet; route <facet> <selector> routes one selector.");
      const facet = parseFacet(argv[0], "route <facet>");
      return facet.ok ? ok({ facet: facet.value }) : facet;
    },
  },
  enabled(ctx, args) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    if (!isString(args.facet)) return disabled("Name a facet to route to");
    if (!isPlaced(ctx.project, args.facet)) return disabled(notOnSheet([args.facet]));
    return OK;
  },
  run: lazyRun("routeContested"),
});
