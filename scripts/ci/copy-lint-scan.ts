// Pure logic behind `bun scripts/ci/copy-lint.ts` (brief Q6 "C10's lintCopy over every UI string"): walks a
// TypeScript/TSX source file's AST (via the `typescript` package, already a dev dependency) and extracts the
// candidate copy strings — JSX text, the string props people read, toast/banner call text, and (for C10's own
// message and line templates) every literal — with their 1-based source position, so findings report file:line.
import ts from "typescript";

export type CopySpan = { readonly line: number; readonly text: string };

/** JSX/object-literal props whose value is copy a person reads (brief Q6: "title, aria-label, label, placeholder"). */
const COPY_PROP_NAMES = new Set(["title", "aria-label", "label", "placeholder"]);

/** Call expressions whose text arguments are toast or banner copy, matched by the callee's last identifier. */
const COPY_CALL_PATTERN = /toast|banner/i;

function lineOf(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

/** Every literal span inside a string or template literal: plain text for a simple literal, one span per
 * literal segment (`TemplateHead`/`Middle`/`Tail`) for an interpolated one, so an expression hole is never
 * checked as text and a literal segment's own position is exact. */
function literalSpans(sourceFile: ts.SourceFile, node: ts.Node): CopySpan[] {
  if (ts.isStringLiteralLike(node)) return [{ line: lineOf(sourceFile, node.getStart(sourceFile)), text: node.text }];
  if (ts.isTemplateExpression(node)) {
    const spans: CopySpan[] = [{ line: lineOf(sourceFile, node.head.getStart(sourceFile)), text: node.head.text }];
    for (const span of node.templateSpans) {
      spans.push({ line: lineOf(sourceFile, span.literal.getStart(sourceFile)), text: span.literal.text });
    }
    return spans;
  }
  return [];
}

/** The callee's dotted name (`toast`, `Toasts.push`), so a call anywhere in a member chain still matches. */
function calleeName(expr: ts.LeftHandSideExpression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return `${calleeName(expr.expression)}.${expr.name.text}`;
  return "";
}

/** JSX text, target props (JSX attributes and matching object properties) and toast/banner call arguments,
 * anywhere in the file. Meant for app UI source (brief: apps/studio/src/**, S12's problem pages). */
export function extractAppCopy(sourceFile: ts.SourceFile): CopySpan[] {
  const spans: CopySpan[] = [];

  function visit(node: ts.Node): void {
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (text) spans.push({ line: lineOf(sourceFile, node.getStart(sourceFile)), text });
    } else if (ts.isJsxAttribute(node) && COPY_PROP_NAMES.has(node.name.getText(sourceFile))) {
      const init = node.initializer;
      const literal = init && ts.isJsxExpression(init) ? init.expression : init;
      if (literal) spans.push(...literalSpans(sourceFile, literal));
    } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && COPY_PROP_NAMES.has(node.name.text)) {
      spans.push(...literalSpans(sourceFile, node.initializer));
    } else if (ts.isCallExpression(node) && COPY_CALL_PATTERN.test(calleeName(node.expression))) {
      for (const arg of node.arguments) spans.push(...literalSpans(sourceFile, arg));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return spans;
}

/** Every string and template literal in the file, except object-literal property keys and import/export module
 * specifiers. Meant for C10's own narrate templates (packages/core/src/narrate/{lines,narrate,problem}.ts), a
 * small, known fileset where a blanket scan is safe. */
export function extractTemplateCopy(sourceFile: ts.SourceFile): CopySpan[] {
  const spans: CopySpan[] = [];

  function visit(node: ts.Node): void {
    const parent = node.parent as ts.Node | undefined;
    const isModuleSpecifier =
      parent !== undefined &&
      (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
      parent.moduleSpecifier === node;
    const isPropertyKey = parent !== undefined && ts.isPropertyAssignment(parent) && parent.name === node;
    if (!isModuleSpecifier && !isPropertyKey && (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node))) {
      spans.push(...literalSpans(sourceFile, node));
      if (ts.isTemplateExpression(node)) {
        for (const span of node.templateSpans) ts.forEachChild(span.expression, visit);
        return; // literal parts already captured; don't re-descend into the whole template
      }
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return spans;
}

export function parseSource(fileName: string, text: string): ts.SourceFile {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
}
