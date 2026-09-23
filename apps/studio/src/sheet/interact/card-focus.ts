import { cardElement } from "@/a11y/focus";
import { ensureVisible } from "@/sheet/canvas/sheet-view";

const FRAMES = 10;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * How a card takes focus on the sheet (S9's `provideCardFocus`): pan it clear of everything floating over the
 * sheet, then focus React Flow's node wrapper once it's rendered (after an undo it comes back a render later).
 * A keyboard move to an off-screen card pans first, then focuses (spec L755).
 */
export async function focusCardInView(facet: string): Promise<boolean> {
  ensureVisible(facet);
  for (let i = 0; i <= FRAMES; i++) {
    const el = cardElement(facet);
    if (el) {
      el.focus({ preventScroll: true });
      return document.activeElement === el;
    }
    await nextFrame();
  }
  return false;
}
