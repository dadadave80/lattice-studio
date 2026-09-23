/**
 * Saves an export as a file (spec L509-L517: Download on every export). Through a Blob and a temporary link, so
 * nothing leaves the browser. A seam, so tests can see what would have been saved.
 */
import type { ExportFile } from "@lattice-studio/core";

export type Downloader = (file: ExportFile) => void;

function browserDownload(file: ExportFile): void {
  const blob = new Blob([file.text], { type: `${file.mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.rel = "noopener";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a turn to start the download before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

let downloader: Downloader = browserDownload;

export function downloadFile(file: ExportFile): void {
  downloader(file);
}

/** @internal Tests: replaces the downloader; returns a disposer that puts the previous one back. */
export function setDownloader(next: Downloader): () => void {
  const previous = downloader;
  downloader = next;
  return () => {
    downloader = previous;
  };
}
