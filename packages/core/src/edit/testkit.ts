/**
 * A small catalog and project for the edit tests, and the checks every result must pass. Test-only: nothing in
 * the module imports it.
 */
import { lintCopy } from "../format/copy-lint";
import type { Catalog } from "../model/catalog";
import type { EditResult, Project } from "../model/project";
import type { Recipe } from "../model/recipe";
import { makeCatalog, makeFacet, makeInit, makeProject, makeRecipe } from "../testing/builders";

export const SEL = {
  transfer: "0xa9059cbb",
  name: "0x06fdde03",
  balanceOf: "0x70a08231",
  send: "0xcdfe7f5c",
  supports: "0xdc680a0f",
  delegate: "0x5c19a95c",
  owner: "0x8da5cb5b",
} as const;

/**
 * Catalog order: Axelar, Hyperlane, ERC20, ERC20Votes, GovernedVault, Vault, OwnableFacet, DiamondCutFacet, Receive.
 * `transfer` is a seam once ERC20Votes is placed; GovernedVault owns `name()` by default.
 */
export const catalog: Catalog = makeCatalog({
  facets: [
    makeFacet({ name: "Axelar", selectors: ["sendMessage(bytes,bytes,bytes[])", "supportsAttribute(bytes4)"] }),
    makeFacet({ name: "Hyperlane", selectors: ["sendMessage(bytes,bytes,bytes[])", "supportsAttribute(bytes4)"] }),
    makeFacet({ name: "ERC20", selectors: ["transfer(address,uint256)", "name()", "balanceOf(address)"], init: "ERC20Init" }),
    makeFacet({ name: "ERC20Votes", selectors: ["transfer(address,uint256)", "delegate(address)"] }),
    makeFacet({ name: "GovernedVault", selectors: ["transfer(address,uint256)", "name()"], defaultOwnerOf: [SEL.name] }),
    makeFacet({ name: "Vault", selectors: ["totalAssets()"], init: "VaultInit" }),
    makeFacet({ name: "OwnableFacet", selectors: ["owner()"], init: "OwnableInit" }),
    makeFacet({ name: "DiamondCutFacet", selectors: ["diamondCut((address,uint8,bytes4[])[],address,bytes)"], init: "OwnableInit" }),
    makeFacet({ name: "Receive", selectors: [{ hex: "0x00000000", signature: "receive()" }] }),
  ],
  inits: [
    makeInit({
      name: "ERC20Init",
      fn: "init(string,string)",
      params: [
        { name: "name_", type: "string", doc: "Token name." },
        { name: "symbol_", type: "string", doc: "Token symbol." },
      ],
    }),
    makeInit({ name: "OwnableInit", fn: "init(address)", params: [{ name: "_owner", type: "address", doc: "Owner.", authority: true }] }),
    makeInit({ name: "AccessInit", fn: "init(address)", params: [{ name: "admin", type: "address", doc: "Admin.", authority: true }] }),
    makeInit({
      name: "VaultInit",
      kind: "bundle",
      fn: "init((address,string))",
      params: [
        {
          name: "p",
          type: "tuple",
          doc: "Vault settings.",
          components: [
            { name: "asset", type: "address", doc: "Asset." },
            { name: "name", type: "string", doc: "Name." },
          ],
        },
      ],
    }),
  ],
  seams: [
    { selector: SEL.transfer, when: ["ERC20Votes"], anyOf: ["GovernedVault", "ERC20Votes"], reason: "moves vote checkpoints with balances" },
  ],
});

export const ADDRESS = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

/** A project holding `recipe` fields over an empty recipe, with a card at (0, 0) for each facet. */
export function projectWith(recipe: Partial<Recipe> = {}, extra: Partial<Project> = {}): Project {
  const full = makeRecipe(recipe, catalog);
  const layout: Project["layout"] = {};
  full.facets.forEach((name, index) => {
    layout[name] = { x: index * 320, y: 0, pins: "right" };
  });
  return makeProject({ recipe: full, layout, ...extra });
}

/**
 * What's wrong with a result expected to be a success: it must be changed, a new project, a label with no
 * trailing period (undo adds one) and clean copy. Empty when it's right.
 */
export function changedIssues(result: EditResult, before: Project, summary: string): string[] {
  const issues: string[] = [];
  if (result.summary !== summary) issues.push(`summary is ${JSON.stringify(result.summary)}, expected ${JSON.stringify(summary)}`);
  if (!result.changed) issues.push("changed is false");
  if (result.project === before) issues.push("the project is the input object");
  if (result.summary.endsWith(".")) issues.push("a success label ends with a period");
  for (const issue of lintCopy(result.summary)) issues.push(`copy: ${issue.message}`);
  return issues;
}

/** What's wrong with a result expected to be a no-op: the same project object, and a full sentence saying why. */
export function noOpIssues(result: EditResult, before: Project, summary: string): string[] {
  const issues: string[] = [];
  if (result.summary !== summary) issues.push(`summary is ${JSON.stringify(result.summary)}, expected ${JSON.stringify(summary)}`);
  if (result.changed) issues.push("changed is true");
  if (result.project !== before) issues.push("the project isn't the input object");
  if (!result.summary.endsWith(".")) issues.push("a no-op sentence doesn't end with a period");
  for (const issue of lintCopy(result.summary)) issues.push(`copy: ${issue.message}`);
  return issues;
}
