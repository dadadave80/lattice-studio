import type { ExportFile } from "@lattice-studio/core";

/** Saves a generated file through the browser's download (an object URL on a temporary link). */
export function saveFile(file: ExportFile): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked after the click has been handled, so the download has its URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
