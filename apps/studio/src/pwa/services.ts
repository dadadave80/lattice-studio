/**
 * S11a's registrations (contracts §5.2 `connection`). Evaluated in the entry chunk and in every browser test
 * (`contracts/discover.ts`), so it only provides the connection service and, in the app itself, starts the
 * PWA module: chunk-failure and offline banners now, the service worker from a lazy chunk.
 */
import { provideServices } from "@/contracts";
import { bootPwa } from "./boot";
import { browserConnection } from "./connection";

const connection = browserConnection();
provideServices({ connection });

if (import.meta.env.MODE !== "test" && typeof window !== "undefined") {
  bootPwa(connection, { target: window, load: () => import("./start") });
}
