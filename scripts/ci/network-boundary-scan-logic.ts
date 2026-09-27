// Pure logic behind `bun scripts/ci/network-boundary-scan.ts` (§19 audit #2, spec L97: "only the lazily loaded
// chain module talks to the network"). Every other part of the app is allowed to read the committed, same-origin
// catalog (a build artifact, not the network in the security sense) and nothing else network-shaped.
import ts from "typescript";

export type BoundaryFinding = { readonly line: number; readonly match: string };

/** Files allowed to call `fetch` for the app's own same-origin catalog and service-worker assets (§19 row 2's
 * list), relative to `apps/studio/src`. Everything under `chain/` is the lazily loaded network module and is
 * always allowed, so it isn't listed here. */
export const ALLOWED_FETCH_FILES: readonly string[] = [
  "main.tsx",
  "pwa/connection.ts",
  "contracts/catalog.ts",
  "catalog/lookup.ts",
  "catalog/loader.ts",
];

const NETWORK_CALL_NAMES = new Set(["createPublicClient", "createWalletClient"]);
const TRANSPORT_CALL_NAMES = new Set(["http", "webSocket", "custom"]);

function lineOf(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function calleeName(expr: ts.LeftHandSideExpression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return "";
}

/** The receiver of a property access, so `globalThis.fetch(`, `window.fetch(` and `self.fetch(` are caught
 * alongside a bare `fetch(`: all four reach the same global, and `chain/verify/app-deps.ts` uses the
 * `globalThis.` form precisely to make that call injectable, not to hide it from a scan. */
const GLOBAL_RECEIVERS = new Set(["globalThis", "window", "self"]);

function isGlobalFetchCall(expr: ts.LeftHandSideExpression): boolean {
  if (ts.isIdentifier(expr)) return false;
  return (
    ts.isPropertyAccessExpression(expr) &&
    expr.name.text === "fetch" &&
    ts.isIdentifier(expr.expression) &&
    GLOBAL_RECEIVERS.has(expr.expression.text)
  );
}

/** True for `relativePath` (posix-separated, relative to `apps/studio/src`) inside the lazily loaded chain
 * module, or one of `ALLOWED_FETCH_FILES`. */
export function isAllowedNetworkFile(relativePath: string): boolean {
  const posix = relativePath.split("\\").join("/");
  return posix.startsWith("chain/") || ALLOWED_FETCH_FILES.includes(posix);
}

/**
 * Every `fetch(`, `new WebSocket(`, viem client constructor (`createPublicClient`, `createWalletClient`) and
 * viem transport factory (`http(`, `webSocket(`, `custom(`, matched only when imported from a `"viem"` or
 * `"viem/…"` module so an unrelated same-named helper is never flagged) call in the file, with its 1-based line.
 * The caller decides whether the file is allowed to have any.
 */
export function findNetworkCalls(sourceFile: ts.SourceFile): BoundaryFinding[] {
  const viemImportedNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== "viem" && !statement.moduleSpecifier.text.startsWith("viem/")) continue;
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) viemImportedNames.add(el.name.text);
    }
  }

  const findings: BoundaryFinding[] = [];
  function visit(node: ts.Node): void {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "WebSocket") {
      findings.push({ line: lineOf(sourceFile, node.getStart(sourceFile)), match: "new WebSocket(" });
    } else if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name === "fetch" && ts.isIdentifier(node.expression)) {
        findings.push({ line: lineOf(sourceFile, node.getStart(sourceFile)), match: "fetch(" });
      } else if (isGlobalFetchCall(node.expression)) {
        findings.push({ line: lineOf(sourceFile, node.getStart(sourceFile)), match: `${node.expression.getText(sourceFile)}(` });
      } else if (NETWORK_CALL_NAMES.has(name)) {
        findings.push({ line: lineOf(sourceFile, node.getStart(sourceFile)), match: `${name}(` });
      } else if (TRANSPORT_CALL_NAMES.has(name) && viemImportedNames.has(name)) {
        findings.push({ line: lineOf(sourceFile, node.getStart(sourceFile)), match: `${name}(` });
      }
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
