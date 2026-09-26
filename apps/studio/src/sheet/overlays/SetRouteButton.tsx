import type { Hex4 } from "@lattice-studio/core";
import { useCommandState } from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { routeRef, routeSet } from "./set-route";

export type SetRouteButtonProps = {
  selectors: readonly Hex4[];
  facet: string;
  verb?: "keep";
};

/** Keep {A} or Route to {B} for a collision note's whole set (spec L435), worded and gated by `selector.route`. */
export function SetRouteButton({ selectors, facet, verb }: SetRouteButtonProps) {
  const state = useCommandState(routeRef(selectors[0], facet, verb), "button");
  return (
    <Button
      size="small"
      disabledReason={state.ok ? null : state.reason}
      onClick={() => routeSet(selectors, facet, verb, "button")}
    >
      {state.title}
    </Button>
  );
}
