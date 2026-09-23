/**
 * The palette's state, in the entry chunk: whether it's open and in which mode, where "Add facet here…"
 * places, the Recent list, and the loader for the palette's own chunk (spec L822: loaded when the app is
 * idle, or on the first ⌘K). Nothing here imports the palette's UI.
 */
import type { CommandRef } from "@lattice-studio/core";
import { useSyncExternalStore } from "react";
import { onCommandRun, type SheetPoint } from "@/contracts";

/** `all`: every group (⌘K). `facets`: the Place facet group only, placing at `at` (Add facet here…, spec L423). */
export type PaletteMode = "all" | "facets";

export type PaletteState = {
  open: boolean;
  mode: PaletteMode;
  /** Where Add facet here… places, in sheet units: the pointer when the menu opened. */
  at: SheetPoint | null;
  /** Unique per opening, so each opening starts fresh (query, highlight). */
  key: number;
};

export type OpenOptions = { mode?: PaletteMode; at?: SheetPoint | null };

const CLOSED: PaletteState = { open: false, mode: "all", at: null, key: 0 };

let state: PaletteState = CLOSED;
const listeners = new Set<() => void>();

function set(next: PaletteState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function paletteState(): PaletteState {
  return state;
}

/** Opens the palette (again, when it's open: a new mode or place starts over). Starts loading its chunk. */
export function openPalette(options: OpenOptions = {}): void {
  // The host reports a failed load.
  loadPalette().catch(() => undefined);
  set({ open: true, mode: options.mode ?? "all", at: options.at ?? null, key: state.key + 1 });
}

export function closePalette(): void {
  if (state.open) set({ ...state, open: false });
}

export function usePaletteState(): PaletteState {
  return useSyncExternalStore(subscribe, paletteState);
}

// ---------------------------------------------------------------------------------------------------------
// Recent (IR L164: the last 5)

export const RECENT_LIMIT = 5;

let recent: readonly CommandRef[] = [];
const recentListeners = new Set<() => void>();

function sameRef(a: CommandRef, b: CommandRef): boolean {
  return a.id === b.id && JSON.stringify(a.args ?? {}) === JSON.stringify(b.args ?? {});
}

/** A place from Add facet here… belongs to that opening: Recent places the facet the usual way. */
function withoutPlace(ref: CommandRef): CommandRef {
  if (ref.id !== "facet.place" || !ref.args || !("at" in ref.args)) return ref;
  const { at: _at, ...args } = ref.args;
  return { id: ref.id, args };
}

/** Records a command run from the palette: most recent first, each once, at most five. */
export function recordRecent(ran: CommandRef): void {
  if (ran.id === "palette.open") return;
  const ref = withoutPlace(ran);
  recent = [ref, ...recent.filter((r) => !sameRef(r, ref))].slice(0, RECENT_LIMIT);
  for (const listener of recentListeners) listener();
}

export function recentCommands(): readonly CommandRef[] {
  return recent;
}

export function useRecentCommands(): readonly CommandRef[] {
  return useSyncExternalStore((listener) => {
    recentListeners.add(listener);
    return () => {
      recentListeners.delete(listener);
    };
  }, recentCommands);
}

/** @internal Tests start with no Recent and a closed palette. */
export function resetPaletteState(): void {
  recent = [];
  for (const listener of recentListeners) listener();
  set(CLOSED);
}

let stopRecording: (() => void) | null = null;

/** Starts recording what the palette runs into Recent; idempotent. Called once from `services.ts`. */
export function recordPaletteRuns(): () => void {
  stopRecording ??= onCommandRun((ref, source) => {
    if (source === "palette") recordRecent(ref);
  });
  return () => {
    stopRecording?.();
    stopRecording = null;
  };
}

// ---------------------------------------------------------------------------------------------------------
// The chunk

export type PaletteModule = typeof import("./PalettePopup");

let chunk: Promise<PaletteModule> | null = null;
let loaded: PaletteModule | null = null;

/** Loads the palette's chunk once; later calls share the first load. A failed load can be retried. */
export function loadPalette(): Promise<PaletteModule> {
  chunk ??= import("./PalettePopup").then(
    (module) => {
      loaded = module;
      return module;
    },
    (error: unknown) => {
      chunk = null;
      throw error;
    },
  );
  return chunk;
}

/** The palette's chunk once it has loaded, else null. */
export function loadedPalette(): PaletteModule | null {
  return loaded;
}

/** Runs `task` when the browser is idle (a timeout where `requestIdleCallback` doesn't exist). */
export function whenIdle(task: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(task, { timeout: 5000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, 1);
  return () => window.clearTimeout(handle);
}
