import { settings, useSettings } from "@/contracts";
import { Switch } from "@/ui";

/** Settings → Wallet (Flow 16 L629, spec L882 privacy note). No board yet (PA L72-L84). */
export function WalletGroup() {
  const walletConnect = useSettings((s) => s.walletConnect);
  return (
    <Switch
      label="WalletConnect"
      checked={walletConnect}
      onCheckedChange={(walletConnect) => settings.set({ walletConnect })}
      description="Off until chosen. When it's on, its relay sees the connection, and its telemetry stays disabled."
    />
  );
}
