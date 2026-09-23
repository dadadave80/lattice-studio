/**
 * The edit lock, one per project (spec L505, Web Locks). The first tab on a project holds it and saves; a
 * second tab opens read-only. **Take over editing** asks the holder over the channel; the holder answers at
 * once (`lock-ack`), saves until nothing is pending, then lets go. Only a holder that doesn't answer within
 * `stealAfter` ms (a frozen tab) has the lock stolen; a slow save is waited for.
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
  /** Runs before this tab lets go for another: save until nothing is pending. */
  beforeHandover(projectId: string): Promise<void>;
  onChange(state: EditLockState): void;
  /** The browser refused a lock request for a reason other than a steal: this tab edits without one. */
  onError(error: unknown): void;
  /** Ms to wait for the holder's answer before stealing. */
  stealAfter?: number;
};

export type EditLock = {
  state(): EditLockState;
  /** Holds `projectId` if nobody else does; resolves true when held, false when another tab edits it. */
  claim(projectId: string): Promise<boolean>;
  /** Asks the holder to hand over, then holds. Resolves true once held. */
  takeOver(projectId: string): Promise<boolean>;
  /** Lets go quietly (another project opened, the database closed). */
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
  /** Take overs waiting for the holder's answer, by project id. */
  const awaitingAck = new Map<string, () => void>();

  const set = (next: EditLockState) => {
    current = next;
    options.onChange(next);
  };
  const lockName = (projectId: string) => `${options.prefix}:edit:${projectId}`;

  /** Holds without a Web Lock: no Web Locks, or the browser refused the request. */
  const holdUnlocked = (projectId: string, mine: number): boolean => {
    if (mine !== epoch) return false;
    holding = { projectId, letGo: () => {} };
    set({ state: "held", projectId });
    return true;
  };

  /** Requests the lock; resolves whether it was granted. Rejects with AbortError when `signal` aborts first. */
  const hold = (projectId: string, request: LockOptions, mine: number): Promise<boolean> => {
    if (!locks) return Promise.resolve(holdUnlocked(projectId, mine));
    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      locks
        .request(lockName(projectId), request, (lock) => {
          settled = true;
          if (!lock || mine !== epoch) {
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
          if (isAbort(error)) {
            // Stolen by a tab that couldn't reach this one: the lock is gone without a save.
            if (settled && holding?.projectId === projectId) {
              holding = null;
              set({ state: "handed-over", projectId });
              return;
            }
            reject(error);
            return;
          }
          // The browser refused the request itself: edit without coordination rather than never save.
          options.onError(error);
          if (!settled) resolve(holdUnlocked(projectId, mine));
        });
    });
  };

  const letGo = () => {
    const held = holding;
    holding = null;
    held?.letGo();
  };

  const stopListening = channel.subscribe((message) => {
    if (message.from === peerId) return;
    if (message.kind === "lock-ack" && message.to === peerId) {
      awaitingAck.get(message.id)?.();
      return;
    }
    if (message.kind !== "lock-request") return;
    const held = holding;
    if (!held || held.projectId !== message.id) return;
    const projectId = held.projectId;
    channel.post({ kind: "lock-ack", from: peerId, id: projectId, to: message.from });
    void options
      .beforeHandover(projectId)
      .catch(() => {})
      .then(() => {
        if (holding?.projectId !== projectId) return;
        letGo();
        epoch += 1;
        set({ state: "handed-over", projectId });
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
      if (!locks) return holdUnlocked(projectId, mine);
      const patience = new AbortController();
      let answered = false;
      const timer = setTimeout(() => {
        if (!answered) patience.abort();
      }, stealAfter);
      awaitingAck.set(projectId, () => {
        answered = true;
      });
      channel.post({ kind: "lock-request", from: peerId, id: projectId });
      try {
        return await hold(projectId, { signal: patience.signal }, mine);
      } catch (error) {
        if (!isAbort(error) || mine !== epoch) return false;
        return hold(projectId, { steal: true }, mine);
      } finally {
        clearTimeout(timer);
        awaitingAck.delete(projectId);
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
