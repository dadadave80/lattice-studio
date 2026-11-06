import { lazy, Suspense, use, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { announce, KEY_CONTEXT_ATTRIBUTE, log, registerDropTarget } from "@/contracts";
import { handOverStartFocus, StartBlock } from "@/sheet/chrome/StartBlock";
import { SHEET_LOADING } from "./copy";
import { loadSheetParts } from "./parts";
import styles from "./Sheet.module.css";

/**
 * The first paint is the static shell (spec L818), so the canvas (React Flow and d3, the facet card, the
 * sheet's layers, Back to content, the grid and React Flow's `base.css`) is its own chunk, requested as soon as
 * the app renders, together with the parts other modules register for it (`parts.ts`). The commands, the view
 * API (`sheet-view.ts`) and the stored viewport are in the entry, so nothing that runs before then is lost: a
 * zoom or Locate moves the stored viewport and the canvas opens there.
 */
const SheetCanvas = lazy(() =>
  Promise.all([loadSheetParts(), import("./SheetCanvas")]).then(([, m]) => ({ default: m.SheetCanvas })),
);

const KEY_CONTEXT = { [KEY_CONTEXT_ATTRIBUTE]: "sheet" };
type StartActivation = KeyboardEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>;

function CanvasAfterActivation({ pending }: { pending: Promise<void> | null }) {
  if (pending) use(pending);
  return <SheetCanvas />;
}

/**
 * The sheet while its canvas loads: the region's ground and, on an empty sheet, the Start block, which is the
 * empty sheet's largest paint (spec L815) and works before the canvas does; the canvas's own Start block layer
 * takes over when it mounts, and the control that had focus here keeps it there. A catalog row dropped here places
 * nothing, so the drop says why (Q28) rather than vanishing.
 */
function SheetLoading({ hold }: { hold: (event: StartActivation) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    return registerDropTarget({
      element,
      drop: () => {
        log({ tag: "Note", text: SHEET_LOADING });
        announce(SHEET_LOADING);
      },
    });
  }, []);
  // Runs as this sheet leaves the page, before its block is removed, while focus is still in it.
  useLayoutEffect(() => {
    const element = ref.current;
    return () => {
      if (element) handOverStartFocus(element);
    };
  }, []);
  return (
    <div ref={ref} className={styles.sheet} role="presentation" data-sheet-loading="" onPointerDownCapture={hold} onKeyDown={hold} {...KEY_CONTEXT}>
      <StartBlock />
    </div>
  );
}

/** The sheet (WP-S4b): see `SheetCanvas.tsx`. */
export function Sheet() {
  const [pending, setPending] = useState<Promise<void> | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const hold = (event: StartActivation): void => {
    const pointer = "pointerId" in event;
    if (pointer ? event.button !== 0 || !event.isPrimary : event.key !== " " || event.repeat || event.defaultPrevented) return;
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button || button.matches(":disabled, [aria-disabled='true']") || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    let timer: number | undefined;
    const waiting = new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true }));
    const release = (): void => {
      controller.abort();
      active.current = null;
      setPending(null);
    };
    // Native activation may follow pointerup/keyup; keep its original target through click dispatch.
    const afterDispatch = (): void => { timer ??= window.setTimeout(release, 0); };
    const options = { capture: true, signal: controller.signal };
    window.addEventListener("click", (click) => {
      if (click.target instanceof Node && button.contains(click.target)) afterDispatch();
    }, options);
    if (pointer) {
      const pointerId = event.pointerId;
      window.addEventListener("pointerup", (up) => {
        if (up.pointerId !== pointerId) return;
        const rect = button.getBoundingClientRect();
        if (up.clientX < rect.left || up.clientX > rect.right || up.clientY < rect.top || up.clientY > rect.bottom) afterDispatch();
      }, options);
      window.addEventListener("pointercancel", (cancel) => { if (cancel.pointerId === pointerId) afterDispatch(); }, options);
    } else {
      window.addEventListener("keyup", (up) => { if (up.key === " ") afterDispatch(); }, options);
    }
    window.addEventListener("blur", release, { signal: controller.signal });
    setPending(waiting);
  };
  return (
    <Suspense fallback={<SheetLoading hold={hold} />}>
      <CanvasAfterActivation pending={pending} />
    </Suspense>
  );
}
