import type { PinView } from "@/sheet/card/card-model";
import { MenuCommandItem, MenuSeparator } from "@/ui";

/**
 * A selector row's menu: the pin's menu (IR L192). Route here where another facet serves it or it's contested;
 * Leave out of the diamond where it routes here; Bring back where it's out. A seam offers no route, and a
 * selector the analysis hasn't checked yet offers none of these.
 */
export function SelectorMenu({ facet, view }: { facet: string; view: PinView }) {
  const { selector, state } = view;
  const routeHere = state === "elsewhere" || state === "contested";
  const leaveOut = state === "routed" || state === "default";
  const change = routeHere || leaveOut || state === "excluded";
  return (
    <>
      {routeHere ? <MenuCommandItem command={{ id: "selector.route", args: { selector, facet } }} label="Route here" /> : null}
      {leaveOut ? (
        <MenuCommandItem command={{ id: "selector.exclude", args: { selector } }} label="Leave out of the diamond" />
      ) : null}
      {state === "excluded" ? (
        <MenuCommandItem command={{ id: "selector.include", args: { selector, facet } }} label="Bring back" />
      ) : null}
      {change ? <MenuSeparator /> : null}
      <MenuCommandItem command={{ id: "selector.copy", args: { selector, facet } }} label="Copy selector" icon="copy" />
      <MenuCommandItem command={{ id: "selector.copySignature", args: { selector, facet } }} label="Copy signature" />
      <MenuCommandItem command={{ id: "selector.showOwner", args: { selector } }} label="Show owner" />
    </>
  );
}
