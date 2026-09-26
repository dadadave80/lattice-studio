/**
 * Compact axe findings: one line per rule and element, naming the element by its markup (ids from React's
 * `useId` change between runs, so the snippet is what identifies it) and the criterion the rule checks.
 */
import type { AxeResults, Result } from "axe-core";

/** "wcag258" → "2.5.8"; the first WCAG criterion tag on a rule. */
export function criterion(rule: Result): string {
  const tag = rule.tags.find((t) => /^wcag\d{3,4}$/.test(t));
  return tag ? tag.slice(4).split("").join(".") : rule.tags.join(",");
}

function snippet(html: string): string {
  return html.replace(/\s+/g, " ").replace(/ (id|class|style)="[^"]*"/g, "").slice(0, 160);
}

/** One line per violating element: "target-size 2.5.8 (serious) <button …>Keep ERC20</button> — fix any of: …". */
export function findings(results: AxeResults): string[] {
  return results.violations.flatMap((rule) =>
    rule.nodes.map((node) => {
      const why = (node.failureSummary ?? rule.help).replace(/\s+/g, " ").slice(0, 200);
      return `${rule.id} ${criterion(rule)} (${rule.impact ?? "unknown"}) ${snippet(node.html)} — ${why}`;
    }),
  );
}
