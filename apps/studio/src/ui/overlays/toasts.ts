import { Toast, type ToastManager } from "@base-ui/react/toast";
import type { CommandRef } from "@lattice-studio/core";
import { commandState, now, type ToastInput } from "@/contracts";

/** What each toast carries for `ToastRegion` to render. */
export type ToastData = {
  kind: "info" | "error";
  /** The toast's one action and its button label: `action.label` when the toast set one, else the command's
   * title when the toast was added. */
  action?: { ref: CommandRef; title: string };
};

/**
 * Why a toast never showed, or stopped waiting: a toast with an action added while an error holds, a waiting
 * toast whose own timeout ran out, an error past the waiting cap, a waiting info toast replaced by a newer one,
 * a waiting toast dismissed by id, or everything waiting when `clear()` ran.
 */
export type ToastDropReason = "held" | "expired" | "cap" | "replaced" | "dismissed" | "cleared";

/** A dropped toast: what was added, and the id `add` returned for it. */
export type DroppedToast = ToastInput & { id: string };

export type ToastsOptions = {
  /** Called for every toast dropped without showing (the `toast()` service logs it). */
  onDrop?: (toast: DroppedToast, reason: ToastDropReason) => void;
};

export type Toasts = {
  /** Pass it to `<ToastRegion manager={…} />`. */
  manager: ToastManager<ToastData>;
  /**
   * Shows a toast, closing the one showing (one at a time), except an error: errors stay until closed, so
   * while one shows, a new toast waits. What waits: every error, in order (at most `WAITING_LIMIT`), and only
   * the newest info toast. A toast with an action (Undo, Fix…) added while an error shows never shows, so its
   * action can't surface later and act on something else. Once the error is closed, the next waiting error
   * shows; when none is left, the waiting info toast shows if its own timeout hasn't run out since it was
   * added. With no `ToastRegion` mounted, toasts wait the same way (a toast with an action shows only for what
   * is left of its 10 s), and an error that was showing shows again when a region mounts. A toast that never
   * shows goes to `onDrop`; the `toast()` service (S10) writes every toast's console line. Returns its id.
   */
  add(input: ToastInput): string;
  /** Closes a toast by id, or the one showing; a waiting toast is dropped. Closing an error releases the hold. */
  dismiss(id?: string): void;
  /** Closes the toast showing and drops every waiting one. */
  clear(): void;
};

/** How many errors can wait at once (beside the one info toast that can); past it, the oldest is dropped. */
export const WAITING_LIMIT = 5;

/** Auto-dismiss after 6 s, or 10 s with an action; errors stay until closed (0) (spec L733). */
export function toastTimeout(input: ToastInput): number {
  if (input.kind === "error") return 0;
  return input.action ? 10_000 : 6_000;
}

type Entry = { id: string; input: ToastInput; at: number };

const isError = (entry: Entry) => entry.input.kind === "error";

/** Each manager's `attach`, for `attachRegion`. */
const attachers = new WeakMap<object, () => () => void>();

/**
 * Tells the toasts behind `manager` that a region now shows them; returns the detach. `ToastRegion` calls it
 * from an effect, after its Base UI provider listens. A manager not from `createToasts` has nothing to attach.
 */
export function attachRegion(manager: ToastManager<ToastData>): () => void {
  return attachers.get(manager)?.() ?? (() => {});
}

/** A toast manager and the `add(input)` the `toast()` service calls. */
export function createToasts(options: ToastsOptions = {}): Toasts {
  const manager = Toast.createToastManager<ToastData>();
  let count = 0;
  /** Mounted regions. */
  let regions = 0;
  /** The error showing, which holds everything added after it; null when none is. */
  let held: Entry | null = null;
  /** The toast showing and when its timeout ends (null for an error); null when none is. */
  let showing: { entry: Entry; until: number | null } | null = null;
  const waiting: Entry[] = [];

  const drop = (entry: Entry, reason: ToastDropReason) => options.onDrop?.({ ...entry.input, id: entry.id }, reason);

  /** Too old to show: a toast whose own timeout ran out since it was added. Errors never are. */
  const stale = (entry: Entry) => !isError(entry) && now() - entry.at >= toastTimeout(entry.input);

  /** How long a toast shows: its full timeout, except a toast with an action, which gets what's left of it. */
  const timeLeft = (entry: Entry) => {
    const full = toastTimeout(entry.input);
    return entry.input.action && !isError(entry) ? full - (now() - entry.at) : full;
  };

  /** Closes the toast showing, if it's another one, so Base UI can't bring it back later. */
  const closeShowing = (except?: string) => {
    if (!showing || showing.entry.id === except) return;
    const { id } = showing.entry;
    showing = null;
    manager.close(id);
  };

  const show = (entry: Entry, timeout = timeLeft(entry)) => {
    const { id, input } = entry;
    // Base UI's limit only hides a replaced toast (its timer paused while the region is hovered); closing it
    // keeps an Undo from coming back when the toast after it closes.
    closeShowing(id);
    const kind = input.kind ?? "info";
    if (kind === "error") {
      held = entry;
      // A toast with an action that waited for a region can't show after an error: its moment will be gone.
      for (let i = waiting.length - 1; i >= 0; i -= 1) {
        const other = waiting[i];
        if (other && !isError(other) && other.input.action) {
          waiting.splice(i, 1);
          drop(other, "held");
        }
      }
    }
    showing = { entry, until: timeout > 0 ? now() + timeout : null };
    const data: ToastData = input.action
      ? { kind, action: { ref: input.action, title: input.action.label ?? commandState(input.action, "toast").title } }
      : { kind };
    manager.add({ id, title: input.text, type: kind, timeout, data, onClose: () => closed(id) });
  };

  /** A toast closed (its Close, its timeout, `dismiss`): an error lets what waited show. Safe to call twice. */
  const closed = (id: string) => {
    if (showing?.entry.id === id) showing = null;
    if (held?.id === id) {
      held = null;
      release();
    }
  };

  /** Nothing holds: show the next waiting error, else the waiting info toast if it's still fresh. */
  const release = () => {
    while (held === null && regions > 0) {
      const index = waiting.findIndex(isError);
      const [next] = waiting.splice(index >= 0 ? index : 0, 1);
      if (!next) return;
      if (stale(next)) {
        drop(next, "expired");
        continue;
      }
      show(next);
      if (!isError(next)) return;
    }
  };

  const wait = (entry: Entry) => {
    if (isError(entry)) {
      waiting.push(entry);
      if (waiting.filter(isError).length > WAITING_LIMIT) {
        const [oldest] = waiting.splice(waiting.findIndex(isError), 1);
        if (oldest) drop(oldest, "cap");
      }
      return;
    }
    // A toast with an action only means something now: behind an error, it never shows.
    if (held !== null && entry.input.action) {
      drop(entry, "held");
      return;
    }
    const index = waiting.findIndex((other) => !isError(other));
    if (index >= 0) {
      const [older] = waiting.splice(index, 1);
      if (older) drop(older, "replaced");
    }
    waiting.push(entry);
  };

  const attach = () => {
    regions += 1;
    // The first region shows the error that was showing (added before any region, or left when the last one
    // unmounted), else the toast that was showing for what's left of its time, else what waited.
    if (regions === 1) {
      if (held) show(held);
      else {
        const current = showing;
        const left = current && current.until !== null ? current.until - now() : 0;
        if (current && left > 0 && waiting.length === 0) show(current.entry, left);
        else closeShowing();
        release();
      }
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      regions -= 1;
    };
  };
  attachers.set(manager, attach);

  return {
    manager,
    add(input) {
      count += 1;
      const entry: Entry = { id: `lx-toast-${count}`, input, at: now() };
      if (held === null && regions > 0) show(entry);
      else wait(entry);
      return entry.id;
    },
    dismiss(id) {
      const target = id ?? showing?.entry.id ?? held?.id;
      if (target === undefined) return;
      const index = waiting.findIndex((entry) => entry.id === target);
      if (index >= 0) {
        const [entry] = waiting.splice(index, 1);
        if (entry) drop(entry, "dismissed");
        return;
      }
      manager.close(target);
      closed(target);
    },
    clear() {
      const dropped = waiting.splice(0);
      held = null;
      showing = null;
      manager.close();
      for (const entry of dropped) drop(entry, "cleared");
    },
  };
}
