import { Toast, type ToastManager } from "@base-ui/react/toast";
import type { CommandRef } from "@lattice-studio/core";
import { commandState, type ToastInput } from "@/contracts";

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
   * while one shows, new toasts wait and show, in order, once it's closed. Returns its id.
   */
  add(input: ToastInput): string;
};

/** Auto-dismiss after 6 s, or 10 s with an action; errors stay until closed (0) (spec L733). */
export function toastTimeout(input: ToastInput): number {
  if (input.kind === "error") return 0;
  return input.action ? 10_000 : 6_000;
}

/** A toast manager and the `add(input)` the `toast()` service calls. */
export function createToasts(): Toasts {
  const manager = Toast.createToastManager<ToastData>();
  let count = 0;
  /** The error showing, which holds everything added after it; null when none is. */
  let heldBy: string | null = null;
  const waiting: { id: string; input: ToastInput }[] = [];

  const show = (id: string, input: ToastInput) => {
    const kind = input.kind ?? "info";
    const data: ToastData = input.action
      ? { kind, action: { ref: input.action, title: commandState(input.action, "toast").title } }
      : { kind };
    if (kind === "error") heldBy = id;
    manager.add({
      id,
      title: input.text,
      type: kind,
      timeout: toastTimeout(input),
      data,
      onClose: () => {
        if (heldBy === id) release();
      },
    });
  };

  /** The error closed: show what waited, in order, until the next error holds the rest. */
  const release = () => {
    heldBy = null;
    while (heldBy === null) {
      const next = waiting.shift();
      if (!next) return;
      show(next.id, next.input);
    }
  };

  return {
    manager,
    add(input) {
      count += 1;
      const id = `lx-toast-${count}`;
      if (heldBy === null) show(id, input);
      else waiting.push({ id, input });
      return id;
    },
  };
}
