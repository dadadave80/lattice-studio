import { describe, expect, test } from "bun:test";
import { COMMAND_IDS, COMMAND_OWNERS, isCommandId } from "./commands";
import { anchorKey, isProblemCode, PROBLEM_CODES, PROBLEMS, problemId, type ProblemCode } from "./problems";
import { isNotImplemented, notImplemented, NotImplemented, WP_IDS } from "./wp";

/** contracts §5.3, copied row by row. */
const SECTION_5_3: Record<string, string> = {
  S1: "facet.place, facet.remove, facet.routeContested, selector.route, selector.clearOwner, selector.exclude, selector.include, recipe.load, recipe.replace, recipe.keepImmutable, init.setArg, init.addStep, init.removeStep, init.moveStep, init.reorderAuto, layout.flipPins, layout.toggleExpand, layout.tidy, layout.tidySelection, ack.set, history.undo, history.redo, project.rename",
  S2: "ui.escape, shortcuts.open",
  S3: "app.menu, pane.toggle, pane.show",
  S4b: "tool.select, tool.hand, sheet.zoomIn, sheet.zoomOut, sheet.zoom100, sheet.zoomFit, sheet.zoomSelection, sheet.zoomTo, sheet.locate, sheet.backToContent, sheet.minimapToggle",
  S4e: "sheet.selectAll, sheet.clearSelection, sheet.moveTo, sheet.nudge, sheet.focusDirection, sheet.focusFirst, sheet.focusLast, sheet.enterRows, sheet.addFacetHere, facet.removeSelected, selector.copy, selector.copySignature, selector.showOwner",
  S4c: "problem.next, problem.prev, problem.focus, collision.choosePerSelector, collision.resolve",
  S4d: "initOrder.toggle, recipe.browse",
  S5a: "catalog.focusSearch, catalog.preview",
  S5c: "inspector.show, inspector.focusSelectors, dependency.compare, plan.copyJson, deploy.compare, deployments.show",
  S5d: "init.open, init.focusField, init.confirmAddress, authority.chooseMechanism",
  S5e: "console.toggle, console.maximize, console.clear, console.help, console.find, problem.list, export.foundry, export.brief, export.recipeJson, export.safe",
  S6: "palette.open",
  S7b: "project.new, project.open, project.save, project.saveCopy, project.list, project.duplicate, project.exportFile, project.delete, project.restore, project.deleteForGood, data.exportAll, data.clear",
  S8a: "chain.select, chain.retryRead, chain.useAnotherRpc, wallet.connect, wallet.switchNetwork",
  S8b: "deploy.open, deploy.again, deploy.newSalt, deploy.usePath, deploy.setScope, deploy.previewFor, deploy.copyAddress, deploy.removeFacets, deploy.downloadSafeBatch, chain.focusPicker",
  S8c: "deploy.missingContracts, deploy.sign, deploy.keepWaiting, deploy.checkWallet, deploy.reviewAgain, deploy.discardProposal, deploy.showProgress",
  S8d: "deploy.retryVerification",
  S9: "region.next, region.prev, region.focus",
  S10: "settings.open, theme.set, tour.start, tour.end, about.open",
  S11a: "app.reload, app.saveAndReload",
  S12: "help.open",
  S13: "share.copyLink, link.confirmAddresses, project.takeOverEditing, catalog.migrate",
};

const expectedOwners = Object.fromEntries(
  Object.entries(SECTION_5_3).flatMap(([owner, ids]) => ids.split(", ").map((id) => [id, owner])),
);

describe("COMMAND_OWNERS", () => {
  test("covers every id in contracts §5.3 with its owner, and nothing else", () => {
    expect(COMMAND_IDS.length).toBe(132);
    expect(Object.keys(expectedOwners).length).toBe(132);
    expect({ ...COMMAND_OWNERS } as Record<string, string>).toEqual(expectedOwners);
  });

  test("isCommandId accepts exactly the ids", () => {
    expect(COMMAND_IDS.every(isCommandId)).toBe(true);
    expect(isCommandId("facet.explode")).toBe(false);
    expect(isCommandId("toString")).toBe(false);
  });
});

/** The checks table (spec L309-L342): severity as written, and the acknowledge marks. */
const CHECKS_TABLE: Record<ProblemCode, [string, boolean]> = {
  "SEL-01": ["blocker", false], "SEL-02": ["info", false], "SEL-03": ["warning", false], "SEL-04": ["blocker", false],
  "SEL-05": ["blocker", false], "SEM-01": ["blocker", false],
  "CORE-01": ["blocker", false], "CORE-02": ["warning", true], "CORE-03": ["blocker", false], "CORE-04": ["warning", false],
  "CORE-05": ["warning", false], "DEP-01": ["blocker", false], "DEP-02": ["warning", false], "DEP-03": ["blocker", false],
  "STO-01": ["blocker", false], "STO-02": ["info", false],
  "INIT-01": ["blocker", false], "INIT-02": ["blocker", false], "INIT-03": ["variable", false], "INIT-04": ["blocker", false],
  "INIT-05": ["warning", true],
  "AUTH-01": ["warning", true], "AUTH-02": ["blocker", false], "LINK-01": ["blocker", false],
  "NET-01": ["blocker", false], "NET-02": ["blocker", false], "NET-03": ["blocker", false], "NET-04": ["blocker", false],
  "NET-05": ["blocker", false], "NET-06": ["variable", false], "NET-07": ["info", false], "NET-08": ["warning", true],
};

/** contracts §3.3's fix commands. */
const FIXES: Record<ProblemCode, string[]> = {
  "SEL-01": ["selector.route", "collision.choosePerSelector"],
  "SEL-02": ["inspector.focusSelectors"],
  "SEL-03": ["facet.remove", "inspector.focusSelectors"],
  "SEL-04": ["selector.clearOwner"],
  "SEL-05": ["selector.clearOwner"],
  "SEM-01": ["selector.route", "facet.remove", "facet.place"],
  "CORE-01": ["facet.place", "selector.include"],
  "CORE-02": ["authority.chooseMechanism", "recipe.keepImmutable"],
  "CORE-03": ["facet.remove"],
  "CORE-04": ["facet.place"],
  "CORE-05": ["facet.place"],
  "DEP-01": ["facet.place", "dependency.compare"],
  "DEP-02": ["facet.place"],
  "DEP-03": ["facet.remove"],
  "STO-01": ["facet.remove"],
  "STO-02": [],
  "INIT-01": ["init.focusField"],
  "INIT-02": ["init.reorderAuto", "init.open"],
  "INIT-03": ["init.removeStep", "init.setArg"],
  "INIT-04": ["init.addStep"],
  "INIT-05": ["init.open", "ack.set"],
  "AUTH-01": ["authority.chooseMechanism", "ack.set"],
  "AUTH-02": ["init.setArg", "init.focusField"],
  "LINK-01": ["init.confirmAddress", "init.focusField"],
  "NET-01": ["deploy.usePath", "chain.focusPicker"],
  "NET-02": ["chain.focusPicker"],
  "NET-03": ["deploy.missingContracts"],
  "NET-04": ["chain.focusPicker"],
  "NET-05": ["deploy.newSalt"],
  "NET-06": ["deploy.removeFacets"],
  "NET-07": ["chain.useAnotherRpc"],
  "NET-08": ["ack.set", "chain.focusPicker"],
};

const OWNER_BY_PREFIX: Record<string, string> = { SEL: "C2", SEM: "C2", CORE: "C3", DEP: "C3", STO: "C3", INIT: "C4a", AUTH: "C4c", LINK: "C4c", NET: "C6" };

describe("PROBLEMS", () => {
  test("covers all 32 codes", () => {
    expect(PROBLEM_CODES.length).toBe(32);
    expect(new Set(PROBLEM_CODES)).toEqual(new Set(Object.keys(CHECKS_TABLE) as ProblemCode[]));
    expect(PROBLEM_CODES.every(isProblemCode)).toBe(true);
    expect(isProblemCode("UPG-01")).toBe(false);
  });

  test.each(Object.keys(CHECKS_TABLE) as ProblemCode[])("%s matches the checks table and contracts §3.3", (code) => {
    const info = PROBLEMS[code];
    const [severity, ack] = CHECKS_TABLE[code];
    expect(info.severity).toBe(severity as typeof info.severity);
    expect(info.ack === true).toBe(ack);
    expect(info.owner).toBe(OWNER_BY_PREFIX[code.split("-")[0] ?? ""] as typeof info.owner);
    expect(info.fixes).toEqual(FIXES[code] as typeof info.fixes);
    expect(info.fixes.every(isCommandId)).toBe(true);
  });
});

describe("problemId", () => {
  test("builds the spec's stable ids", () => {
    expect(problemId("SEL-01", { kind: "selector", selector: "0xcdfe7f5c" })).toBe("SEL-01:0xcdfe7f5c");
    expect(problemId("SEL-01", { kind: "selector", selector: "0xcdfe7f5c", facet: "AxelarGatewayAdapter" })).toBe("SEL-01:0xcdfe7f5c");
    expect(problemId("DEP-01", { kind: "facet", facet: "VaultCore" })).toBe("DEP-01:VaultCore");
    expect(problemId("INIT-01", { kind: "init", path: "bundle.p.asset" })).toBe("INIT-01:bundle.p.asset");
    expect(problemId("CORE-02", { kind: "diamond" })).toBe("CORE-02:diamond");
    expect(problemId("NET-03", { kind: "chain", chainId: 11155111 })).toBe("NET-03:11155111");
    expect(problemId("DEP-01", "VaultCore")).toBe("DEP-01:VaultCore");
  });

  test("joins several anchors with +, in the order given", () => {
    const sides = [
      { kind: "facet", facet: "AccessControlDiamondCut" },
      { kind: "facet", facet: "GovernedDiamondCut" },
    ] as const;
    expect(problemId("CORE-03", sides)).toBe("CORE-03:AccessControlDiamondCut+GovernedDiamondCut");
    expect(anchorKey("steps[2].admin")).toBe("steps[2].admin");
  });
});

describe("NotImplemented", () => {
  test("names its work package in the UI's words", () => {
    let caught: unknown;
    try {
      notImplemented("C2", "analyze");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NotImplemented);
    expect(isNotImplemented(caught)).toBe(true);
    expect(isNotImplemented(new Error("x"))).toBe(false);
    const error = caught as NotImplemented;
    expect(error.message).toBe("Not built yet · WP-C2");
    expect(error.wp).toBe("C2");
    expect(error.fn).toBe("analyze");
  });

  test("WP ids are the plan's 74, each once", () => {
    expect(WP_IDS.length).toBe(74);
    expect(new Set(WP_IDS).size).toBe(74);
  });
});
