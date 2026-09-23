import { Component, lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";

type BoundaryProps = { fallback: ReactNode; children: ReactNode };

/**
 * Shows `fallback` instead of a part whose chunk failed to load. The failure itself is reported by the PWA's
 * chunk-error watcher (spec L831), which offers a reload; here it only keeps the rest of the app on screen.
 */
class ChunkBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * A part of the app that first paint doesn't show (spec L822 "Code-splitting"): it loads in its own chunk and
 * renders `fallback` (nothing by default) until it arrives or if its chunk can't load.
 */
export function LazyPart({ fallback = null, children }: { fallback?: ReactNode; children: ReactNode }) {
  return (
    <ChunkBoundary fallback={fallback}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </ChunkBoundary>
  );
}

/** `lazy()` for a named export: `lazyNamed(() => import("./X"), "X")`. */
export function lazyNamed<P extends object, K extends string>(
  load: () => Promise<Record<K, ComponentType<P>>>,
  name: K,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}
