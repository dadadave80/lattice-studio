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
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    void (async () => {
      const [{ pickDroppedFile }, { openImportedFile }] = await Promise.all([import("./file-io"), import("./actions")]);
      const picked = await pickDroppedFile(file);
      await openImportedFile(picked.filename, picked.text);
    })().catch(async (error: unknown) => {
      const { reportOpenFailure } = await import("./cmd/shared");
      reportOpenFailure(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    });
  };
  target.addEventListener("dragover", onDragOver);
  target.addEventListener("drop", onDrop);
  return () => {
    target.removeEventListener("dragover", onDragOver);
    target.removeEventListener("drop", onDrop);
  };
}
