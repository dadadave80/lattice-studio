/**
 * The palette's rows (IR L162-L168), built from the registry and the open project without touching the DOM:
 * Suggested (from context: resolve current problems, Fill in, Next problem), Recent (the last 5), Commands
 * (by category: Sheet, Build, Session, then the rest), Place facet and Recipes, always in that order
 * (PA bug 15), so commands never sit behind a hundred facets. Every row carries its title, its category, the
 * binding for its shortcut chip and its console syntax, so each use teaches both (spec L660).
 */
import type { Catalog, CommandRef, Json, Problem, TemplateItem } from "@lattice-studio/core";
import { isCoreFacet, templateList } from "@lattice-studio/core";
import {
  bindingId, getCommand, isPlaceholder, type BindingId, type CommandCategory, type PaletteRow, type SheetPoint,
} from "@/contracts";
import { CATEGORY_ORDER } from "@/commands";
import type { PaletteMode } from "./palette-state";

export type GroupId = "suggested" | "recent" | "commands" | "facets" | "recipes";

export const GROUP_ORDER: readonly GroupId[] = ["suggested", "recent", "commands", "facets", "recipes"];

export const GROUP_LABELS: Readonly<Record<GroupId, string>> = {
  suggested: "Suggested",
  recent: "Recent",
  commands: "Commands",
  facets: "Place facet",
  recipes: "Recipes",
};

/** A placed facet's row says so (PA bug 16: "On sheet"); placing it again selects and locates it. */
export const ON_SHEET = "On sheet";
/** The note on the core's own facets: in every diamond, never placed. */
export const CORE_NOTE = "Core";

/** At most this many problem fixes lead Suggested. */
export const SUGGESTED_FIXES = 3;

export type PaletteItem = {
  /** Unique within the palette: the group and the command with its arguments. */
  key: string;
  group: GroupId;
  ref: CommandRef;
  /** The command's title for these arguments ("Place ERC20"): its one name everywhere. */
  title: string;
  category: CommandCategory;
  /** The binding whose keys the shortcut chip shows. */
  binding?: BindingId;
  /** Console syntax in grey ("place erc20"). */
  syntax?: string;
  /** "On sheet". */
  note?: string;
  /** Lowercased text the query matches. */
  search: string;
};

export type PaletteGroup = { id: GroupId; label: string; items: PaletteItem[] };

/** What a command shows as a row, or null while it's a placeholder (it has no real title yet). */
export type Describe = (ref: CommandRef) => {
  title: string;
  category: CommandCategory;
  binding?: BindingId;
  syntax?: string;
} | null;

/** Describes a command from the registry. */
export const describeCommand: Describe = (ref) => {
  if (isPlaceholder(ref.id)) return null;
  const c = getCommand(ref.id);
  let title: string;
  try {
    title = c.title(ref.args ?? {});
  } catch {
    return null;
  }
  return {
    title,
    category: c.category,
    ...(c.keys?.length ? { binding: bindingId(c.id) } : {}),
    ...(c.console ? { syntax: c.console.syntax } : {}),
  };
};

export type PaletteSources = {
  mode: PaletteMode;
  /** Where Add facet here… places. */
  at: SheetPoint | null;
  /** The Commands group's rows (`listPaletteRows()`). */
  rows: readonly PaletteRow[];
  recent: readonly CommandRef[];
  problems: readonly Problem[];
  catalog: Catalog | null;
  /** Facets on the sheet. */
  placed: ReadonlySet<string>;
  describe?: Describe;
};

function refKey(ref: CommandRef): string {
  return `${ref.id}${ref.args ? JSON.stringify(ref.args) : ""}`;
}

function searchText(...parts: (string | undefined)[]): string {
  return parts.filter((p) => p !== undefined && p !== "").join(" ").toLowerCase();
}

/**
 * The console line that does what the row does, where it's one word away: `place erc20`, `recipe erc20`
 * (IR L165). Other rows show their command's syntax.
 */
function filledSyntax(ref: CommandRef): string | undefined {
  const args = ref.args ?? {};
  if (ref.id === "facet.place" && typeof args.facet === "string") return `place ${args.facet.toLowerCase()}`;
  if (ref.id === "recipe.load" && typeof args.name === "string") return `recipe ${args.name.toLowerCase()}`;
  return undefined;
}

function item(group: GroupId, ref: CommandRef, shown: NonNullable<ReturnType<Describe>>, extra: {
  note?: string; keywords?: string;
} = {}): PaletteItem {
  const syntax = filledSyntax(ref) ?? shown.syntax;
  return {
    key: `${group}:${refKey(ref)}`,
    group,
    ref,
    title: shown.title,
    category: shown.category,
    ...(shown.binding ? { binding: shown.binding } : {}),
    ...(syntax ? { syntax } : {}),
    ...(extra.note ? { note: extra.note } : {}),
    search: searchText(shown.title, shown.category, syntax, extra.note, extra.keywords),
  };
}

function fromRef(group: GroupId, ref: CommandRef, describe: Describe): PaletteItem | null {
  const shown = describe(ref);
  return shown ? item(group, ref, shown) : null;
}

function present<T>(value: T | null): value is T {
  return value !== null;
}

/**
 * Suggested, from context (IR L164): the first fix of each of the first problems (blockers first, as the
 * analysis orders them), Fill in while required arguments are empty (INIT-01, spec L362), and Next problem
 * while there are problems.
 */
function suggested(problems: readonly Problem[], describe: Describe): PaletteItem[] {
  const out: PaletteItem[] = [];
  const seen = new Set<string>();
  const add = (ref: CommandRef): boolean => {
    const key = refKey(ref);
    if (seen.has(key)) return false;
    const row = fromRef("suggested", ref, describe);
    if (!row) return false;
    seen.add(key);
    out.push(row);
    return true;
  };
  let fixes = 0;
  for (const problem of problems) {
    if (fixes >= SUGGESTED_FIXES) break;
    if (problem.fixes.some((fix) => add(fix))) fixes += 1;
  }
  if (problems.some((p) => p.code === "INIT-01")) add({ id: "init.open" });
  if (problems.length > 0) add({ id: "problem.next" });
  return out;
}

function categoryRank(category: CommandCategory): number {
  const at = CATEGORY_ORDER.indexOf(category);
  return at < 0 ? CATEGORY_ORDER.length : at;
}

/** A title without its trailing ellipsis, so "Deploy…" sorts before "Deploy again…" ("…" collates after a space). */
const plainTitle = (row: PaletteRow): string => row.title.replace(/…$/u, "");

/** Commands (IR L164): Sheet, Build, Session, then Export, Deploy, Console and Chain; by title within each. */
function commands(rows: readonly PaletteRow[]): PaletteItem[] {
  return [...rows]
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || plainTitle(a).localeCompare(plainTitle(b), "en"))
    .map((row) =>
      item("commands", row.ref, {
        title: row.title,
        category: row.category,
        binding: row.binding,
        ...(row.syntax ? { syntax: row.syntax } : {}),
      }),
    );
}

/** Place facet: every catalog facet in catalog order, as `place <facet>` teaches (IR L165). */
function facets(catalog: Catalog | null, placed: ReadonlySet<string>, at: SheetPoint | null, describe: Describe): PaletteItem[] {
  if (!catalog) return [];
  const where: Record<string, Json> = at ? { at: { x: at.x, y: at.y } } : {};
  return catalog.facets
    .map((facet) => {
      const ref: CommandRef = { id: "facet.place", args: { facet: facet.name, ...where } };
      const shown = describe(ref);
      if (!shown) return null;
      return item("facets", ref, shown, {
        ...(isCoreFacet(facet.name) ? { note: CORE_NOTE } : placed.has(facet.name) ? { note: ON_SHEET } : {}),
        keywords: `${facet.name} ${facet.area}`,
      });
    })
    .filter(present);
}

/**
 * Recipes: each Lattice recipe as "Recipe: GovernedVault" (spec L407); on a sheet with facets, the v1
 * recipes also as "Replace this sheet with…" (spec L408). Recipes that arrive later stay, disabled with why.
 */
function recipes(catalog: Catalog | null, sheetHasFacets: boolean, describe: Describe): PaletteItem[] {
  if (!catalog) return [];
  const templates: TemplateItem[] = templateList(catalog);
  const load = templates.map((t) => fromRef("recipes", { id: "recipe.load", args: { name: t.name } }, describe));
  const replace = sheetHasFacets
    ? templates.filter((t) => t.loadable).map((t) => fromRef("recipes", { id: "recipe.replace", args: { name: t.name } }, describe))
    : [];
  return [...load, ...replace].filter(present);
}

/** Every group in order, empty ones left out. Add facet here… shows the Place facet group only. */
export function paletteGroups(sources: PaletteSources): PaletteGroup[] {
  const describe = sources.describe ?? describeCommand;
  const placeAt = sources.mode === "facets" ? sources.at : null;
  const items: Record<GroupId, PaletteItem[]> =
    sources.mode === "facets"
      ? { suggested: [], recent: [], commands: [], recipes: [], facets: facets(sources.catalog, sources.placed, placeAt, describe) }
      : {
          suggested: suggested(sources.problems, describe),
          recent: sources.recent.map((ref) => fromRef("recent", ref, describe)).filter(present),
          commands: commands(sources.rows),
          facets: facets(sources.catalog, sources.placed, null, describe),
          // Cards only: the core is in every recipe, so a core-only sheet is still empty.
          recipes: recipes(sources.catalog, [...sources.placed].some((name) => !isCoreFacet(name)), describe),
        };
  return GROUP_ORDER.map((id) => ({ id, label: GROUP_LABELS[id], items: items[id] })).filter((g) => g.items.length > 0);
}

/** The query's words, lowercased. */
export function queryWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter((w) => w !== "");
}

/** Lowercased runs of letters and digits: "Place ERC20" → place, erc20; "Deploy…" → deploy. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w !== "");
}

/** Where `words` first appear in `within` as a run of whole words, or -1. */
function wholeWordRun(within: readonly string[], words: readonly string[]): number {
  if (words.length === 0) return -1;
  for (let i = 0; i + words.length <= within.length; i++) {
    if (words.every((w, j) => within[i + j] === w)) return i;
  }
  return -1;
}

/**
 * How well a row's title matches the query, best first (Flow 3 route 4, spec L420: "⌘K, type the name,
 * Enter" places that facet):
 * 0. The title opens with the query's whole words ("deploy" → Deploy…, "place erc20" → Place ERC20).
 * 1. The query's whole words come later in the title, such as a facet's own name ("erc20" → Place ERC20
 *    before Place BridgeERC20; "pausable" → Place Pausable before Place ERC20Pausable).
 * 2. The title opens with the query mid-word ("dep" → Deploy…).
 * 3. Anything else that matched: part of a later word, the category, the syntax, the facet's area.
 */
function titleRank(title: string, query: string): 0 | 1 | 2 | 3 {
  const run = wholeWordRun(wordsOf(title), wordsOf(query));
  if (run === 0) return 0;
  if (run > 0) return 1;
  return title.toLowerCase().startsWith(query) ? 2 : 3;
}

/**
 * Rows matching every word of `query` (in title, category, syntax, note, facet name or area). Groups keep
 * their order (IR L164); within each, rows sort by `titleRank`, and the sort is stable, so ties keep the
 * group's own order.
 */
export function filterGroups(groups: readonly PaletteGroup[], query: string): PaletteGroup[] {
  const words = queryWords(query);
  if (words.length === 0) return [...groups];
  const typed = words.join(" ");
  return groups
    .map((g) => ({
      ...g,
      items: g.items
        .filter((i) => words.every((w) => i.search.includes(w)))
        .map((i) => ({ i, rank: titleRank(i.title, typed) }))
        .toSorted((a, b) => a.rank - b.rank)
        .map(({ i }) => i),
    }))
    .filter((g) => g.items.length > 0);
}
