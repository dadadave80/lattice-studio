/**
 * The card under the pointer, from one `pointerover` listener on the sheet (React Flow's root) and each node
 * wrapper's `data-id`, so no card subscribes to anything for it. The glyph itself takes no pointer, so moving
 * onto it counts as leaving the card, as its `:hover` does.
 */
import { useEffect, useState } from "react";

function cardOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(".react-flow__node[data-id]")?.dataset.id ?? null;
}

export function useHoveredCard(root: HTMLElement | null): string | null {
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    if (!root) return undefined;
    // Moving over a card's rows fires `pointerover` at every one: only a change of card reaches React.
    let current: string | null = null;
    const show = (next: string | null) => {
      if (next === current) return;
      current = next;
      setHovered(next);
    };
    const over = (event: PointerEvent) => show(cardOf(event.target));
    const leave = () => show(null);
    root.addEventListener("pointerover", over);
    root.addEventListener("pointerleave", leave);
    return () => {
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointerleave", leave);
      setHovered(null);
    };
  }, [root]);
  return hovered;
}
