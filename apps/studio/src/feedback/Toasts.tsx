import { ToastRegion } from "@/ui";
import { toasts } from "./toast-service";

/**
 * The toast region (spec L731-L735): one at a time, never taking focus, a stop in F6 cycling. Mount it once,
 * at the app's top level. When S3's shell exports its own `shellToasts` instance, it mounts `ToastRegion`
 * itself with that manager instead of this component (see `toasts.ts`'s doc).
 */
export function Toasts() {
  return <ToastRegion manager={toasts.manager} />;
}
