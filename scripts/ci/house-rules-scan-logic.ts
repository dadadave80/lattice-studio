// Pure logic behind `bun scripts/ci/house-rules-scan.ts` (spec L902, three house rules): read Zustand state only
// through selector hooks (a `getState()` call in render is memoized stale, react#33302); never read
// `temporal.getState()` in render; no "throw a promise until hydrated".
import ts from "typescript";

export type HouseRuleFinding = { readonly line: number; readonly rule: string; readonly match: string };

/** Calls that wrap a callback the compiler and React run outside the render pass: inside one of these, a
 * `getState()` read is a normal effect/handler read, not a render-time one. */
const SAFE_WRAPPER_CALLEES = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect", "useCallback", "useMemo"]);

function lineOf(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function calleeName(expr: ts.LeftHandSideExpression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return "";
}

/** True when `node` sits inside a safe wrapper's callback (a `useEffect`/`useCallback`/… argument) or a JSX
 * event-handler attribute (`onClick={() => …}`), walking up the lexical parent chain. */
function isInsideSafeWrapper(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxAttribute(current)) return true;
    if (ts.isCallExpression(current) && SAFE_WRAPPER_CALLEES.has(calleeName(current.expression))) return true;
    current = current.parent;
  }
  return false;
}

/** True for `object.getState(` or a bare `getState(` call (a store hook's own `.getState`, e.g. `useX.getState()`). */
function isGetStateCall(node: ts.CallExpression): { readonly object: string } | null {
  const expr = node.expression;
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === "getState") {
    return { object: ts.isIdentifier(expr.expression) ? expr.expression.text : expr.expression.getText() };
  }
  return null;
}

/** `temporal.getState(` anywhere (rule 2: never in render — there's no render-safe use for the temporal store's
 * own snapshot, so any occurrence is flagged), and any other `x.getState(` called outside a safe wrapper or a
 * JSX event handler (rule 1: selector hooks only; a direct render-time read is memoized stale). */
export function findHouseRuleViolations(sourceFile: ts.SourceFile): HouseRuleFinding[] {
  const findings: HouseRuleFinding[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const getState = isGetStateCall(node);
      if (getState) {
        const text = node.getText(sourceFile);
        const isTemporal = getState.object === "temporal" || getState.object.endsWith(".temporal");
        if (isTemporal) {
          findings.push({ line: lineOf(sourceFile, node.getStart(sourceFile)), rule: "temporal-getstate", match: text });
        } else if (!isInsideSafeWrapper(node)) {
          findings.push({ line: lineOf(sourceFile, node.getStart(sourceFile)), rule: "render-getstate", match: text });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return findings;
}

const PROMISE_NAME_PATTERN = /promise/i;

/** True when a thrown expression looks like a promise ("throw a promise until hydrated"): `new Promise(...)`, a
 * `.then`/`.catch`/`.finally` chain, or an identifier/property whose name says "promise". A re-thrown caught
 * error (`throw error`, `throw caught`) or `throw new Error(...)` never matches. */
function looksLikePromise(expr: ts.Expression): boolean {
  if (ts.isNewExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === "Promise") return true;
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    if (["then", "catch", "finally"].includes(expr.expression.name.text)) return true;
  }
  if (ts.isIdentifier(expr) && PROMISE_NAME_PATTERN.test(expr.text)) return true;
  if (ts.isPropertyAccessExpression(expr) && PROMISE_NAME_PATTERN.test(expr.name.text)) return true;
  return false;
}

export function findThrownPromises(sourceFile: ts.SourceFile): HouseRuleFinding[] {
  const findings: HouseRuleFinding[] = [];
  function visit(node: ts.Node): void {
    if (ts.isThrowStatement(node) && node.expression && looksLikePromise(node.expression)) {
      findings.push({ line: lineOf(sourceFile, node.getStart(sourceFile)), rule: "thrown-promise", match: node.getText(sourceFile) });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return findings;
}

export function parseSource(fileName: string, text: string): ts.SourceFile {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
}
