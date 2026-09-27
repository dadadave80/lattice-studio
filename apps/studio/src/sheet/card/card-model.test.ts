import { describe, expect, test } from "bun:test";
import type { Analysis, Catalog, Hex4, Problem, Recipe } from "@lattice-studio/core";
import { analyze, cardSize, contestedSelectors } from "@lattice-studio/core";
import { loadFixtureCatalog, makeCatalog, makeFacet, makeRecipe } from "@lattice-studio/core/testing";
import { layoutMetrics } from "@/contracts/layout-metrics";
import {
  cardAnalysis, cardBorder, cardView, describeCard, footerText, pinView, sameCardAnalysis, visibleRows, wordNeighbours,
  type CardAnalysis, type CardView, type PinView,
} from "./card-model";

const loaded = loadFixtureCatalog();
if (!loaded.ok) throw new Error(loaded.error);
const catalog: Catalog = loaded.value;

function facet(name: string) {
  const found = catalog.facets.find((f) => f.name === name);
  if (!found) throw new Error(`${name} isn't in the fixture catalog.`);
  return found;
}

/** The gallery's recipe: every pin state and every border on one sheet. */
const GALLERY = [
  "ERC20", "ERC20Votes", "GovernedVault", "ERC20Pausable", "AxelarGatewayAdapter", "HyperlaneGatewayAdapter",
  "VaultCore", "Pausable",
];
const SYMBOL: Hex4 = "0x95d89b41";

function recipeOf(facets: string[], exclude: Hex4[] = []): Recipe {
  return makeRecipe({ facets, exclude }, catalog);
}

function view(
  name: string,
  recipe: Recipe,
  options: { expanded?: boolean; compact?: boolean; analysis?: Analysis } = {},
): CardView {
  const analysis = options.analysis ?? analyze(recipe, catalog);
  return cardView({
    facet: facet(name),
    catalog,
    slice: cardAnalysis(analysis, facet(name)),
    excluded: new Set(recipe.exclude),
    placed: recipe.facets,
    pins: "left",
    expanded: options.expanded ?? false,
    compact: options.compact ?? false,
    metrics: layoutMetrics,
  });
}

function pin(card: CardView, name: string): PinView {
  const found = card.all.find((p) => p.name === name);
  if (!found) throw new Error(`${card.facet} has no ${name}.`);
  return found;
}

const gallery = recipeOf(GALLERY, [SYMBOL]);

describe("pin states and what a click does (Flow 6)", () => {
  test("routed here: the signature, then 'routes here', and a click leaves it out", () => {
    const allowance = pin(view("ERC20", gallery), "allowance");
    expect(allowance.state).toBe("routed");
    expect(allowance.here).toBe(true);
    expect(allowance.mark).toBe("0xdd62ed3e");
    expect(allowance.tooltip).toEqual({
      code: "allowance(address,address)", text: ": routes here. Click to leave it out of the diamond.",
    });
    expect(allowance.action).toEqual({ id: "selector.exclude", args: { selector: "0xdd62ed3e" } });
    expect(allowance.label).toBe("allowance(address,address) 0xdd62ed3e, routes here");
  });

  test("not in the diamond: a click routes it here", () => {
    const symbol = pin(view("ERC20", gallery), "symbol");
    expect(symbol.state).toBe("excluded");
    expect(symbol.tooltip.text).toBe("Not in the diamond. Click to route here.");
    expect(symbol.action).toEqual({ id: "selector.include", args: { selector: SYMBOL, facet: "ERC20" } });
    expect(symbol.label).toBe("symbol() 0x95d89b41, not in the diamond");
  });

  test("an excluded selector reads 'not in the diamond' on every card that exports it (spec L455)", () => {
    // transfer(address,uint256) is a seam on ERC20 (ERC20Votes is in the gallery) and shared by GovernedVault
    // too; excluding it must read the same on both, ahead of any route or seam it would otherwise carry.
    const TRANSFER: Hex4 = "0xa9059cbb";
    const recipe = recipeOf(GALLERY, [SYMBOL, TRANSFER]);
    const onErc20 = pin(view("ERC20", recipe), "transfer");
    const onVault = pin(view("GovernedVault", recipe), "transfer");
    expect(onErc20.state).toBe("excluded");
    expect(onVault.state).toBe("excluded");
    expect(onErc20.tooltip.text).toBe("Not in the diamond. Click to route here.");
    expect(onVault.tooltip.text).toBe("Not in the diamond. Click to route here.");
    expect(onErc20.mark).toBe(TRANSFER);
    expect(onVault.mark).toBe(TRANSFER);
    expect(onErc20.action).toEqual({ id: "selector.include", args: { selector: TRANSFER, facet: "ERC20" } });
    expect(onVault.action).toEqual({ id: "selector.include", args: { selector: TRANSFER, facet: "GovernedVault" } });
  });

  test("served by another facet: '→ GovernedVault', and a click routes it here instead", () => {
    const name = pin(view("ERC20", gallery), "name");
    expect(name.state).toBe("elsewhere");
    expect(name.owner).toBe("GovernedVault");
    expect(name.mark).toBe("→ GovernedVault");
    expect(name.tooltip.text).toBe("Served by GovernedVault. Click to route here instead.");
    expect(name.action).toEqual({ id: "selector.route", args: { selector: "0x06fdde03", facet: "ERC20" } });
  });

  test("owner by default: a click changes the owner to the one rival", () => {
    const name = pin(view("GovernedVault", gallery), "name");
    expect(name.state).toBe("default");
    expect(name.here).toBe(true);
    expect(name.tooltip.text).toBe("Owner by default. Click to change.");
    expect(name.action).toEqual({ id: "selector.route", args: { selector: "0x06fdde03", facet: "ERC20" } });
  });

  test("owner by default among three: a click opens the per-selector owner choice", () => {
    const three = pinView({
      facet: "A",
      selector: { hex: "0x06fdde03", signature: "name()" },
      route: { owner: "A", via: "default", contenders: ["A", "B", "C"] },
      excluded: false,
      catalog,
    });
    expect(three.action).toEqual({ id: "collision.choosePerSelector", args: { selectors: ["0x06fdde03"] } });
    expect(three.tooltip.text).toBe("Owner by default. Click to change.");
  });

  test("seam: stays on its server, says why, and offers no route", () => {
    const onErc20 = pin(view("ERC20", gallery), "transfer");
    expect(onErc20.state).toBe("seam");
    expect(onErc20.here).toBe(false);
    expect(onErc20.mark).toBe("Seam: stays on GovernedVault");
    expect(onErc20.tooltip.text).toBe("Seam: stays on GovernedVault because its version moves vote checkpoints with balances.");
    expect(onErc20.action).toBeNull();
    const onVault = pin(view("GovernedVault", gallery), "transfer");
    expect(onVault.here).toBe(true);
    expect(onVault.mark).toBe("Seam: stays on GovernedVault");
    expect(onVault.action).toBeNull();
  });

  test("no route yet (the checks haven't run): unchecked, and a click has nothing to do", () => {
    const loading = pinView({
      facet: "ERC20", selector: { hex: "0xdd62ed3e", signature: "allowance(address,address)" }, route: undefined,
      excluded: false, catalog,
    });
    expect(loading.state).toBe("unchecked");
    expect(loading.tooltip.text).toBe("Not checked yet.");
    expect(loading.action).toBeNull();
  });

  test("contested: hatched, names the rival, and a click routes it here", () => {
    const send = pin(view("AxelarGatewayAdapter", gallery), "sendMessage");
    expect(send.state).toBe("contested");
    expect(send.tooltip.text).toBe("Collides with HyperlaneGatewayAdapter. Click to route here.");
    expect(send.action).toEqual({ id: "selector.route", args: { selector: "0xcdfe7f5c", facet: "AxelarGatewayAdapter" } });
    expect(send.label).toBe("sendMessage(bytes,bytes,bytes[]) 0xcdfe7f5c, contested with HyperlaneGatewayAdapter");
  });
});

describe("borders", () => {
  test("a collision is a conflict", () => {
    expect(view("AxelarGatewayAdapter", gallery).border).toBe("conflict");
    expect(view("HyperlaneGatewayAdapter", gallery).border).toBe("conflict");
  });

  test("a seam routed nowhere allowed (SEM-01) is a conflict", () => {
    expect(view("ERC20", gallery).border).toBe("conflict");
  });

  test("a missing dependency (DEP-01), a convention (DEP-02) and cutting nothing (SEL-03) are cautions", () => {
    expect(view("VaultCore", gallery).border).toBe("caution");
    expect(view("Pausable", gallery).border).toBe("caution");
    expect(view("ERC20Pausable", gallery).border).toBe("caution");
  });

  test("information alone draws the default border", () => {
    expect(view("ERC20Votes", gallery).border).toBe("default");
  });

  /** A slice holding one problem anchored on facet "A". */
  function anchored(code: Problem["code"], severity: Problem["severity"], where: Problem["where"]): CardAnalysis {
    const problem: Problem = { id: code, code, severity, where, params: {}, message: "", fixes: [] };
    return { routes: {}, problems: [problem], contested: [], key: code };
  }

  test("facets fighting over something (STO-01, CORE-03, DEP-03) are conflicts", () => {
    for (const code of ["STO-01", "CORE-03", "DEP-03", "SEM-01"] as const) {
      expect([code, cardBorder(anchored(code, "blocker", [{ kind: "facet", facet: "A" }]), "A")]).toEqual([code, "conflict"]);
    }
  });

  test("every other blocker or warning on the card (INIT-04, SEL-04) is a caution", () => {
    expect(cardBorder(anchored("INIT-04", "blocker", [{ kind: "facet", facet: "A" }]), "A")).toBe("caution");
    expect(cardBorder(anchored("SEL-04", "blocker", [{ kind: "selector", selector: "0x0ef22643", facet: "A" }]), "A")).toBe("caution");
    expect(cardBorder(anchored("STO-02", "info", [{ kind: "facet", facet: "A" }]), "A")).toBe("default");
    expect(cardBorder(anchored("STO-01", "blocker", [{ kind: "facet", facet: "B" }]), "A")).toBe("default");
  });
});

describe("rows, + n more and size", () => {
  test("a collapsed card keeps its contested rows and hides the rest behind + n more", () => {
    const card = view("HyperlaneGatewayAdapter", gallery);
    expect(card.collapsible).toBe(true);
    expect(card.rows.map((p) => p.name)).toEqual([
      "chainIdOf", "configureDestination", "destGasLimitOf", "domainOf", "sendMessage", "supportsAttribute",
    ]);
    expect(card.hidden).toBe(6);
    expect(card.size.rows).toBe(6);
    expect(card.size.hidden).toBe(6);
  });

  test("expanded, every row shows and the card is taller by the rows it gained", () => {
    const collapsed = view("HyperlaneGatewayAdapter", gallery);
    const expanded = view("HyperlaneGatewayAdapter", gallery, { expanded: true });
    expect(expanded.rows).toHaveLength(12);
    expect(expanded.hidden).toBe(0);
    expect(expanded.size.height - collapsed.size.height).toBe(6 * layoutMetrics.rowHeight);
  });

  test("nine selectors or fewer: no + n more and no Collapse", () => {
    const card = view("ERC20", gallery);
    expect(card.collapsible).toBe(false);
    expect(card.rows).toHaveLength(9);
  });

  test("compact: header plus the tick strip, every selector still listed", () => {
    const card = view("HyperlaneGatewayAdapter", gallery, { compact: true });
    expect(card.size.height).toBe(layoutMetrics.headerHeight + layoutMetrics.rowHeight);
    expect(card.all).toHaveLength(12);
  });

  test("the rows are C9's for every facet in the catalog, collapsed and contested", () => {
    for (const f of catalog.facets) {
      const hexes = f.selectors.map((s) => s.hex);
      for (const contested of [[], hexes.slice(-2), hexes.slice(0, 1), hexes.filter((_, i) => i % 3 === 0)]) {
        for (const expanded of [false, true]) {
          const rows = visibleRows(f, expanded, contested, layoutMetrics);
          const size = cardSize(f, { metrics: layoutMetrics, expanded, pins: "left", compact: false, contested });
          expect(rows.length).toBe(size.rows);
          expect(f.selectors.length - rows.length).toBe(size.hidden);
          for (const s of contested) expect(rows).toContain(s);
        }
      }
    }
  });

  test("the count reads routed out of exported (PA L56)", () => {
    expect(view("ERC20", gallery).count).toBe("5/9 selectors");
    expect(view("ERC20Pausable", gallery).count).toBe("0/2 selectors");
  });
});

describe("header, chips and footer", () => {
  test("the footer names the namespace, what it reads, or no storage", () => {
    expect(footerText(facet("ERC20"))).toBe("erc7201:lattice.storage.ERC20");
    expect(footerText(facet("ERC20Pausable"))).toBe("reads .Pausable · .ERC20 · .AccessControl");
    expect(footerText(facet("Multicall"))).toBe("no storage");
  });

  test("a NET-03 that names the facet adds 'Not on {chain}'", () => {
    const base = analyze(gallery, catalog);
    const net: Problem = {
      id: "NET-03", code: "NET-03", severity: "blocker", where: [{ kind: "chain", chainId: 84532 }],
      params: { chain: "Base Sepolia", core: [], missing: ["ERC20Votes"], total: 8 }, message: "", fixes: [],
    };
    const card = view("ERC20Votes", gallery, { analysis: { ...base, problems: [...base.problems, net] } });
    expect(card.chips).toEqual(["Not on Base Sepolia"]);
    expect(card.connections).toBe("Not on Base Sepolia.");
    expect(view("ERC20", gallery, { analysis: { ...base, problems: [...base.problems, net] } }).chips).toEqual([]);
  });
});

describe("accessible name and description (spec L745-L746)", () => {
  test("the name counts selectors and those served elsewhere", () => {
    expect(view("ERC20", gallery).name).toBe("ERC20, 9 selectors, 3 served by other facets, 1 not in the diamond");
    expect(view("ERC20Votes", gallery).name).toBe("ERC20Votes, 6 selectors, 2 served by other facets");
    expect(view("AxelarGatewayAdapter", gallery).name).toBe("AxelarGatewayAdapter, 9 selectors, 2 contested");
    expect(view("Pausable", gallery).name).toBe("Pausable, 3 selectors");
    expect(view("ERC20", recipeOf(["ERC20", "ERC4626"])).name).toBe("ERC20, 9 selectors, 1 served by another facet");
  });

  test("the description names collisions and needs in words, then the selection", () => {
    const axelar = view("AxelarGatewayAdapter", gallery);
    expect(describeCard(axelar, false)).toBe(
      "Collides with HyperlaneGatewayAdapter on sendMessage and supportsAttribute; 2 blockers; 1 warning. Not selected.",
    );
    expect(describeCard(view("VaultCore", gallery), true)).toBe(
      "Needs ERC4626, which isn't on the sheet; 2 blockers; 1 warning. Selected.",
    );
  });

  test("a met dependency reads 'needs' on one card and 'needed by' on the other", () => {
    const recipe = recipeOf(["ERC4626", "VaultCore"]);
    expect(view("VaultCore", recipe).connections).toMatch(/^Needs ERC4626[;.]/);
    expect(view("ERC4626", recipe).connections).toMatch(/^Needed by VaultCore[;.]/);
  });

  test("'needed by' follows the first placed option, as the trace does", () => {
    const a = makeFacet({ name: "A", selectors: ["a()"] });
    const b = makeFacet({ name: "B", selectors: ["b()"] });
    const x = makeFacet({ name: "X", selectors: ["x()"], requires: [{ anyOf: ["A", "B"], strength: "hard", reason: "r" }] });
    const small = makeCatalog({ facets: [a, b, x] });
    const words = (f: typeof a) => {
      const recipe = makeRecipe({ facets: ["A", "B", "X"] }, small);
      const placed = recipe.facets.filter((n) => wordNeighbours(f, small.facets).has(n));
      return cardView({
        facet: f, catalog: small, slice: cardAnalysis(analyze(recipe, small), f), excluded: new Set(), placed,
        pins: "left", expanded: false, compact: false, metrics: layoutMetrics,
      }).connections;
    };
    expect(words(a)).toMatch(/^Needed by X[;.]/);
    expect(words(b)).not.toContain("Needed by");
    expect(words(x)).toMatch(/^Needs A[;.]/);
  });

  test("a card with nothing to say states only the selection", () => {
    expect(describeCard({ connections: "" }, false)).toBe("Not selected.");
  });
});

describe("the analysis slice", () => {
  test("an edit elsewhere leaves a card's slice equal, so it doesn't re-render", () => {
    const before = cardAnalysis(analyze(gallery, catalog), facet("ERC20Votes"));
    const after = cardAnalysis(analyze(recipeOf(GALLERY, [SYMBOL, "0x8456cb59"]), catalog), facet("ERC20Votes"));
    expect(sameCardAnalysis(before, after)).toBe(true);
  });

  test("an edit to the card's own selectors changes its slice", () => {
    const before = cardAnalysis(analyze(gallery, catalog), facet("AxelarGatewayAdapter"));
    const routed = makeRecipe({ ...gallery, owners: { "0xcdfe7f5c": "AxelarGatewayAdapter" } }, catalog);
    const after = cardAnalysis(analyze(routed, catalog), facet("AxelarGatewayAdapter"));
    expect(sameCardAnalysis(before, after)).toBe(false);
    expect(after.contested).toEqual(contestedSelectors(analyze(routed, catalog), "AxelarGatewayAdapter"));
  });
});
