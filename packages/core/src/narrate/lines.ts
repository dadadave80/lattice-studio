import type { LinesApi } from "../model/api";
import type { SelectorRef } from "../model/console";
import { formatAddress, formatSelector, formatTime, plural } from "../format/format";
import { groupDigits, joinAnd, truncateHex6 } from "../format/text";

function selectorList(selectors: readonly SelectorRef[]): string {
  return joinAnd(selectors.map((s) => formatSelector(s, "dense")));
}

function pathLabel(path: "factory" | "createx"): string {
  return path === "factory" ? "LatticeFactory" : "CreateX";
}

/** One builder per console line (spec L703-L729, L410, L652). Each returns a draft; the caller stamps `at`. */
export const lines: LinesApi = {
  catalogLoaded: ({ version, facets, provisional }) => ({
    tag: "Note",
    text: `Catalog: ${provisional ?? `Lattice ${version}`} · ${plural(facets, "facet")}.`,
  }),

  projectOpened: ({ name, facets, savedAt, now }) => ({
    tag: "Note",
    text: `Opened ${name} · ${plural(facets, "facet")} · saved ${formatTime(savedAt, now).text}.`,
  }),

  linkOpened: ({ recipeHash, toConfirm }) => ({
    tag: "Note",
    text: `Opened a shared link · recipe ${truncateHex6(recipeHash)} · ${plural(toConfirm, "address", "addresses")} to confirm.`,
  }),

  recipeLoaded: ({ name, facets, selectors, script }) => ({
    tag: "Note",
    text: `Loaded ${name} · ${plural(facets, "facet")} · ${plural(selectors, "selector")}${script ? ` · from ${script}` : ""}.`,
  }),

  placed: ({ facet, selectors, namespace }) => ({
    tag: "Placed",
    text: `Placed ${facet} · ${plural(selectors, "selector")}${namespace ? ` · erc7201:${namespace}` : ""}`,
  }),

  removed: ({ facets }) => ({ tag: "Note", text: `Removed ${joinAnd(facets)}.` }),

  collision: ({ contenders, selectors }) => ({
    tag: "Collision",
    text: `${joinAnd(contenders)} ${contenders.length === 2 ? "both" : "all"} export ${selectorList(selectors)}. Choose an owner.`,
  }),

  resolved: ({ selectors, owner }) => ({
    tag: "Resolved",
    text: `Resolved: ${selectorList(selectors)} ${selectors.length === 1 ? "routes" : "route"} to ${owner}.`,
  }),

  missing: ({ facet, requires, reason }) => ({
    tag: "Missing",
    text: `${facet} requires ${requires}: ${reason.replace(/\.$/, "")}.`,
  }),

  dependencyMet: ({ facet }) => ({ tag: "Resolved", text: `Dependency met: ${facet}.` }),

  fieldSet: ({ label, value }) => ({ tag: "Init", text: `Set ${label} to ${value}.` }),

  stepMoved: ({ spec, step, after }) => ({
    tag: "Init",
    text: after ? `Moved ${spec} to step ${step}, after ${after}.` : `Moved ${spec} to step ${step}.`,
  }),

  tidied: ({ facets }) => ({ tag: "Note", text: `Tidied ${plural(facets, "facet")}.` }),

  undid: ({ label }) => ({ tag: "Note", dim: true, text: `Undid: ${label}.` }),

  mechanismChanged: ({ facet, holder }) => ({
    tag: "Note",
    text: holder ? `Upgrade mechanism: ${facet} · Safe ${holder}.` : `Upgrade mechanism: ${facet}.`,
  }),

  reviewOpened: ({ chain, path, facets }) => ({
    tag: "Deploy",
    text: `Review: ${chain} · ${pathLabel(path)} · ${plural(facets, "facet")}.`,
  }),

  simulated: ({ block, events }) => ({
    tag: "Deploy",
    text: `Simulated at block ${groupDigits(block)}: succeeded, ${plural(events, "event")}.`,
  }),

  submitted: ({ tx, chain }) => ({ tag: "Deploy", text: `Submitted ${truncateHex6(tx)} on ${chain}.` }),

  proposed: ({ safe, chain }) => ({
    tag: "Deploy",
    text: `Proposed to Safe ${formatAddress(safe)} on ${chain}. Waiting for the Safe to execute the batch.`,
  }),

  confirmed: ({ address, block }) => ({
    tag: "Deploy",
    text: `Deployed at ${formatAddress(address)} in block ${groupDigits(block)}. Matches the sheet.`,
  }),

  mismatch: ({ address, differing }) => ({
    tag: "Deploy",
    text: `Deployed at ${formatAddress(address)}, but \`facets()\` doesn't match the sheet: ${plural(differing, "selector")} differ.`,
  }),

  verified: ({ status, forwardedTo }) => {
    const label = status === "exact_match" ? "exact match" : "match";
    const tail = forwardedTo.length > 0 ? `; forwarded to ${joinAnd(forwardedTo)}.` : ".";
    return { tag: "Verify", text: `Verified on Sourcify (${label})${tail}` };
  },

  reverted: ({ module, error, args, note }) => {
    const where = module ? ` in ${module}` : "";
    const tail = note ? ` ${note}` : "";
    return { tag: "Error", text: `Deploy reverted${where}: \`${error}(${args})\`.${tail}` };
  },

  diverged: ({ chain, revision }) => ({
    tag: "Note",
    text: `The sheet now differs from what's live on ${chain} (r${revision}).`,
  }),

  exported: ({ filename, recipeHash }) => ({
    tag: "Note",
    text: `Exported ${filename} · recipe ${truncateHex6(recipeHash)}`,
  }),
};
