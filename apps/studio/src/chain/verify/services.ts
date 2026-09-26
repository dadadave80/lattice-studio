/**
 * S8d's registration (contracts §5.2 "chain/verify"): right after startup, the watcher that verifies every
 * confirmed record still pending (its own small chunk). Under Vitest it stays off; tests start it themselves.
 * Light: nothing here opens IndexedDB, fetches or imports the network at module evaluation.
 */
import { env } from "@/contracts";

if (!env.test) {
  import("./watcher").then((m) => m.startVerifying(), (error: unknown) => console.error(error));
}
