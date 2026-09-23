/**
 * The edit lock, one per project (spec L505, Web Locks). The first tab on a project holds it and saves; a
 * second tab opens read-only. **Take over editing** asks the holder over the channel; the holder answers at
 * once (`lock-ack`), saves until nothing is pending, then lets go. When its saves keep failing it keeps the
 * lock and says so (`lock-refused`), because the taker would load an older save. Only a holder that doesn't
 * answer within `stealAfter` ms (a frozen tab) has the lock stolen; one that answered is waited for up to
 * `ackedPatience` ms, then the taker gives up and says so.
 */
import type { Result } from "@lattice-studio/core";
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
  /**
   * Runs before this tab lets go for another: save until nothing is pending. Rejecting (the saves keep
   * failing) keeps the lock here; the rejection's message goes to the taker.
   */
  beforeHandover(projectId: string): Promise<void>;
  onChange(state: EditLockState): void;
  /** The browser refused a lock request for a reason other than a steal: this tab edits without one. */
  onError(error: unknown): void;
  /** Ms to wait for the holder's answer before stealing. */
  stealAfter?: number;
  /** Ms to wait, once the holder answered, for it to finish saving and let go. */
  ackedPatience?: number;
};

export type EditLock = {
  state(): EditLockState;
  /** Holds `projectId` if nobody else does; resolves true when held, false when another tab edits it. */
  claim(projectId: string): Promise<boolean>;
  /** Asks the holder to hand over, then holds. Fails with what to tell the user when the holder kept it. */
  takeOver(projectId: string): Promise<Result<void, string>>;
  /** Lets go quietly (another project opened, the database closed). */
  release(): void;
  dispose(): void;
};

const STEAL_AFTER_MS = 2000;
const ACKED_PATIENCE_MS = 15_000;

/** What Take over editing says when the other tab answered but never let go. */
export const STILL_SAVING = "The other tab is still saving this project, so it kept editing. Try Take over editing again in a moment.";

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

type Waiting = { acked(): void; refused(reason: string): void };

export function createEditLock(options: EditLockOptions): EditLock {
  const { locks, channel, peerId } = options;
  const stealAfter = options.stealAfter ?? STEAL_AFTER_MS;
  const ackedPatience = options.ackedPatience ?? ACKED_PATIENCE_MS;
  let current: EditLockState = { state: "none" };
  /** The lock this tab holds, and how to let go of it. */
  let holding: { projectId: string; letGo: () => void } | null = null;
  /** Bumped on every claim, take over or release, so a late grant for an old request lets go at once. */
  let epoch = 0;
  /** Take overs waiting for the holder's answer, by project id. */
  const waiting = new Map<string, Waiting>();

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
      waiting.get(message.id)?.acked();
      return;
    }
    if (message.kind === "lock-refused" && message.to === peerId) {
      waiting.get(message.id)?.refused(message.reason);
      return;
    }
    if (message.kind !== "lock-request") return;
    const held = holding;
    if (!held || held.projectId !== message.id) return;
    const projectId = held.projectId;
    channel.post({ kind: "lock-ack", from: peerId, id: projectId, to: message.from });
    options.beforeHandover(projectId).then(
      () => {
        if (holding?.projectId !== projectId) return;
        letGo();
        epoch += 1;
        set({ state: "handed-over", projectId });
      },
      (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        channel.post({ kind: "lock-refused", from: peerId, id: projectId, to: message.from, reason });
      },
    );
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
      if (holding?.projectId === projectId) return { ok: true, value: undefined };
      const previous = current;
      letGo();
      epoch += 1;
      const mine = epoch;
      if (!locks) {
        holdUnlocked(projectId, mine);
        return { ok: true, value: undefined };
      }
      const patience = new AbortController();
      /** Why the wait ended without the lock: null until the holder refuses or runs out of time. */
      let gaveUp: string | null = null;
      let answered = false;
      let timer = setTimeout(() => {
        if (!answered) patience.abort();
      }, stealAfter);
      waiting.set(projectId, {
        acked() {
          if (answered) return;
          answered = true;
          clearTimeout(timer);
          timer = setTimeout(() => {
            gaveUp = STILL_SAVING;
            patience.abort();
          }, ackedPatience);
        },
        refused(reason) {
          answered = true;
          gaveUp = `The other tab kept editing: its changes aren't saved yet. ${reason}`;
          patience.abort();
        },
      });
      channel.post({ kind: "lock-request", from: peerId, id: projectId });
      const keepState = () => {
        if (mine === epoch && current.state !== "held") set(previous.state === "none" ? { state: "elsewhere", projectId } : previous);
      };
      try {
        const held = await hold(projectId, { signal: patience.signal }, mine);
        if (held) return { ok: true, value: undefined };
        keepState();
        return { ok: false, error: "Couldn't take over editing. Another tab kept it." };
      } catch (error) {
        if (!isAbort(error) || mine !== epoch) return { ok: false, error: "Couldn't take over editing." };
        if (gaveUp !== null) {
          keepState();
          return { ok: false, error: gaveUp };
        }
        // No answer: a frozen tab. Steal.
        const held = await hold(projectId, { steal: true }, mine);
        return held ? { ok: true, value: undefined } : { ok: false, error: "Couldn't take over editing." };
      } finally {
        clearTimeout(timer);
        waiting.delete(projectId);
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
