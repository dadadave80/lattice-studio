/**
 * The ordered check registry (contracts §3.4). Frozen: owners edit only their own check files.
 * Order: sel, sem (C2) · core, dep, sto (C3) · init (C4a) · auth, link (C4c) · net (C6).
 */
import type { Check, CheckName } from "../model/analysis";
import type { RunChecksFn } from "../model/api";
import { renderProblem } from "../narrate/problem";
import { checkAuth } from "./auth";
import { checkCore } from "./core";
import { checkDep } from "./dep";
import { checkInit } from "./init";
import { checkLink } from "./link";
import { checkNet } from "./net";
import { checkSel } from "./sel";
import { checkSem } from "./sem";
import { checkSto } from "./sto";

/** Every check, in the order `runChecks` calls them. */
export const CHECKS: readonly { name: CheckName; run: Check }[] = [
  { name: "sel", run: checkSel },
  { name: "sem", run: checkSem },
  { name: "core", run: checkCore },
  { name: "dep", run: checkDep },
  { name: "sto", run: checkSto },
  { name: "init", run: checkInit },
  { name: "auth", run: checkAuth },
  { name: "link", run: checkLink },
  { name: "net", run: checkNet },
];

/**
 * Runs `checks` (the registry's, by default) in order and concatenates their problems, unsorted:
 * C2's `sortProblems` orders them. Every problem's `message` is rendered here, and only here, with
 * `renderProblem(code, params)`; checks leave it "". Tests inject fakes through `checks`.
 */
export const runChecks: RunChecksFn = (input, checks = CHECKS.map((check) => check.run)) =>
  checks.flatMap((check) => check(input)).map((p) => ({ ...p, message: renderProblem(p.code, p.params) }));

export { checkAuth, checkCore, checkDep, checkInit, checkLink, checkNet, checkSel, checkSem, checkSto };
