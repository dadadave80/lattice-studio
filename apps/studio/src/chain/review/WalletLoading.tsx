import { LOADING_WALLET_SUPPORT } from "./copy";
import { useReview } from "./review-data";
import styles from "./review.module.css";

/**
 * "Loading wallet support…" while the chain module loads (spec L562), as S8a's `WalletSupportStatus` says it, read
 * from the review's own load of the module so the review's chunk needn't import S8a's loader.
 */
export function WalletLoading() {
  const { serviceLoading } = useReview();
  if (!serviceLoading) return null;
  return <output className={styles.muted}>{LOADING_WALLET_SUPPORT}</output>;
}
