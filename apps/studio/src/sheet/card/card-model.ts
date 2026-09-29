/**
 * What a facet card shows, derived from the catalog, the analysis and the document (spec L451-L455, L479-L481,
 * L745-L746, IR L103-L105). Pure: the component renders this and nothing else decides a pin's state, a tooltip
 * or a border, so every rule here is covered by `card-model.test.ts`.
 */
import type {
  Analysis, Catalog, CardSize, CommandRef, Facet, Hex4, LayoutMetrics, Problem, Route,
} from "@lattice-studio/core";
import { cardSize, contestedSelectors, formatCount, plural } from "@lattice-studio/core";
import { commandRef } from "@/contracts/command-args";

/**
 * A pin row's state (IR L104): routed here (cut accent), not in the diamond (hollow, grey, struck), served by
 * another facet ("→ GovernedVault"), contested (hatched), owner by default (dot), seam (lock). `unchecked`: the
 * analysis has no route for it yet (the catalog or the checks are still loading), so a click has nothing to do.
 */
export type PinState = "routed" | "excluded" | "elsewhere" | "contested" | "default" | "seam" | "unchecked";

/** A tooltip line: an optional leading code span (a signature), then text. Never literal backticks. */
export type TooltipCopy = { code?: string; text: string };

export type PinView = {
  selector: Hex4;
  signature: string;
  /** The function name: "transfer". */
  name: string;
  state: PinState;
  /** Routed to this card (a seam this facet serves, too). */
  here: boolean;
  /** Who serves it when that isn't obvious from `state`: elsewhere, seam, default. */
  owner?: string;
  /** The short text after the name: the hex, "→ GovernedVault" or "Seam: stays on GovernedVault". */
  mark: string;
  /** What a click does (Flow 6). */
  tooltip: TooltipCopy;
  /** The selector's accessible name where it is spelled out in full: signature, hex and state in words. */
  label: string;
  /** The card row's accessible name: the drawn words ("name mark"), then `label`, so it contains the visible text. */
  rowLabel: string;
  /** What a click or Space runs; null on a seam, which offers no route (IR L104). */
  action: CommandRef | null;
};

/** default, hover and selected are drawn from these plus CSS; caution is dashed, conflict 2 px accent. */
export type CardBorder = "default" | "caution" | "conflict";

export type CardView = {
  facet: string;
  source: string;
  pins: "left" | "right";
  expanded: boolean;
  compact: boolean;
  /** Token-computed size (C9), never measured (spec L824). */
  size: CardSize;
  /** The rows the card draws, in the facet's order (C9's `visibleSelectors`). */
  rows: PinView[];
  /** Every selector, for the compact tick strip. */
  all: PinView[];
  /** Rows behind "+ n more". */
  hidden: number;
  /** More than `expandThreshold` selectors: the card offers "+ n more" or Collapse. */
  collapsible: boolean;
  border: CardBorder;
  /** "Not on Base Sepolia". */
  chips: string[];
  /** "erc7201:lattice.storage.ERC20", "reads .Pausable · .ERC20" or "no storage". */
  footer: string;
  /** "12/17 selectors" (PA L56). */
  count: string;
  /** "ERC20, 9 selectors, 4 served by other facets" (spec L745). */
  name: string;
  /** Connections and problems in words, without the selection state (see `describeCard`). */
  connections: string;
};

/** The part of the analysis one card reads: a card re-renders only when this changes (spec L825). */
export type CardAnalysis = {
  routes: Partial<Record<Hex4, Route>>;
  /** Problems anchored on this facet or one of its selectors, and NET-03s that name it. */
  problems: Problem[];
  /** Its unresolved collisions (SEL-01), C9's `contestedSelectors`. */
  contested: Hex4[];
  /** Everything above as one string, for a cheap equality check. */
  key: string;
};

function anchorsFacet(problem: Problem, facet: string): boolean {
  return problem.where.some(
    (a) => (a.kind === "facet" && a.facet === facet) || (a.kind === "selector" && a.facet === facet),
  );
}

function netMissing(problem: Problem, facet: string): boolean {
  const missing = problem.params["missing"];
  return problem.code === "NET-03" && Array.isArray(missing) && missing.includes(facet);
}

function routeKey(route: Route | undefined): string {
  return route ? `${route.owner ?? ""}/${route.via}/${route.contenders.join(",")}` : "-";
}

/** The slice of `analysis` the card for `facet` reads. */
export function cardAnalysis(analysis: Analysis, facet: Facet): CardAnalysis {
  const routes: Partial<Record<Hex4, Route>> = {};
  for (const { hex } of facet.selectors) {
    const route = analysis.routing[hex];
    if (route) routes[hex] = route;
  }
  const problems = analysis.problems.filter((p) => anchorsFacet(p, facet.name) || netMissing(p, facet.name));
  const contested = contestedSelectors(analysis, facet.name);
  const key = [
    facet.selectors.map((s) => routeKey(routes[s.hex])).join(";"),
    problems.map((p) => `${p.id}|${p.severity}|${p.message}|${JSON.stringify(p.params)}`).join(";"),
    contested.join(","),
  ].join("#");
  return { routes, problems, contested, key };
}

export function sameCardAnalysis(a: CardAnalysis, b: CardAnalysis): boolean {
  return a.key === b.key;
}

/** "transfer(address,uint256)" → "transfer". */
export function functionName(signature: string): string {
  const open = signature.indexOf("(");
  return open < 0 ? signature : signature.slice(0, open);
}

function joinWith(items: readonly string[], word: "and" | "or"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${word} ${items.at(-1)}`;
}

/**
 * The rows a card draws, C9's rule exactly (`layout/rows.ts` `visibleSelectors`, which core doesn't export):
 * all of them when expanded or when there are no more than `expandThreshold`; collapsed, every contested
 * selector plus the facet's others in order, up to `collapsedRows`. Traces anchor on these rows.
 */
export function visibleRows(facet: Facet, expanded: boolean, contested: readonly Hex4[], metrics: LayoutMetrics): Hex4[] {
  const all = facet.selectors.map((s) => s.hex);
  if (expanded || all.length <= metrics.expandThreshold) return all;
  const isContested = new Set(contested);
  const keep = new Set(all.filter((s) => isContested.has(s)));
  for (const s of all) {
    if (keep.size >= metrics.collapsedRows) break;
    keep.add(s);
  }
  return all.filter((s) => keep.has(s));
}

/** The facet names in the pin copy: seams keep the reason's wording (contracts §3.1 seam ruling). */
function seamReason(catalog: Catalog, selector: Hex4, owner: string): string | undefined {
  return catalog.seams.find((s) => s.selector === selector && s.anyOf.includes(owner))?.reason;
}

type PinInputs = {
  facet: string;
  selector: { hex: Hex4; signature: string };
  route: Route | undefined;
  excluded: boolean;
  catalog: Catalog;
};

/**
 * One pin's state, copy and action (Flow 6, IR L104). `label` names the selector wherever it is spelled out in
 * full (the Structure tree); `rowLabel` names the card's row, which starts with the words the row draws, the short
 * name and its mark ("transfer → ERC20"), so the visible text is inside the name (WCAG 2.5.3, spec L779).
 */
export function pinView(inputs: PinInputs): PinView {
  const view = pinStates(inputs);
  return { ...view, rowLabel: `${view.name} ${view.mark}, ${view.label}` };
}

function pinStates({ facet, selector, route, excluded, catalog }: PinInputs): Omit<PinView, "rowLabel"> {
  const { hex, signature } = selector;
  const name = functionName(signature);
  const base = { selector: hex, signature, name };
  const described = (state: string) => `${signature} ${hex}, ${state}`;

  if (excluded) {
    return {
      ...base, state: "excluded", here: false, mark: hex,
      tooltip: { text: "Not in the diamond. Click to route here." },
      label: described("not in the diamond"),
      action: commandRef("selector.include", { selector: hex, facet }),
    };
  }
  if (route === undefined) {
    return {
      ...base, state: "unchecked", here: false, mark: hex,
      tooltip: { text: "Not checked yet." },
      label: described("not checked yet"),
      action: null,
    };
  }
  const owner = route.owner;
  if (route.via === "seam" && owner !== undefined) {
    const reason = seamReason(catalog, hex, owner);
    const why = reason ? ` because its version ${reason}` : "";
    const here = owner === facet;
    return {
      ...base, state: "seam", here, owner, mark: `Seam: stays on ${owner}`,
      tooltip: { text: `Seam: stays on ${owner}${why}.` },
      label: described(`seam: stays on ${owner}`),
      action: null,
    };
  }
  if (owner === undefined) {
    // Not excluded and no owner: a choice still to make (SEL-01, or one family's CORE-03/DEP-03).
    const others = route.contenders.filter((c) => c !== facet);
    const rivals = others.length > 0 ? `Collides with ${joinWith(others, "and")}. ` : "";
    return {
      ...base, state: "contested", here: false, mark: hex,
      tooltip: { text: `${rivals}Click to route here.` },
      label: described(others.length > 0 ? `contested with ${joinWith(others, "and")}` : "contested"),
      action: commandRef("selector.route", { selector: hex, facet }),
    };
  }
  if (owner !== facet) {
    return {
      ...base, state: "elsewhere", here: false, owner, mark: `→ ${owner}`,
      tooltip: { text: `Served by ${owner}. Click to route here instead.` },
      label: described(`served by ${owner}`),
      action: commandRef("selector.route", { selector: hex, facet }),
    };
  }
  if (route.via === "default") {
    // "Click to change" changes the owner (contracts §6 ruling): with one rival, route to it; with more, the
    // per-selector owner choice (S4c's Choose per selector…) picks among them (spec L303, L436).
    const others = route.contenders.filter((c) => c !== facet);
    const [only] = others;
    return {
      ...base, state: "default", here: true, owner, mark: hex,
      tooltip: { text: "Owner by default. Click to change." },
      label: described("routes here, owner by default"),
      action:
        others.length === 1 && only !== undefined
          ? commandRef("selector.route", { selector: hex, facet: only })
          : commandRef("collision.choosePerSelector", { selectors: [hex] }),
    };
  }
  return {
    ...base, state: "routed", here: true, mark: hex,
    tooltip: { code: signature, text: ": routes here. Click to leave it out of the diamond." },
    label: described("routes here"),
    action: commandRef("selector.exclude", { selector: hex }),
  };
}

/** "erc7201:lattice.storage.ERC20", else "reads .Pausable · .ERC20", else "no storage" (IR L103). */
export function footerText(facet: Facet): string {
  if (facet.storage) return `erc7201:${facet.storage.id}`;
  if (facet.touches.length === 0) return "no storage";
  return `reads ${facet.touches.map((ns) => `.${ns.split(".").at(-1) ?? ns}`).join(" · ")}`;
}

/** Blockers where facets fight over something: a selector, a seam, a namespace, a family's one slot. */
const CONFLICT_CODES: ReadonlySet<string> = new Set(["SEL-01", "SEM-01", "STO-01", "CORE-03", "DEP-03"]);

/**
 * The border (IR L103): conflict (2 px accent) when the facet is party to a conflict; caution (dashed) for any
 * other blocker or warning on it, such as a missing dependency (DEP-01, Flow 5) or a convention (DEP-02, "the
 * same way as a warning"). Info draws nothing.
 */
export function cardBorder(slice: CardAnalysis, facet: string): CardBorder {
  const own = slice.problems.filter((p) => anchorsFacet(p, facet) && p.severity !== "info");
  if (slice.contested.length > 0 || own.some((p) => p.severity === "blocker" && CONFLICT_CODES.has(p.code))) return "conflict";
  return own.length > 0 ? "caution" : "default";
}

/** "ERC20, 9 selectors, 4 served by other facets" (spec L745), with the other counts when they're not zero. */
export function cardName(facet: string, all: readonly PinView[]): string {
  const count = (states: PinState[], elsewhereSeam = false) =>
    all.filter((p) => states.includes(p.state) || (elsewhereSeam && p.state === "seam" && !p.here)).length;
  const elsewhere = count(["elsewhere"], true);
  const excluded = count(["excluded"]);
  const contested = count(["contested"]);
  const parts = [facet, plural(all.length, "selector")];
  if (elsewhere > 0) parts.push(elsewhere === 1 ? "1 served by another facet" : `${elsewhere} served by other facets`);
  if (excluded > 0) parts.push(`${excluded} not in the diamond`);
  if (contested > 0) parts.push(`${contested} contested`);
  return parts.join(", ");
}

function firstPlaced(options: readonly string[], placed: ReadonlySet<string>, self: string): string | undefined {
  return options.find((o) => o !== self && placed.has(o));
}

/**
 * The card's connections in words (spec L746), since traces and ties aren't focusable: "needs ERC4626;
 * collides with AxelarGatewayAdapter on sendMessage", then chips and the problems on the card.
 */
export function cardConnections(args: {
  facet: Facet;
  catalog: Catalog;
  placed: readonly string[];
  slice: CardAnalysis;
  all: readonly PinView[];
  chips: readonly string[];
}): string {
  const { facet, catalog, slice, all, chips } = args;
  const placed = new Set(args.placed);
  const parts: string[] = [];

  for (const req of facet.requires) {
    if (req.strength !== "hard") continue;
    const provider = firstPlaced(req.anyOf, placed, facet.name);
    parts.push(provider ? `needs ${provider}` : `needs ${joinWith(req.anyOf, "or")}, which isn't on the sheet`);
  }
  const dependents = catalog.facets
    .filter((f) => f.name !== facet.name && placed.has(f.name))
    .filter((f) => f.requires.some((r) => r.strength === "hard" && firstPlaced(r.anyOf, placed, f.name) === facet.name))
    .map((f) => f.name);
  if (dependents.length > 0) parts.push(`needed by ${joinWith(dependents, "and")}`);

  const rivals = new Map<string, string[]>();
  for (const selector of slice.contested) {
    const pin = all.find((p) => p.selector === selector);
    for (const other of slice.routes[selector]?.contenders ?? []) {
      if (other === facet.name || !pin) continue;
      rivals.set(other, [...(rivals.get(other) ?? []), pin.name]);
    }
  }
  for (const [other, names] of rivals) parts.push(`collides with ${other} on ${joinWith(names, "and")}`);

  for (const chip of chips) parts.push(chip.charAt(0).toLowerCase() + chip.slice(1));

  const own = slice.problems.filter((p) => anchorsFacet(p, facet.name));
  const blockers = own.filter((p) => p.severity === "blocker").length;
  const warnings = own.filter((p) => p.severity === "warning").length;
  if (blockers > 0) parts.push(plural(blockers, "blocker"));
  if (warnings > 0) parts.push(plural(warnings, "warning"));

  if (parts.length === 0) return "";
  const text = parts.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** The description the card's group carries: connections, then the selection state (spec L745). */
export function describeCard(view: Pick<CardView, "connections">, selected: boolean): string {
  const selection = selected ? "Selected." : "Not selected.";
  return view.connections ? `${view.connections} ${selection}` : selection;
}

/**
 * The facets whose placement changes this card's words: what it needs, what needs it, and those dependents'
 * other options (a dependent met by an earlier option isn't "needed by" here). The card reads `recipe.facets`
 * filtered to these, so placing an unrelated facet doesn't re-render it.
 */
export function wordNeighbours(facet: Facet | undefined, facets: readonly Facet[]): Set<string> {
  if (!facet) return new Set();
  const out = new Set(facet.requires.flatMap((r) => r.anyOf));
  for (const other of facets) {
    for (const r of other.requires) {
      if (!r.anyOf.includes(facet.name)) continue;
      out.add(other.name);
      for (const option of r.anyOf) out.add(option);
    }
  }
  return out;
}

export type CardInputs = {
  facet: Facet;
  catalog: Catalog;
  slice: CardAnalysis;
  /** Excluded selectors (`recipe.exclude`). */
  excluded: ReadonlySet<Hex4>;
  /** Placed facet names (`recipe.facets`). */
  placed: readonly string[];
  pins: "left" | "right";
  expanded: boolean;
  compact: boolean;
  metrics: LayoutMetrics;
};

/** Everything the card draws. */
export function cardView(input: CardInputs): CardView {
  const { facet, catalog, slice, excluded, placed, pins, expanded, compact, metrics } = input;
  const all = facet.selectors.map((selector) =>
    pinView({ facet: facet.name, selector, route: slice.routes[selector.hex], excluded: excluded.has(selector.hex), catalog }),
  );
  const shown = new Set(visibleRows(facet, expanded, slice.contested, metrics));
  const rows = all.filter((p) => shown.has(p.selector));
  const size = cardSize(facet, { metrics, expanded, pins, compact, contested: slice.contested });
  const chips = [
    ...new Set(
      slice.problems.filter((p) => netMissing(p, facet.name)).map((p) => `Not on ${String(p.params["chain"] ?? "this chain")}`),
    ),
  ];
  const routedHere = all.filter((p) => p.here).length;
  return {
    facet: facet.name,
    source: facet.source,
    pins,
    expanded,
    compact,
    size,
    rows,
    all,
    hidden: all.length - rows.length,
    collapsible: all.length > metrics.expandThreshold,
    border: cardBorder(slice, facet.name),
    chips,
    footer: footerText(facet),
    count: formatCount(routedHere, all.length),
    name: cardName(facet.name, all),
    connections: cardConnections({ facet, catalog, placed, slice, all, chips }),
  };
}

