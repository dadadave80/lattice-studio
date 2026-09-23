import { MenuCommandItem, MenuSeparator } from "@/ui";
import type { SelectorView } from "./structure-model";

/**
 * A selector row's menu: the pin's menu (IR L192). Route here where another facet serves it or it's contested;
 * Leave out of the diamond where it routes here; Bring back where it's out. A seam offers no route.
 */
export function SelectorMenu({ facet, view }: { facet: string; view: SelectorView }) {
  const { selector, state } = view;
  const routeHere = state === "elsewhere" || state === "contested";
  const here = state === "routed" || state === "default" || (state === "seam" && view.owner === facet);
  return (
    <>
      {routeHere ? <MenuCommandItem command={{ id: "selector.route", args: { selector, facet } }} label="Route here" /> : null}
      {here && state !== "seam" ? (
        <MenuCommandItem command={{ id: "selector.exclude", args: { selector } }} label="Leave out of the diamond" />
      ) : null}
      {state === "excluded" ? (
        <MenuCommandItem command={{ id: "selector.include", args: { selector, facet } }} label="Bring back" />
      ) : null}
      {state === "seam" ? null : <MenuSeparator />}
      <MenuCommandItem command={{ id: "selector.copy", args: { selector, facet } }} label="Copy selector" icon="copy" />
      <MenuCommandItem command={{ id: "selector.copySignature", args: { selector, facet } }} label="Copy signature" />
      <MenuCommandItem command={{ id: "selector.showOwner", args: { selector } }} label="Show owner" />
    </>
  );
}
