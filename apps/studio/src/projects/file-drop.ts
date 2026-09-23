/**
 * Dropping a file on the window (Flow 10 step 4, spec L501). Exported (not only installed) so a test can
 * call it on a plain `EventTarget` and dispatch a synthetic `drop`, without a real native file drag.
 */
export type DropTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer !== null && Array.from(event.dataTransfer.types).includes("Files");
}

/** Installs the listeners; returns a disposer. A no-op outside the browser. */
export function installFileDrop(target: DropTarget): () => void {
  const onDragOver = (event: Event) => {
    if (event instanceof DragEvent && hasFiles(event)) event.preventDefault();
  };
  const onDrop = (event: Event) => {
    if (!(event instanceof DragEvent) || !hasFiles(event)) return;
    event.preventDefault();
    const transfer = event.dataTransfer;
    if (!transfer) return;
    void (async () => {
      const [{ pickDroppedFile }, { openImportedFile }] = await Promise.all([import("./file-io"), import("./actions")]);
      const picked = await pickDroppedFile(transfer);
      if (picked) await openImportedFile(picked.filename, picked.text);
    })();
  };
  target.addEventListener("dragover", onDragOver);
  target.addEventListener("drop", onDrop);
  return () => {
    target.removeEventListener("dragover", onDragOver);
    target.removeEventListener("drop", onDrop);
  };
}
