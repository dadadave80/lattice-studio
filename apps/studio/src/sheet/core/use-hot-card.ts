/**
 * The card under the pointer, and the card holding keyboard focus, from listeners on the sheet (React Flow's root)
 * and each node wrapper's `data-id`, so no card subscribes to anything for them. The glyph itself takes no
 * pointer, so moving onto it counts as leaving the card, as its `:hover` does. A click focuses a card too, but
 * only keyboard focus (`:focus-visible`) counts: a clicked card that's then deselected draws no trace.
 */
import { useEffect, useState } from "react";

function cardOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(".react-flow__node[data-id]")?.dataset.id ?? null;
}

/** A setter that reaches React only when the value changes. */
function changes(set: (next: string | null) => void): (next: string | null) => void {
  let current: string | null = null;
  return (next) => {
    if (next === current) return;
    current = next;
    set(next);
  };
}

export function useHoveredCard(root: HTMLElement | null): string | null {
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    if (!root) return undefined;
    // Moving over a card's rows fires `pointerover` at every one: only a change of card reaches React.
    const show = changes(setHovered);
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

function keyboardCard(el: Element | null): string | null {
  return el instanceof Element && el.matches(":focus-visible") ? cardOf(el) : null;
}

export function useKeyboardFocusedCard(root: HTMLElement | null): string | null {
  const [focused, setFocused] = useState<string | null>(null);
  useEffect(() => {
    if (!root) return undefined;
    const show = changes(setFocused);
    const into = (event: FocusEvent) => show(keyboardCard(event.target instanceof Element ? event.target : null));
    const out = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget)) show(null);
    };
    root.addEventListener("focusin", into);
    root.addEventListener("focusout", out);
    const active = document.activeElement;
    if (active && root.contains(active)) show(keyboardCard(active));
    return () => {
      root.removeEventListener("focusin", into);
      root.removeEventListener("focusout", out);
      setFocused(null);
    };
  }, [root]);
  return focused;
}
