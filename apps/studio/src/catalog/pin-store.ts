/** Publishes the catalog pin (`pin.ts`) reactively, for S13's read-only and migrate flow. */
import { useSyncExternalStore } from "react";
import type { CatalogPin } from "./pin";

let current: CatalogPin = { status: "unknown" };
const listeners = new Set<() => void>();

/** @internal `services.ts` recomputes and publishes the pin on every document and catalog change. */
export function setCatalogPin(pin: CatalogPin): void {
  if (pin === current) return;
  current = pin;
  for (const listener of listeners) listener();
}

export function getCatalogPin(): CatalogPin {
  return current;
}

export function subscribeCatalogPin(listener: (pin: CatalogPin) => void): () => void {
  const wrapped = () => listener(current);
  listeners.add(wrapped);
  return () => listeners.delete(wrapped);
}

export function useCatalogPin(): CatalogPin {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => current,
  );
}

/** @internal Tests: back to `unknown`, no listeners notified. */
export function resetCatalogPin(): void {
  current = { status: "unknown" };
}
