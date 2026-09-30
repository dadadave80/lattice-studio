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
    const over = (event: PointerEvent) => setHovered(cardOf(event.target));
    const leave = () => setHovered(null);
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
