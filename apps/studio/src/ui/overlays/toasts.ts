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
  /** Shows a toast (replacing the one showing: one at a time). Returns its id. */
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
  return {
    manager,
    add(input) {
      const kind = input.kind ?? "info";
      const data: ToastData = input.action
        ? { kind, action: { ref: input.action, title: commandState(input.action, "toast").title } }
        : { kind };
      return manager.add({ title: input.text, type: kind, timeout: toastTimeout(input), data });
    },
  };
}
