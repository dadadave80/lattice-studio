/**
 * S10's services (contracts §5.2): `toast`, `showBanner` and `hideBanner`. Registering here (discovered by
 * `discover.ts`) means any toast or banner another module posted before this module evaluated is replayed in
 * (see `provideServices`'s doc), so registration order between modules never loses one.
 */
import { provideServices } from "@/contracts";
import { dropBanner, putBanner } from "./banner-store";
import { addToast } from "./toast-service";

provideServices({
  toast: addToast,
  showBanner: putBanner,
  hideBanner: dropBanner,
});
