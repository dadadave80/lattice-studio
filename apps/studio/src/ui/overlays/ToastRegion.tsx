import { Toast, type ToastManager } from "@base-ui/react/toast";
import { runCommand, useRegion } from "@/contracts";
import { Button } from "../buttons/Button";
import { IconButton } from "../buttons/IconButton";
import { Icon } from "../icons/Icon";
import { cx } from "../shared/cx";
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
 * The toast region (spec L733): one toast at a time, never taking focus, pausing while hovered or focused; an
 * error holds newer toasts back until it's closed (`createToasts`).
 * Each toast shows its text, "Error" with an icon for errors, its action (run from the toast) and Close.
 */
export function ToastRegion({ manager }: ToastRegionProps) {
  // The viewport is the `toasts` F6 region (spec L733): its label, data-region and tabIndex win over Base UI's.
  // Base UI also listens for F6 on window (bubble phase) and focuses the viewport while toasts exist; it has no
  // option to turn that off. The app's F6 cycling (S9) listens in the capture phase and stops propagation, so
  // Base UI's listener never sees an F6 the app handled.
  const { ref: regionRef, className: regionClassName, ...region } = useRegion("toasts");
  return (
    <Toast.Provider toastManager={manager} limit={1}>
      <Toast.Portal>
        <Toast.Viewport {...region} ref={regionRef} className={cx(styles.viewport, regionClassName)}>
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
