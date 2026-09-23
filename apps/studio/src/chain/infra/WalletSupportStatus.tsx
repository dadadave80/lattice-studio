/**
 * The lazy boundary's status line (spec L562): "Loading wallet support…" while the chain module loads, and nothing
 * otherwise. A failed load shows nothing here: S11a's banner ("Studio was updated. Save and reload to continue.")
 * covers it, and retrying would only get the browser's cached failure back. The deploy review's Network and
 * Deployer sections and the inspector's chain rows render it (S8b, S5c).
 */
import { chainLoader, useChainLoad, type ChainLoader } from "./loader";
import styles from "./WalletSupportStatus.module.css";

export type WalletSupportStatusProps = {
  /** Default: the app's loader. */
  loader?: ChainLoader;
};

export function WalletSupportStatus({ loader = chainLoader }: WalletSupportStatusProps) {
  const state = useChainLoad(loader);
  if (state.status !== "loading") return null;
  return (
    <output className={styles.status} aria-live="polite">
      {state.text}
    </output>
  );
}
