/**
 * S13's registrations (contracts §5.2, discovered by `contracts/discover.ts`): opening a `#s=` link, the Share
 * and Migrate dialogs, the Confirm addresses… inspector view, and the read-only state that follows the edit lock
 * and the catalog pin. Everything with weight loads through `import()`, each in its own Suspense boundary.
 */
import { createElement, lazy, Suspense } from "react";
import {
  log, provideServices, registerDialog, registerInspectorView, type DialogComponentProps, type InspectorViewProps,
} from "@/contracts";
import { startReadOnly } from "./read-only";

const LazyShare = lazy(() => import("./ShareDialog").then((m) => ({ default: m.ShareDialog })));
const LazyMigrate = lazy(() => import("./MigrateDialog").then((m) => ({ default: m.MigrateDialog })));
const LazyConfirm = lazy(() => import("./ConfirmAddressesView").then((m) => ({ default: m.ConfirmAddressesView })));

function Share(props: DialogComponentProps<"share">) {
  return createElement(Suspense, { fallback: null }, createElement(LazyShare, props));
}

function Migrate(props: DialogComponentProps<"migrate">) {
  return createElement(Suspense, { fallback: null }, createElement(LazyMigrate, props));
}

function ConfirmAddresses(props: InspectorViewProps<"confirm-addresses">) {
  return createElement(Suspense, { fallback: createElement("p", { role: "status" }, "Loading the addresses…") }, createElement(LazyConfirm, props));
}

registerDialog("share", Share);
registerDialog("migrate", Migrate);
registerInspectorView("confirm-addresses", ConfirmAddresses);

provideServices({
  openShareLink(link) {
    import("./open-link")
      .then((m) => m.openShareLink(link))
      .catch((error: unknown) => {
        log({ tag: "Error", text: `This link couldn't be opened: ${error instanceof Error ? error.message : String(error)}` });
      });
  },
});

startReadOnly();
