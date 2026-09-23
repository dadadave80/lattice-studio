/**
 * The lazy boundary's status line (spec L562): "Loading wallet support…" while the chain module loads, and, if it
 * fails, why, with Retry. Nothing once it's loaded or before anything asked for it. The deploy review's Network
 * and Deployer sections and the inspector's chain rows render it (S8b, S5c).
 *
 * A minimal, token-styled surface until S0's primitives land: S0's Button should replace the plain button.
 */
import { chainLoader, useChainLoad, type ChainLoader } from "./loader";
import styles from "./WalletSupportStatus.module.css";

export type WalletSupportStatusProps = {
  /** Default: the app's loader. */
  loader?: ChainLoader;
};

export function WalletSupportStatus({ loader = chainLoader }: WalletSupportStatusProps) {
  const state = useChainLoad(loader);
  if (state.status === "loading") {
    return (
      <output className={styles.status} aria-live="polite">
        {state.text}
      </output>
    );
  }
  if (state.status === "failed") {
    return (
      <div className={styles.failed}>
        <p className={styles.text} role="alert">
          {state.text} <span className={styles.reason}>{state.reason}</span>
        </p>
        <button
          type="button"
          className={`${styles.retry} lx-focus-ring`}
          onClick={() => {
            loader.load().catch(() => {
              // The loader's state carries the reason; this line shows it.
            });
          }}
        >
          Retry
        </button>
      </div>
    );
  }
  return null;
}
