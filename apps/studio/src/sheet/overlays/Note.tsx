import type { CommandRef, Rect } from "@lattice-studio/core";
import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { announce, getAnalysis } from "@/contracts";
import { ensureElementVisible, sheetSize } from "@/sheet/canvas";
import { CommandButton } from "@/ui/buttons/CommandButton";
import { ContextMenu } from "@/ui/overlays/ContextMenu";
import { cx } from "@/ui/shared/cx";
import { CodeText } from "./CodeText";
import { problemCursor, setProblemCursor } from "./navigate";
import { NoteMenuItems } from "./NoteMenuItems";
import type { NoteModel } from "./note-model";
import { subscribeNoteFocus, takeNoteFocus } from "./note-focus";
import { OwnerMenu } from "./OwnerMenu";
import { SetRouteButton } from "./SetRouteButton";
import styles from "./Note.module.css";

export type NoteProps = {
  note: NoteModel;
  /** Where C9 placed it, in sheet units; its height is the one the note measured. */
  rect: Rect;
  /** Brought into view with the note when F8 lands on it: the note and its first card. */
  frame: Rect;
  /** The fixes as the note offers them (a Place fix carries where the card lands). */
  fixes: readonly CommandRef[];
  /** The card the note is about, when one is on the sheet (Go to card, and where focus goes on resolve). */
  card: string | undefined;
  /** Resolved: fading out, no longer interactive. */
  leaving: boolean;
  onHeight: (id: string, height: number) => void;
  onLeft: (id: string) => void;
};

/** The screen px auto-pan keeps around a frame (S4b's CLEAR_MARGIN, twice). */
const FRAME_ROOM = 32;

function cardElement(card: string | undefined): HTMLElement | null {
  if (card === undefined) return null;
  return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(card)}"]`);
}

/** Pans the note, with its card when both fit, clear of everything floating over the sheet. */
function reveal(note: HTMLElement, frame: HTMLElement | null): void {
  const size = sheetSize();
  const box = frame?.getBoundingClientRect();
  const fits = box !== undefined && box.width <= size.width - FRAME_ROOM && box.height <= size.height - FRAME_ROOM;
  ensureElementVisible(fits && frame ? frame : note);
}

function Actions({ note, fixes, ownerOpen, onOwnerOpen }: {
  note: NoteModel;
  fixes: readonly CommandRef[];
  ownerOpen: boolean;
  onOwnerOpen: (open: boolean) => void;
}) {
  if (note.kind !== "collision") {
    return (
      <>
        {fixes.map((fix) => (
          <CommandButton key={JSON.stringify(fix)} command={fix} size="small" />
        ))}
      </>
    );
  }
  const selectors = note.selectors.map((s) => s.hex);
  const [a, b] = note.contenders;
  return (
    <>
      {note.contenders.length === 2 && a !== undefined && b !== undefined ? (
        <>
          <SetRouteButton selectors={selectors} facet={a} verb="keep" />
          <SetRouteButton selectors={selectors} facet={b} />
        </>
      ) : (
        <OwnerMenu selectors={selectors} contenders={note.contenders} open={ownerOpen} onOpenChange={onOwnerOpen} />
      )}
      {selectors.length > 1 ? (
        <CommandButton
          command={{ id: "collision.choosePerSelector", args: { selectors } }}
          size="small"
        />
      ) : null}
    </>
  );
}

/**
 * A margin note (spec L435, L445, L449; IR L108): what the problem is and the buttons that fix it, beside its
 * ties or its card, with a leader the layer draws. A Tab stop, and where F8 lands; its context menu (right
 * click, Shift+F10, the Menu key, long press) offers the same fixes and Go to card (IR L196). Resolved, it
 * fades out (at once with reduced motion) and hands focus to its card.
 */
export const Note = memo(function Note({ note, rect, frame, fixes, card, leaving, onHeight, onLeft }: NoteProps) {
  const ref = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const leavingRef = useRef(leaving);
  const cardRef = useRef(card);
  const id = useId();
  const [ownerOpen, setOwnerOpen] = useState(false);
  const ownerMenu = note.kind === "collision" && note.contenders.length >= 3;
  const captionId = `${id}-caption`;
  const listId = `${id}-selectors`;
  const textId = `${id}-text`;

  useLayoutEffect(() => {
    leavingRef.current = leaving;
    cardRef.current = card;
  });

  // The layer places notes by their real height (the estimate only holds the first frame).
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    if (height > 0) onHeight(note.id, height);
  });

  // F8, problem.focus and Resolve collision… hand focus here, now or when the note shows.
  useEffect(() => {
    const serve = () => {
      const el = ref.current;
      if (!el || leavingRef.current) return;
      const request = takeNoteFocus(note.id);
      if (!request) return;
      const already = el.contains(document.activeElement);
      reveal(el, frameRef.current);
      if (request.open && ownerMenu) {
        el.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
        setOwnerOpen(true);
      } else if (request.open) {
        (el.querySelector<HTMLElement>("button") ?? el).focus({ preventScroll: true });
      } else {
        el.focus({ preventScroll: true });
      }
      // Focus didn't move (a second problem in the same note): say which one this is.
      if (already) {
        const problem = getAnalysis().problems.find((p) => p.id === request.problemId);
        if (problem) announce(problem.message);
      }
    };
    serve();
    return subscribeNoteFocus(() => {
      requestAnimationFrame(serve);
    });
  }, [note.id, ownerMenu]);

  // Resolved while focus was inside: focus goes to its card rather than being lost. Then it's inert.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!leaving || !el) return;
    if (el.contains(document.activeElement)) cardElement(card)?.focus({ preventScroll: true });
    el.setAttribute("inert", "");
  }, [leaving, card]);

  // Gone at once (reduced motion): the same rescue, on the way out.
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (el?.contains(document.activeElement)) cardElement(cardRef.current)?.focus({ preventScroll: true });
    };
  }, []);

  // Tabbing into a note by hand moves F8's place there; the end of its fade takes it off the sheet.
  const problemIds = note.problemIds;
  const noteId = note.id;
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const focused = () => {
      const cursor = problemCursor();
      const [first] = problemIds;
      if (first !== undefined && (cursor === null || !problemIds.includes(cursor.id))) setProblemCursor(first);
    };
    const faded = (event: AnimationEvent) => {
      if (event.target === el && leavingRef.current) onLeft(noteId);
    };
    el.addEventListener("focusin", focused);
    el.addEventListener("animationend", faded);
    return () => {
      el.removeEventListener("focusin", focused);
      el.removeEventListener("animationend", faded);
    };
  }, [noteId, problemIds, onLeft]);

  const style: CSSProperties = { left: rect.x, top: rect.y, width: rect.width };
  const frameStyle: CSSProperties = { left: frame.x, top: frame.y, width: frame.width, height: frame.height };
  const describedBy = note.selectors.length > 0 ? `${listId} ${textId}` : textId;
  const menuLabel = note.kind === "collision" ? "Selector collision actions" : `${note.caption} actions`;

  return (
    <>
      <div ref={frameRef} className={styles.frame} style={frameStyle} aria-hidden="true" />
      <ContextMenu label={menuLabel} items={<NoteMenuItems note={note} fixes={fixes} card={card} />} disabled={leaving}>
        <div
          ref={ref}
          role="note"
          tabIndex={leaving ? -1 : 0}
          aria-labelledby={captionId}
          aria-describedby={describedBy}
          className={cx(styles.note, styles[note.kind], leaving && styles.leaving, "nopan nodrag nowheel")}
          style={style}
          data-note-id={note.id}
          data-note-kind={note.kind}
          data-problems={note.problemIds.join(" ")}
          data-leaving={leaving ? "" : undefined}
          {...(note.kind === "collision" ? { "data-tour": "collision" } : {})}
        >
          <p id={captionId} className={styles.caption}>
            {note.caption}
          </p>
          {note.selectors.length > 0 ? (
            <ul id={listId} className={styles.selectors}>
              {note.selectors.map((s) => (
                <li key={s.hex}>
                  <code className={styles.signature}>{s.signature}</code> <span className={styles.hex}>{s.hex}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p id={textId} className={styles.text}>
            <CodeText text={note.text} codeClassName={styles.code ?? ""} />
          </p>
          <div className={styles.actions}>
            <Actions note={note} fixes={fixes} ownerOpen={ownerOpen} onOwnerOpen={setOwnerOpen} />
          </div>
        </div>
      </ContextMenu>
    </>
  );
});
