/**
 * Syntax highlighting's lazy boundary (spec L699, L822): Shiki loads when a code tab first opens, and warms when
 * the pointer rests on one. Until it arrives the code shows as plain text. A failed load is retried on the next
 * open; the code stays readable meanwhile.
 */
export type CodeLang = "solidity" | "json";

/** One token: its text and its colors per theme, as CSS custom properties. */
export type HighlightToken = { content: string; style: Record<string, string> };

export type Highlighter = { tokenize(code: string, lang: CodeLang): HighlightToken[][] };

let loading: Promise<Highlighter> | null = null;
let ready: Highlighter | null = null;
const listeners = new Set<() => void>();

type ShikiModule = typeof import("./shiki");
let importShiki: () => Promise<ShikiModule> = () => import("./shiki");

/** @internal Tests: holds or replaces the chunk's import (to see the plain text first). Returns a disposer. */
export function overrideShikiImport(next: () => Promise<ShikiModule>): () => void {
  const previous = importShiki;
  importShiki = next;
  return () => {
    importShiki = previous;
  };
}

export function loadHighlighter(): Promise<Highlighter> {
  loading ??= importShiki()
    .then((module) => module.createHighlighter())
    .then(
      (highlighter) => {
        ready = highlighter;
        for (const listener of Array.from(listeners)) listener();
        return highlighter;
      },
      (error: unknown) => {
        loading = null;
        throw error;
      },
    );
  return loading;
}

/** Starts loading without waiting (hover on a code tab). */
export function warmHighlighter(): void {
  loadHighlighter().catch(() => {
    // Plain text stays; the next open tries again.
  });
}

/** The highlighter once it has loaded, else null. */
export function highlighter(): Highlighter | null {
  return ready;
}

/** Whether Shiki has loaded (tests: nothing loads it before a code tab opens). */
export function highlighterLoaded(): boolean {
  return ready !== null;
}

/** Whether anything has asked for Shiki yet. */
export function highlighterRequested(): boolean {
  return loading !== null || ready !== null;
}

export function subscribeHighlighter(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
