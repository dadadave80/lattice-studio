/**
 * What a pin (a row of the inspector's Selectors list) says and does (spec L446-L451, Flow 6): its state in
 * words, the tooltip that says what a click will do, and the command a click runs. Pure, so every state is
 * unit-tested without a browser.
 */
import type { CommandRef, Hex4, Route, Seam } from "@lattice-studio/core";

export type PinState = "excluded" | "seam" | "default" | "routed" | "served" | "contested";

export type PinAction = {
  state: PinState;
  /** The state in words: "not in the diamond", "seam", "owner by default", "routed", "→ GovernedVault", "contested". */
  label: string;
  /** Flow 6's tooltip. Signatures are backticked, as spec L446 writes them. */
  tooltip: string;
  /** What a click, Enter or Space runs; absent for a seam, which offers no route. */
  command?: CommandRef;
};

export type PinInput = {
  /** The facet whose row this is. */
  facet: string;
  selector: { hex: Hex4; signature: string };
  /** `analysis.routing[hex]`; undefined while the facet isn't placed (a catalog preview). */
  route: Route | undefined;
  /** `recipe.exclude`. */
  exclude: readonly Hex4[];
  /** `catalog.seams`. */
  seams: readonly Seam[];
  /** `recipe.facets`. */
  placed: readonly string[];
};

const lower = (hex: string): string => hex.toLowerCase();

/** The seam active for `hex`: every facet in its `when` is placed. */
function activeSeam(hex: string, seams: readonly Seam[], placed: readonly string[]): Seam | undefined {
  return seams.find((seam) => lower(seam.selector) === hex && seam.when.every((name) => placed.includes(name)));
}

export function pinAction({ facet, selector, route, exclude, seams, placed }: PinInput): PinAction {
  const hex = lower(selector.hex);
  const selectorArg = selector.hex;
  const contested = (route?.contenders.length ?? 0) > 1;

  if (exclude.some((excluded) => lower(excluded) === hex)) {
    return {
      state: "excluded",
      label: "not in the diamond",
      tooltip: "Not in the diamond. Click to route here.",
      command: { id: "selector.include", args: contested ? { selector: selectorArg, facet } : { selector: selectorArg } },
    };
  }

  // Not placed (catalog preview): the selector would route here once the facet is on the sheet.
  if (route === undefined) {
    return { state: "routed", label: "routed", tooltip: `\`${selector.signature}\`: routes here.` };
  }

  const owner = route.owner;
  if (route.via === "seam" && owner !== undefined) {
    const seam = activeSeam(hex, seams, placed);
    return {
      state: "seam",
      label: "seam",
      tooltip: seam ? `Seam: stays on ${owner} because its version ${seam.reason}.` : `Seam: stays on ${owner}.`,
    };
  }

  if (owner === facet && route.via === "default") {
    // Click to change changes the owner (contracts §6): with one other contender, route to it; with more, choose.
    const others = route.contenders.filter((name) => name !== facet);
    const [other] = others;
    return {
      state: "default",
      label: "owner by default",
      tooltip: "Owner by default. Click to change.",
      command:
        others.length === 1 && other !== undefined
          ? { id: "selector.route", args: { selector: selectorArg, facet: other } }
          : { id: "collision.choosePerSelector", args: { selectors: [selectorArg] } },
    };
  }

  if (owner === facet) {
    return {
      state: "routed",
      label: "routed",
      tooltip: `\`${selector.signature}\`: routes here. Click to leave it out of the diamond.`,
      command: { id: "selector.exclude", args: { selector: selectorArg } },
    };
  }

  if (owner !== undefined) {
    return {
      state: "served",
      label: `→ ${owner}`,
      tooltip: `Served by ${owner}. Click to route here instead.`,
      command: { id: "selector.route", args: { selector: selectorArg, facet } },
    };
  }

  return {
    state: "contested",
    label: "contested",
    tooltip: `Contested by ${joinNames(route.contenders)}. Click to route here.`,
    command: { id: "selector.route", args: { selector: selectorArg, facet } },
  };
}

/** "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}
