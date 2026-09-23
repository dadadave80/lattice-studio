import { useEffect, useState, type RefObject } from "react";
import { isTypingTarget } from "@/commands/keys/key-context";

/**
 * Where Space belongs to the focused control, not to panning: buttons and links activate on it, menus, lists,
 * trees and tabs select with it, and inside a card's rows it does what clicking the pin does (IR L22).
 */
const SPACE_OWNERS = [
  "button", "a[href]", "select", "summary", "[role='button']", "[role='menuitem']", "[role='menuitemcheckbox']",
  "[role='menuitemradio']", "[role='option']", "[role='tab']", "[role='treeitem']", "[role='checkbox']",
  "[role='switch']", "[role='radio']", "[data-keyctx='card-rows']",
].join(", ");

function ownsSpace(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return isTypingTarget(target) || target.closest(SPACE_OWNERS) !== null;
}

/**
 * Space held, then drag, pans (IR L25, PA L34 bug 26): true while Space is down with the pointer over the
 * sheet or focus inside it, unless the focused control uses Space itself. Letting go, or the window losing
 * focus, ends it.
 */
export function useSpacePan(sheet: RefObject<HTMLElement | null>): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const el = sheet.current;
    if (!el) return undefined;
    let over = false;
    const enter = () => {
      over = true;
    };
    const leave = () => {
      over = false;
    };
    const down = (event: KeyboardEvent) => {
      if (event.key !== " " || event.repeat || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey || ownsSpace(event.target)) return;
      const inside = event.target instanceof Node && el.contains(event.target);
      if (!over && !inside) return;
      setHeld(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === " ") setHeld(false);
    };
    const release = () => setHeld(false);
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  }, [sheet]);
  return held;
}
