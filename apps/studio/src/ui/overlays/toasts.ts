import { Toast, type ToastManager } from "@base-ui/react/toast";
import type { CommandRef } from "@lattice-studio/core";
import { commandState, now, type ToastInput } from "@/contracts";

/** What each toast carries for `ToastRegion` to render. */
export type ToastData = {
  kind: "info" | "error";
  /** The toast's one action and its button label (the command's title when the toast was added). */
  action?: { ref: CommandRef; title: string };
};

export type Toasts = {
  /** Pass it to `<ToastRegion manager={…} />`. */
  manager: ToastManager<ToastData>;
  /**
   * Shows a toast, replacing the one showing (one at a time), except an error: errors stay until closed, so
   * while one shows, a new toast waits. What waits: every error, in order, and only the newest info toast
   * without an action. A toast with an action (Undo, Fix…) never waits: it shows now or not at all, so its
   * action can't surface later and act on something else. Once the error is closed, the next waiting error
   * shows; when none is left, the waiting info toast shows if its own timeout (6 s) hasn't run out since it
   * was added. With no `ToastRegion` mounted, toasts wait the same way, and an error that was showing shows
   * again when a region mounts. Every toast is also a console line, so a toast that never shows loses nothing.
   * Returns its id.
   */
  add(input: ToastInput): string;
  /** Closes a toast by id, or the one showing; a waiting toast is dropped. Closing an error releases the hold. */
  dismiss(id?: string): void;
  /** Closes the toast showing and drops every waiting one. */
  clear(): void;
};

/** How many toasts can wait at once; past it, the oldest waiting error is dropped. */
export const WAITING_LIMIT = 5;

/** Auto-dismiss after 6 s, or 10 s with an action; errors stay until closed (0) (spec L733). */
export function toastTimeout(input: ToastInput): number {
  if (input.kind === "error") return 0;
  return input.action ? 10_000 : 6_000;
}

type Entry = { id: string; input: ToastInput; at: number };

const isError = (entry: Entry) => entry.input.kind === "error";

/** A toast manager and the `add(input)` the `toast()` service calls. */
export function createToasts(): Toasts {
  const inner = Toast.createToastManager<ToastData>();
  let count = 0;
  /** Mounted regions (Base UI providers listening to the manager). */
  let regions = 0;
  /** The error showing, which holds everything added after it; null when none is. */
  let held: Entry | null = null;
  /** The id of the toast showing, if a region shows it. */
  let showing: string | null = null;
  const waiting: Entry[] = [];

  const show = (entry: Entry) => {
    const { id, input } = entry;
    const kind = input.kind ?? "info";
    const data: ToastData = input.action
      ? { kind, action: { ref: input.action, title: commandState(input.action, "toast").title } }
      : { kind };
    if (kind === "error") held = entry;
    showing = id;
    inner.add({
      id,
      title: input.text,
      type: kind,
      timeout: toastTimeout(input),
      data,
      onClose: () => closed(id),
    });
  };

  /** A toast closed (its Close, its timeout, `dismiss`): an error lets what waited show. Safe to call twice. */
  const closed = (id: string) => {
    if (showing === id) showing = null;
    if (held?.id === id) {
      held = null;
      release();
    }
  };

  /** Too old to show: an info toast whose own timeout ran out while it waited. Errors never are. */
  const stale = (entry: Entry) => !isError(entry) && now() - entry.at >= toastTimeout(entry.input);

  /** Nothing holds: show the next waiting error, else the waiting info toast if it's still fresh. */
  const release = () => {
    while (held === null && regions > 0) {
      const index = waiting.findIndex(isError);
      const [next] = waiting.splice(index >= 0 ? index : 0, 1);
      if (!next) return;
      if (stale(next)) continue;
      show(next);
      if (!isError(next)) return;
    }
  };

  const wait = (entry: Entry) => {
    if (isError(entry)) {
      waiting.push(entry);
      if (waiting.length > WAITING_LIMIT) waiting.splice(waiting.findIndex(isError), 1);
      return;
    }
    // A toast with an action only means something now; an info toast without one replaces the one waiting.
    if (entry.input.action) return;
    const index = waiting.findIndex((other) => !isError(other));
    if (index >= 0) waiting.splice(index, 1);
    waiting.push(entry);
  };

  const manager: ToastManager<ToastData> = {
    ...inner,
    " subscribe": (listener) => {
      const unsubscribe = inner[" subscribe"](listener);
      regions += 1;
      // The first region to mount shows the error that was showing (added before any region listened, or
      // left when the last one unmounted), else what waited.
      if (regions === 1) {
        if (held) show(held);
        else release();
      }
      let done = false;
      return () => {
        unsubscribe();
        if (done) return;
        done = true;
        regions -= 1;
        // The region took its toasts with it: an info toast is gone, and a held error waits for the next region.
        if (regions === 0) showing = null;
      };
    },
  };

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
      const target = id ?? showing ?? held?.id;
      if (target === undefined || target === null) return;
      const index = waiting.findIndex((entry) => entry.id === target);
      if (index >= 0) {
        waiting.splice(index, 1);
        return;
      }
      inner.close(target);
      closed(target);
    },
    clear() {
      waiting.length = 0;
      held = null;
      showing = null;
      inner.close();
    },
  };
}
