/**
 * Whether a document still is the one the boot started on (the untitled project `start()` leaves). Shared by
 * the boot (`current.ts`: a returning visitor lands in their last project only while it is) and by autosave
 * (`persistence.ts`: the boot's document isn't stored until the visitor edits it). Imports no IndexedDB code,
 * so `current.ts` stays in the entry chunk without it.
 */
import type { Project, Recipe } from "@lattice-studio/core";
import { isUnpinned } from "@/state/document-store";

/**
 * Whether the recipe differs from the boot's only by the catalog pin: the boot's recipe named no catalog, and
 * `state/pinning.ts` pinned it to the one that loaded, leaving every other key as it was.
 */
function onlyPinned(booted: Recipe, now: Recipe): boolean {
  if (now === booted) return true;
  if (!isUnpinned(booted) || isUnpinned(now)) return false;
  const keys = new Set([...Object.keys(booted), ...Object.keys(now)] as (keyof Recipe)[]);
  for (const key of keys) if (key !== "catalog" && booted[key] !== now[key]) return false;
  return true;
}

/**
 * Whether `now` has no edits of its own since `booted`. Neither a recorded prediction nor the catalog pin
 * counts, since neither is the visitor's doing: a wallet that reconnects on load records a prediction
 * (`state/prediction.ts`), and a catalog that loads before storage answers pins the untitled project
 * (`state/pinning.ts`).
 */
export function untouched(booted: Project, now: Project): boolean {
  if (now === booted) return true;
  const keys = new Set([...Object.keys(booted), ...Object.keys(now)] as (keyof Project)[]);
  for (const key of keys) {
    if (key === "predicted" || booted[key] === now[key]) continue;
    if (key === "recipe" && onlyPinned(booted.recipe, now.recipe)) continue;
    return false;
  }
  return true;
}
