/**
 * Listener sets and store relays for the contracts. Every set of subscribers the contracts keep is made
 * here, so the contracts' own tests can isolate them (`isolateListeners`): a consumer's module-level
 * subscription never sees a contract test's events, and comes back afterwards. Leaf module: no imports.
 */

export type ListenerSet<F extends (...args: never[]) => void> = {
  add(listener: F): () => void;
  emit(...args: Parameters<F>): void;
  readonly size: number;
};

type Tracked = {
  snapshot(): unknown[];
  replace(listeners: unknown[]): void;
  /** Called after the members change behind the set's back (isolation), to attach or detach upstream. */
  resync?(): void;
};

const tracked = new Set<Tracked>();

/** A tracked set of listeners. `onSizeChange` runs whenever the count may have changed. */
export function listenerSet<F extends (...args: never[]) => void>(onSizeChange?: () => void): ListenerSet<F> {
  let members = new Set<F>();
  const entry: Tracked = {
    snapshot: () => Array.from(members),
    replace: (next) => {
      members = new Set(next as F[]);
    },
    ...(onSizeChange ? { resync: onSizeChange } : {}),
  };
  tracked.add(entry);
  return {
    add(listener) {
      members.add(listener);
      onSizeChange?.();
      return () => {
        if (!members.delete(listener)) return;
        onSizeChange?.();
      };
    },
    emit(...args) {
      for (const listener of Array.from(members)) listener(...args);
    },
    get size() {
      return members.size;
    },
  };
}

/**
 * @internal Contract tests: empties every tracked listener set and returns a disposer that puts each back.
 * Production code never calls it.
 */
export function isolateListeners(): () => void {
  const saved = Array.from(tracked, (entry) => [entry, entry.snapshot()] as const);
  for (const [entry] of saved) {
    entry.replace([]);
    entry.resync?.();
  }
  return () => {
    for (const [entry, listeners] of saved) {
      entry.replace(listeners);
      entry.resync?.();
    }
  };
}

/** The part of zustand's `StoreApi` the relays use. */
export type StoreLike<S> = {
  getState(): S;
  getInitialState(): S;
  setState(partial: S | Partial<S> | ((state: S) => S | Partial<S>), replace?: false): void;
  subscribe(listener: (state: S, previous: S) => void): () => void;
};

export type Relay<S> = { api: StoreLike<S>; point(next: StoreLike<S>): void };

/**
 * A stable store that forwards to whichever store is current. Subscribers attach to the relay, not the
 * target, so they follow `point(next)`: they're called once with the new state and keep receiving changes.
 */
export function relay<S>(initial: StoreLike<S>): Relay<S> {
  let target = initial;
  const listeners = listenerSet<(state: S, previous: S) => void>();
  const fanout = (state: S, previous: S) => listeners.emit(state, previous);
  let detach = target.subscribe(fanout);
  return {
    api: {
      getState: () => target.getState(),
      getInitialState: () => target.getInitialState(),
      setState: (partial, replace) => target.setState(partial, replace),
      subscribe: (listener) => listeners.add(listener),
    },
    point(next) {
      if (next === target) return;
      const previous = target.getState();
      detach();
      target = next;
      detach = target.subscribe(fanout);
      const state = target.getState();
      if (state !== previous) fanout(state, previous);
    },
  };
}
