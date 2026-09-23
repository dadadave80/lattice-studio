import { Toast, type ToastManager } from "@base-ui/react/toast";
import { runCommand } from "@/contracts";
import { Button } from "../buttons/Button";
import { IconButton } from "../buttons/IconButton";
import { Icon } from "../icons/Icon";
import type { ToastData } from "./toasts";
import styles from "./Toast.module.css";

export type ToastRegionProps = {
  /** From `createToasts()`. */
  manager: ToastManager<ToastData>;
};

function ToastList() {
  const { toasts, close } = Toast.useToastManager<ToastData>();
  return toasts.map((toast) => {
    const error = toast.data?.kind === "error";
    const action = toast.data?.action;
    return (
      <Toast.Root key={toast.id} toast={toast} className={styles.toast}>
        <Toast.Content className={styles.content}>
          {error ? <Icon name="error" label="Error" className={styles.icon} /> : null}
          {/* The text names the toast (a paragraph, not a heading). */}
          <Toast.Title render={<p />} className={styles.text}>
            {toast.title}
          </Toast.Title>
          {action ? (
            <Toast.Action
              render={<Button size="small">{action.title}</Button>}
              onClick={() => {
                close(toast.id);
                void runCommand(action.ref, "toast");
              }}
            />
          ) : null}
          {/* Base UI hides Close from assistive technology until the region is hovered or focused, but it stays
              focusable; keep it exposed so nothing focusable is hidden. */}
          <Toast.Close aria-hidden={false} render={<IconButton icon="close" label="Close" size="small" />} />
        </Toast.Content>
      </Toast.Root>
    );
  });
}

/**
 * The toast region (spec L733): one toast at a time, never taking focus, pausing while hovered or focused.
 * Each toast shows its text, "Error" with an icon for errors, its action (run from the toast) and Close.
 */
export function ToastRegion({ manager }: ToastRegionProps) {
  return (
    <Toast.Provider toastManager={manager} limit={1}>
      <Toast.Portal>
        <Toast.Viewport className={styles.viewport}>
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
