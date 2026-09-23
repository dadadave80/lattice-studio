/**
 * The edit lock, one per project (spec L505, Web Locks). The first tab on a project holds it and saves; a
 * second tab opens read-only. **Take over editing** asks the holder over the channel to flush its pending save
 * and let go; a holder that doesn't answer within `stealAfter` ms (a frozen tab) has the lock stolen.
 */
import type { Channel } from "./channel";

export type EditLockState =
  /** No project claimed yet. */
  | { state: "none" }
  /** This tab edits `projectId` and saves it. */
  | { state: "held"; projectId: string }
  /** Another tab is editing `projectId`: this one is read-only (Take over editing). */
  | { state: "elsewhere"; projectId: string }
  /** This tab handed `projectId` over to another tab (Editing moved to another tab · Take back editing). */
  | { state: "handed-over"; projectId: string };

export type EditLockOptions = {
  /** Lock names are `${prefix}:edit:${projectId}`. */
  prefix: string;
  /** `navigator.locks`; null where the browser has none (every tab edits). */
  locks: LockManager | null;
  channel: Channel;
  peerId: string;
  /** Runs before this tab lets go for another: flush the pending save. */
  beforeHandover(projectId: string): Promise<void>;
  onChange(state: EditLockState): void;
  /** Ms to wait for the holder's answer before stealing. */
  stealAfter?: number;
};

export type EditLock = {
  state(): EditLockState;
  /** Holds `projectId` if nobody else does; resolves true when held, false when another tab edits it. */
  claim(projectId: string): Promise<boolean>;
  /** Asks the holder to hand over, then holds. Resolves true once held. */
  takeOver(projectId: string): Promise<boolean>;
  /** Lets go quietly (another project opened, data cleared). */
  release(): void;
  dispose(): void;
};

const STEAL_AFTER_MS = 2000;

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function createEditLock(options: EditLockOptions): EditLock {
  const { locks, channel, peerId } = options;
  const stealAfter = options.stealAfter ?? STEAL_AFTER_MS;
  let current: EditLockState = { state: "none" };
  /** The lock this tab holds, and how to let go of it. */
  let holding: { projectId: string; letGo: () => void } | null = null;
  /** Bumped on every claim, take over or release, so a late grant for an old request lets go at once. */
  let epoch = 0;

  const set = (next: EditLockState) => {
    current = next;
    options.onChange(next);
  };
  const lockName = (projectId: string) => `${options.prefix}:edit:${projectId}`;

  /** Requests the lock; `granted` runs while it's held. Resolves whether it was granted. */
  const hold = (projectId: string, request: LockOptions, mine: number): Promise<boolean> => {
    if (!locks) {
      if (mine !== epoch) return Promise.resolve(false);
      holding = { projectId, letGo: () => {} };
      set({ state: "held", projectId });
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve, reject) => {
      locks
        .request(lockName(projectId), request, (lock) => {
          if (!lock) {
            resolve(false);
            return undefined;
          }
          if (mine !== epoch) {
            resolve(false);
            return undefined;
          }
          return new Promise<void>((letGo) => {
            holding = { projectId, letGo: () => letGo() };
            set({ state: "held", projectId });
            resolve(true);
          });
        })
        .catch((error: unknown) => {
          // Stolen by a tab that couldn't reach this one: the lock is gone without a flush.
          if (isAbort(error) && holding?.projectId === projectId) {
            holding = null;
            set({ state: "handed-over", projectId });
            return;
          }
          reject(error);
        });
    });
  };

  const letGo = () => {
    const held = holding;
    holding = null;
    held?.letGo();
  };

  const stopListening = channel.subscribe((message) => {
    if (message.kind !== "lock-request" || message.from === peerId) return;
    const held = holding;
    if (!held || held.projectId !== message.id) return;
    const projectId = held.projectId;
    void options
      .beforeHandover(projectId)
      .catch(() => {})
      .then(() => {
        if (holding?.projectId !== projectId) return;
        letGo();
        epoch += 1;
        set({ state: "handed-over", projectId });
        channel.post({ kind: "lock-released", from: peerId, id: projectId, to: message.from });
      });
  });

  return {
    state: () => current,
    async claim(projectId) {
      if (holding?.projectId === projectId) return true;
      letGo();
      epoch += 1;
      const mine = epoch;
      const held = await hold(projectId, { ifAvailable: true }, mine);
      if (!held && mine === epoch) set({ state: "elsewhere", projectId });
      return held;
    },
    async takeOver(projectId) {
      if (holding?.projectId === projectId) return true;
      letGo();
      epoch += 1;
      const mine = epoch;
      channel.post({ kind: "lock-request", from: peerId, id: projectId });
      if (!locks) return hold(projectId, {}, mine);
      const patience = new AbortController();
      const timer = setTimeout(() => patience.abort(), stealAfter);
      try {
        return await hold(projectId, { signal: patience.signal }, mine);
      } catch (error) {
        if (!isAbort(error) || mine !== epoch) return false;
        return hold(projectId, { steal: true }, mine);
      } finally {
        clearTimeout(timer);
      }
    },
    release() {
      letGo();
      epoch += 1;
      set({ state: "none" });
    },
    dispose() {
      stopListening();
      letGo();
      epoch += 1;
    },
  };
}
