/**
 * Project ops (spec L471-L487): the name, card positions, pins, expansion and predicted addresses. None of them
 * touches the recipe, so the recipe object (and its hash) is the same one after every op here.
 */
import { isCoreFacet } from "../diamond/core";
import { withoutCore } from "../diamond/repair";
import { formatAddress, plural } from "../format/format";
import type {
  ApplyLayoutFn, FlipPinsFn, MoveCardsFn, RecordPredictionFn, RenameProjectFn, SetCardPositionFn, SetExpandedFn,
} from "../model/api";
import { isAddress, sameAddress, toChecksum } from "../model/hex";
import type { CardLayout, Layout } from "../model/layout";
import type { Project } from "../model/project";
import { done, isFinitePoint, noOp, notOnSheet, unique } from "./shared";

/** Pins of a card that has no layout entry yet: on the right, as C9's `tidy` gives new cards. */
const DEFAULT_PINS = "right";

/** "Moved ERC20" for one card, "Moved 3 cards" for more. */
function cardsLabel(names: readonly string[]): string {
  return names.length === 1 ? (names[0] ?? "") : plural(names.length, "card");
}

/** The named cards that have a layout entry, deduplicated; the rest listed as missing. */
function splitByLayout(layout: Layout, facets: readonly string[]): { present: string[]; missing: string[] } {
  const names = unique(facets);
  return {
    present: names.filter((name) => Object.hasOwn(layout, name)),
    missing: names.filter((name) => !Object.hasOwn(layout, name)),
  };
}

function withLayout(project: Project, layout: Layout): Project {
  return { ...project, layout };
}

export const renameProject: RenameProjectFn = (project, name) => {
  const next = name.trim();
  if (next === "") return noOp(project, "A project needs a name.");
  if (next === project.name) return noOp(project, `The project is already called ${next}.`);
  return done({ ...project, name: next }, `Renamed the project to ${next}`);
};

export const moveCards: MoveCardsFn = (project, facets, by) => {
  if (facets.length === 0) return noOp(project, "Select a card to move.");
  if (!isFinitePoint(by)) return noOp(project, "Nothing moved: the offset isn't a number.");
  const { present, missing } = splitByLayout(project.layout, facets);
  if (present.length === 0) return noOp(project, notOnSheet(missing));
  if (by.x === 0 && by.y === 0) return noOp(project, "Nothing moved: the offset is zero.");
  const layout: Layout = { ...project.layout };
  for (const name of present) {
    const entry = layout[name];
    if (entry !== undefined) layout[name] = { ...entry, x: entry.x + by.x, y: entry.y + by.y };
  }
  return done(withLayout(project, layout), `Moved ${cardsLabel(present)}`);
};

export const setCardPosition: SetCardPositionFn = (project, facet, at) => {
  if (isCoreFacet(facet)) return noOp(project, `${facet} is the diamond's core and has no card.`);
  if (!isFinitePoint(at)) return noOp(project, `${facet} didn't move: the position isn't a number.`);
  const entry = project.layout[facet];
  if (entry === undefined && !project.recipe.facets.includes(facet)) return noOp(project, notOnSheet([facet]));
  if (entry !== undefined && entry.x === at.x && entry.y === at.y) return noOp(project, `${facet} is already there.`);
  const next: CardLayout = entry === undefined ? { x: at.x, y: at.y, pins: DEFAULT_PINS } : { ...entry, x: at.x, y: at.y };
  return done(withLayout(project, { ...project.layout, [facet]: next }), `Moved ${facet}`);
};

export const flipPins: FlipPinsFn = (project, facets) => {
  if (facets.length === 0) return noOp(project, "Select a card to flip its pins.");
  const { present, missing } = splitByLayout(project.layout, facets);
  if (present.length === 0) return noOp(project, notOnSheet(missing));
  const layout: Layout = { ...project.layout };
  for (const name of present) {
    const entry = layout[name];
    if (entry !== undefined) layout[name] = { ...entry, pins: entry.pins === "left" ? "right" : "left" };
  }
  return done(withLayout(project, layout), `Flipped pins on ${cardsLabel(present)}`);
};

export const setExpanded: SetExpandedFn = (project, facet, expanded) => {
  const entry = project.layout[facet];
  if (entry === undefined) return noOp(project, notOnSheet([facet]));
  if ((entry.expanded === true) === expanded) {
    return noOp(project, `${facet} is already ${expanded ? "expanded" : "collapsed"}.`);
  }
  const { expanded: _flag, ...rest } = entry;
  const next: CardLayout = expanded ? { ...rest, expanded: true } : rest;
  return done(withLayout(project, { ...project.layout, [facet]: next }), `${expanded ? "Expanded" : "Collapsed"} ${facet}`);
};

/** Card names whose entry differs between two layouts, or that only one of them has. */
function changedCards(before: Layout, after: Layout): string[] {
  const names = unique([...Object.keys(before), ...Object.keys(after)]);
  return names.filter((name) => {
    const a = before[name];
    const b = after[name];
    return a === undefined || b === undefined || !sameEntry(a, b);
  });
}

function sameEntry(a: CardLayout, b: CardLayout): boolean {
  return a.x === b.x && a.y === b.y && a.pins === b.pins && (a.expanded === true) === (b.expanded === true);
}

export const applyLayout: ApplyLayoutFn = (project, layout) => {
  // The core has no card: an entry for it is dropped, whoever computed the layout.
  const cards = withoutCore(layout);
  const bad = Object.keys(cards).find((name) => {
    const entry = cards[name];
    return entry !== undefined && !isFinitePoint(entry);
  });
  if (bad !== undefined) return noOp(project, `The layout wasn't applied: ${bad}'s position isn't a number.`);
  const changed = changedCards(project.layout, cards);
  if (changed.length === 0) return noOp(project, "Nothing moved: the sheet already has this layout.");
  const copy: Layout = {};
  for (const name of Object.keys(cards)) {
    const entry = cards[name];
    if (entry !== undefined) copy[name] = { ...entry };
  }
  return done(withLayout(project, copy), `Arranged ${cardsLabel(changed)}`);
};

export const recordPrediction: RecordPredictionFn = (project, prediction) => {
  const { chainId, address } = prediction;
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return noOp(project, `${String(chainId)} isn't a chain id.`);
  if (!isAddress(address)) return noOp(project, `${address} isn't an address.`);
  const where = `${formatAddress(address)} on chain ${chainId}`;
  const known = project.predicted.some((p) => p.chainId === chainId && sameAddress(p.address, address));
  if (known) return noOp(project, `${where} is already recorded.`);
  const predicted = [...project.predicted, { chainId, address: toChecksum(address) }];
  return done({ ...project, predicted }, `Recorded ${where}`);
};
