import type { Problem } from "@lattice-studio/core";
import { isPlaceholder } from "@/contracts";
import { MenuCommandItem, MenuSeparator } from "@/ui";
import { placeholderFixLabel } from "./fix-labels";

/** The card a problem is about: its first facet or selector anchor with a facet. */
function cardOf(problem: Problem): string | undefined {
  for (const anchor of problem.where) {
    if ((anchor.kind === "facet" || anchor.kind === "selector") && anchor.facet !== undefined) return anchor.facet;
  }
  return undefined;
}

/**
 * A problem's menu: the note's (IR L193), its fixes then Go to card, so a collision can be settled from the
 * Problems branch (Flow 4, spec L437).
 */
export function ProblemMenu({ problem }: { problem: Problem }) {
  const card = cardOf(problem);
  return (
    <>
      {problem.fixes.map((fix) => {
        const label = isPlaceholder(fix.id) ? placeholderFixLabel(problem.code, fix) : undefined;
        return <MenuCommandItem key={JSON.stringify(fix)} command={fix} {...(label ? { label } : {})} />;
      })}
      {card !== undefined ? (
        <>
          {problem.fixes.length > 0 ? <MenuSeparator /> : null}
          <MenuCommandItem command={{ id: "sheet.locate", args: { facet: card } }} label="Go to card" icon="locate" />
        </>
      ) : null}
    </>
  );
}
