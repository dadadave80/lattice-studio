/**
 * WalletConnect, "Other wallets (QR)" (spec L564, decision 13): its own chunk, fetched only when the person chooses
 * it, never precached (spec L830). Telemetry stays off (spec L882); its relay still sees the connection, which
 * Settings → Wallet says. The SDK is re-exported here so wagmi's own `import()` of it resolves into this chunk.
 */
import { walletConnect } from "@wagmi/connectors";
import type { CreateConnectorFn } from "@wagmi/core";

export { EthereumProvider } from "@walletconnect/ethereum-provider";

export function walletConnectConnector(projectId: string): CreateConnectorFn {
  return walletConnect({
    projectId,
    showQrModal: true,
    telemetryEnabled: false,
    metadata: {
      name: "Lattice Studio",
      description: "Compose EIP-2535 diamonds from the Lattice library and deploy them.",
      url: typeof location === "undefined" ? "" : location.origin,
      icons: [],
    },
  });
}
