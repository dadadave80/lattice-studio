/**
 * Selector commands: choose an owner (Flow 4, SEL-01's Keep {A} and Route to {B}), clear an owner (SEL-04,
 * SEL-05), and leave a selector out of the diamond or bring it back (Flow 6, IR L145-L146).
 */
import { clearOwner, excludeSelector, includeSelector, routeSelector } from "@lattice-studio/core";
import { command, getCatalog, type CommandArgsOf } from "@/contracts";
import {
  catalogName, disabled, edit, err, facetOf, guard, isHex4, isPlaced, isString, notOnSheet, OK, ok, parseFacet,
  placedSelectors, resolveSelector, selectorLabel, summaryLine,
} from "./shared";

type RouteArgs = CommandArgsOf<"selector.route">;
type ClearOwnerArgs = CommandArgsOf<"selector.clearOwner">;
type ExcludeArgs = CommandArgsOf<"selector.exclude">;
type IncludeArgs = CommandArgsOf<"selector.include">;

const NAME_A_SELECTOR = "Name a selector";

export const routeCommand = command<RouteArgs>({
  id: "selector.route",
  title: ({ facet, verb }) => (verb === "keep" ? `Keep ${facet}` : `Route to ${facet}`),
  category: "Build",
  console: {
    verb: "route",
    syntax: "route <facet> <selector or function>",
    parse: (argv) => {
      if (argv.length !== 2) return err("route <facet> <selector or function> routes one selector; route <facet> takes them all.");
      const facet = parseFacet(argv[0], "route <facet> <selector or function>");
      if (!facet.ok) return facet;
      const catalog = getCatalog();
      const own = catalog ? (facetOf(catalog, facet.value)?.selectors ?? []) : [];
      const selector = resolveSelector(argv[1] ?? "", own, facet.value);
      return selector.ok ? ok({ selector: selector.value, facet: facet.value }) : selector;
    },
  },
  enabled(ctx, args) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    if (!isHex4(args.selector)) return disabled(NAME_A_SELECTOR);
    if (!isString(args.facet)) return disabled("Name the facet to route it to");
    if (!isPlaced(ctx.project, args.facet)) return disabled(notOnSheet([args.facet]));
    return OK;
  },
  run(ctx, { selector, facet }) {
    const catalog = ctx.catalog;
    if (!catalog) return;
    // Settling a collision narrates "Resolved: … routes to {facet}." (spec L713); anything else says the summary.
    edit((p) => routeSelector(p, catalog, selector, facet), { fallback: summaryLine });
  },
});

export const clearOwnerCommand = command<ClearOwnerArgs>({
  id: "selector.clearOwner",
  // SEL-04's fix reads "Remove it" (spec L314); SEL-05's stays "Clear owner".
  title: ({ verb }) => (verb === "remove" ? "Remove it" : "Clear owner"),
  category: "Build",
  enabled(ctx, args) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    if (!isHex4(args.selector)) return disabled(NAME_A_SELECTOR);
    return OK;
  },
  run(ctx, { selector }) {
    const catalog = ctx.catalog;
    if (!catalog) return;
    edit((p) => clearOwner(p, catalog, selector));
  },
});

/** A selector among the placed facets' selectors, as typed in the console. */
function parsePlacedSelector(typed: string | undefined) {
  if (typed === undefined) return err<`0x${string}`>(NAME_A_SELECTOR);
  const catalog = getCatalog();
  if (!catalog) return err<`0x${string}`>("The catalog hasn't loaded yet.");
  return resolveSelector(typed, placedSelectors(), "No facet on the sheet");
}

export const excludeCommand = command<ExcludeArgs>({
  id: "selector.exclude",
  title: ({ selector }) => `Leave ${selectorLabel(getCatalog(), selector)} out of the diamond`,
  category: "Build",
  console: {
    verb: "exclude",
    syntax: "exclude <selector or function>",
    parse: (argv) => {
      if (argv.length !== 1) return err("exclude takes one selector: exclude <selector or function>");
      const selector = parsePlacedSelector(argv[0]);
      return selector.ok ? ok({ selector: selector.value }) : selector;
    },
  },
  enabled(ctx, args) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    if (!isHex4(args.selector)) return disabled(NAME_A_SELECTOR);
    return OK;
  },
  run(ctx, { selector }) {
    const catalog = ctx.catalog;
    if (!catalog) return;
    edit((p) => excludeSelector(p, catalog, selector));
  },
});

export const includeCommand = command<IncludeArgs>({
  id: "selector.include",
  title: ({ selector, facet }) =>
    facet ? `Bring ${selectorLabel(getCatalog(), selector)} back, routed to ${facet}` : `Bring ${selectorLabel(getCatalog(), selector)} back`,
  category: "Build",
  console: {
    verb: "include",
    syntax: "include <selector or function> [facet]",
    parse: (argv) => {
      if (argv.length < 1 || argv.length > 2) return err("include <selector or function> [facet]");
      const selector = parsePlacedSelector(argv[0]);
      if (!selector.ok) return selector;
      if (argv[1] === undefined) return ok({ selector: selector.value });
      const facet = parseFacet(argv[1], "include <selector or function> [facet]");
      return facet.ok ? ok({ selector: selector.value, facet: facet.value }) : facet;
    },
  },
  enabled(ctx, args) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    if (!isHex4(args.selector)) return disabled(NAME_A_SELECTOR);
    if (args.facet !== undefined) {
      if (!isString(args.facet)) return disabled("Name the facet to route it to");
      if (ctx.catalog && !facetOf(ctx.catalog, args.facet)) return disabled(`‘${args.facet}’ isn't a facet in ${catalogName(ctx.catalog)}.`);
    }
    return OK;
  },
  run(ctx, { selector, facet }) {
    const catalog = ctx.catalog;
    if (!catalog) return;
    edit((p) => includeSelector(p, catalog, selector, facet));
  },
});
