/**
 * zundo 2.3.0 (MIT, Copyright (c) 2021 Charles Kornoelje; see LICENSE beside this file), vendored by S1
 * (spec L22 decision 10, contracts §2: "zundo is vendored by S1, not installed").
 *
 * A port of `dist/index.js` from the npm tarball (shasum 423ccef59c92c7084c809a967a28f34d41d28a5f) to strict
 * TypeScript. The behavior is unchanged; the only differences are types (no `any`), `createStore` imported from
 * `zustand/vanilla`, and `undefined` checks written out where the original relied on `||`.
 */
import {
  createStore, type StateCreator, type StoreApi, type StoreMutatorIdentifier,
} from "zustand/vanilla";

export type OnSave<TState> = ((pastState: TState, currentState: TState) => void) | undefined;

export interface _TemporalState<TState> {
  pastStates: Partial<TState>[];
  futureStates: Partial<TState>[];
  undo: (steps?: number) => void;
  redo: (steps?: number) => void;
  clear: () => void;
  isTracking: boolean;
  pause: () => void;
  resume: () => void;
  setOnSave: (onSave: OnSave<TState>) => void;
  _onSave: OnSave<TState>;
  _handleSet: (
    pastState: TState,
    replace: boolean | undefined,
    currentState: TState,
    deltaState?: Partial<TState> | null,
  ) => void;
}

export interface ZundoOptions<TState, PartialTState = TState> {
  partialize?: (state: TState) => PartialTState;
  limit?: number;
  equality?: (pastState: PartialTState, currentState: PartialTState) => boolean;
  diff?: (pastState: Partial<PartialTState>, currentState: Partial<PartialTState>) => Partial<PartialTState> | null;
  onSave?: OnSave<TState>;
  handleSet?: (
    handleSet: _TemporalState<PartialTState>["_handleSet"],
  ) => (
    pastState: PartialTState,
    replace: boolean | undefined,
    currentState: PartialTState,
    deltaState?: Partial<PartialTState> | null,
  ) => void;
  pastStates?: Partial<PartialTState>[];
  futureStates?: Partial<PartialTState>[];
  wrapTemporal?: (
    storeInitializer: StateCreator<_TemporalState<PartialTState>, [], []>,
  ) => StateCreator<_TemporalState<PartialTState>, [], []>;
}

export type TemporalState<TState> = Omit<_TemporalState<TState>, "_onSave" | "_handleSet">;

type Write<T, U> = Omit<T, keyof U> & U;

declare module "zustand/vanilla" {
  interface StoreMutators<S, A> {
    temporal: Write<S, { temporal: A }>;
  }
}

export type Zundo = <
  TState,
  Mps extends [StoreMutatorIdentifier, unknown][] = [],
  Mcs extends [StoreMutatorIdentifier, unknown][] = [],
  UState = TState,
>(
  config: StateCreator<TState, [...Mps, ["temporal", unknown]], Mcs>,
  options?: ZundoOptions<TState, UState>,
) => StateCreator<TState, Mps, [["temporal", StoreApi<TemporalState<UState>>], ...Mcs]>;

/** The temporal store's state creator: `userSet` and `userGet` act on the user's store. */
function temporalStateCreator<TState, PState>(
  userSet: (state: Partial<PState>) => void,
  userGet: () => TState,
  options: ZundoOptions<TState, PState> | undefined,
): StateCreator<_TemporalState<PState>, [], []> {
  const partial = (): PState => options?.partialize?.(userGet()) ?? (userGet() as unknown as PState);
  return (set, get) => ({
    pastStates: options?.pastStates ?? [],
    futureStates: options?.futureStates ?? [],
    undo: (steps = 1) => {
      if (get().pastStates.length) {
        const currentState = partial();
        const statesToApply = get().pastStates.splice(-steps, steps);
        const nextState = statesToApply.shift();
        if (nextState === undefined) return;
        userSet(nextState);
        set({
          pastStates: get().pastStates,
          futureStates: get().futureStates.concat(
            options?.diff?.(currentState, nextState) ?? currentState,
            statesToApply.reverse(),
          ),
        });
      }
    },
    redo: (steps = 1) => {
      if (get().futureStates.length) {
        const currentState = partial();
        const statesToApply = get().futureStates.splice(-steps, steps);
        const nextState = statesToApply.shift();
        if (nextState === undefined) return;
        userSet(nextState);
        set({
          pastStates: get().pastStates.concat(
            options?.diff?.(currentState, nextState) ?? currentState,
            statesToApply.reverse(),
          ),
          futureStates: get().futureStates,
        });
      }
    },
    clear: () => set({ pastStates: [], futureStates: [] }),
    isTracking: true,
    pause: () => set({ isTracking: false }),
    resume: () => set({ isTracking: true }),
    setOnSave: (_onSave) => set({ _onSave }),
    // Internal properties
    _onSave: options?.onSave as OnSave<PState>,
    _handleSet: (pastState, _replace, currentState, deltaState) => {
      if (options?.limit && get().pastStates.length >= options.limit) {
        get().pastStates.shift();
      }
      get()._onSave?.(pastState, currentState);
      set({
        pastStates: get().pastStates.concat(deltaState ?? pastState),
        futureStates: [],
      });
    },
  });
}

type AnySet<T> = (partial: T | Partial<T> | ((state: T) => T | Partial<T>), replace?: boolean) => void;

function temporalImpl<TState, PState>(
  config: StateCreator<TState, [], []>,
  options?: ZundoOptions<TState, PState>,
): StateCreator<TState, [], []> {
  return (set, get, store) => {
    const rawSet = set as AnySet<TState>;
    const creator = temporalStateCreator<TState, PState>(
      (state) => rawSet(state as unknown as Partial<TState>),
      get,
      options,
    );
    const temporalStore = createStore<_TemporalState<PState>>()(options?.wrapTemporal?.(creator) ?? creator);
    (store as StoreApi<TState> & { temporal: StoreApi<_TemporalState<PState>> }).temporal = temporalStore;

    const handleSet = temporalStore.getState()._handleSet;
    const curriedHandleSet = options?.handleSet?.(handleSet) ?? handleSet;
    const partial = (): PState => options?.partialize?.(get()) ?? (get() as unknown as PState);

    const temporalHandleSet = (pastState: PState): void => {
      if (!temporalStore.getState().isTracking) return;
      const currentState = partial();
      const deltaState = options?.diff?.(pastState, currentState);
      if (
        // Don't call handleSet if state hasn't changed, as determined by diff fn or equality fn
        !(
          // If the user has provided a diff function but nothing has been changed, deltaState will be null
          (deltaState === null || options?.equality?.(pastState, currentState))
        )
      ) {
        curriedHandleSet(pastState, undefined, currentState, deltaState);
      }
    };

    const setState = store.setState as AnySet<TState>;
    (store as { setState: AnySet<TState> }).setState = (partialState, replace) => {
      const pastState = partial();
      setState(partialState, replace);
      temporalHandleSet(pastState);
    };

    const wrappedSet: AnySet<TState> = (partialState, replace) => {
      const pastState = partial();
      rawSet(partialState, replace);
      temporalHandleSet(pastState);
    };
    return config(wrappedSet as typeof set, get, store);
  };
}

export const temporal = temporalImpl as unknown as Zundo;
