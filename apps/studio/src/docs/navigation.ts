/**
 * Whether the user has interacted with the page yet this session (a pointer press or a key press): the
 * signal a doc view's own mount effect reads before moving focus to its heading. A genuine in-place
 * navigation (a click on a doc link, the App menu's Help, the back control) always follows a real
 * interaction, so it moves focus; a doc view that's on screen only because session state was restored on
 * load has no interaction behind it yet, so it must not steal focus (WCAG 2.4.3, spec L751-L761).
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

document.addEventListener("pointerdown", mark, { capture: true });
document.addEventListener("keydown", (event) => {
  if (!FOCUS_ONLY_KEYS.has(event.key)) mark();
}, { capture: true });

/** True once the user has interacted with the page at all this session. */
export function hasUserInteracted(): boolean {
  return interacted;
}

/** @internal Test-only: simulates an interaction having already happened, for a test that isn't itself about it. */
export function markUserInteractedForTest(): void {
  interacted = true;
}

/** @internal Test-only: back to "nothing has happened yet", for a test of the restored-on-load case. */
export function resetUserInteractionForTest(): void {
  interacted = false;
}
