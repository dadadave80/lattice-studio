/**
 * Keeps viem out of first load in a build with a WalletConnect project id (QUESTIONS Q27, FX34's finding). Reown's
 * AppKit, the QR modal the WalletConnect connector loads, reads three functions with `await import("viem")`. That
 * asks for viem's whole namespace, and resolved to the module the entry already imports (core and the catalog
 * loader use a few viem functions), every viem export, with ox, abitype and @noble, landed in the entry chunk
 * (354.7 → 433.6 KB gz). Resolved instead to a module that re-exports only those three, the import stays in the
 * wallet's lazy chunk and the entry keeps what it uses. `wallet-viem.test.ts` checks the list against AppKit's code.
 */
import type { Plugin } from "vite";

/** Packages that load only when the person chooses WalletConnect (precache.ts `LAZY_ONLY_MODULES`). */
export const WALLET_SDK = /[\\/]node_modules[\\/](?:@reown|@walletconnect)[\\/]/;

/** What AppKit's `ViemUtil` takes from `import("viem")`. */
export const WALLET_VIEM_EXPORTS = ["createPublicClient", "defineChain", "http"] as const;

const WALLET_VIEM = "\0lattice-wallet-viem";

export function walletViem(): Plugin {
  return {
    name: "lattice-wallet-viem",
    enforce: "pre",
    resolveId(source, importer, options) {
      const fromWallet = source === "viem" && importer !== undefined && WALLET_SDK.test(importer);
      return fromWallet && options.kind === "dynamic-import" ? WALLET_VIEM : null;
    },
    load(id) {
      return id === WALLET_VIEM ? `export { ${WALLET_VIEM_EXPORTS.join(", ")} } from "viem";` : null;
    },
  };
}
