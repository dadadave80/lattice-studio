/**
 * Whether the user has interacted with the page yet this session (a pointer press, a key press or a
 * click): the signal a doc view's own mount effect reads before moving focus to its heading. A genuine
 * in-place navigation (a click on a doc link, the App menu's Help, the back control) always follows a real
 * interaction, so it moves focus; a doc view that's on screen only because session state was restored on
 * load has no interaction behind it yet, so it must not steal focus (WCAG 2.4.3, spec L751-L761).
 *
 * `click` is its own listener, not implied by `pointerdown`: screen-reader activation (NVDA/JAWS browse-mode
 * Enter, VoiceOver VO+Space) often reaches the page as a trusted `click` with neither a `pointerdown` nor a
 * `keydown` first. Without it, a first-session screen-reader user who opens a doc gets no focus move.
 *
 * Imported from `services.ts` (eager) as well as the lazy doc view components, so the listeners attach at
 * app start, before the first click anywhere — including the very click that first opens the docs.
 */
let interacted = false;

function mark(): void {
  interacted = true;
}

// Tab and the bare modifiers move focus around without the user having chosen to do anything yet; every
// other key is a real action (typing, Enter, Space, an arrow), so it counts.
const FOCUS_ONLY_KEYS = new Set(["Tab", "Shift", "Control", "Alt", "Meta"]);

const OPTS: AddEventListenerOptions = { capture: true, passive: true };

document.addEventListener("pointerdown", mark, OPTS);
document.addEventListener("click", mark, OPTS);
document.addEventListener(
  "keydown",
  (event) => {
    if (!FOCUS_ONLY_KEYS.has(event.key)) mark();
  },
  OPTS,
);

/** True once the user has interacted with the page at all this session. */
export function hasUserInteracted(): boolean {
  return interacted;
}

/** @internal `test-support.ts` only: sets the flag directly, for tests. */
export function setUserInteractedForTest(value: boolean): void {
  interacted = value;
}
