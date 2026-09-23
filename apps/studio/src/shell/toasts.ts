/**
 * The app's one toast manager (S0's `createToasts`), created with the shell so `ToastRegion` mounts with it
 * from the first render. S10's `toast()` service adds to it (`shellToasts.add`); until S10 registers, K2's
 * default holds toasts and replays them into S10's service.
 */
import { createToasts } from "@/ui";

export const shellToasts = createToasts();
