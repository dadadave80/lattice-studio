import type { CommandRef } from "@lattice-studio/core";
import { formatFee, toChecksum } from "@lattice-studio/core";
import { commandRef } from "@/contracts";
import { ACCOUNT_KINDS, CONNECT_A_WALLET, NO_WALLET, walletOn, type SectionStatus } from "./copy";
import { FixButton } from "./FixButton";
import { WalletLoading } from "./WalletLoading";
import { currencyOf, nameOf, shortOfFunds, useReview } from "./review-data";
import styles from "./review.module.css";
import { Section } from "./Section";

/** Where to get a browser wallet (Flow 14: no wallet in the browser). */
const FIND_A_WALLET = "https://ethereum.org/en/wallets/find-wallet/";

function connect(connector: string): CommandRef {
  return { id: "wallet.connect", args: { connector } };
}

/**
 * Deployer (spec L564): Connect wallet lists the browser wallets found through EIP-6963, then Other wallets (QR);
 * once connected, the account in full, its kind and balance, Switch network when the wallet is on another chain,
 * and for a Safe, Download Transaction Builder batch (IR L237).
 */
export function DeployerSection() {
  const review = useReview();
  const { account, connectors, chainId, chainInfo } = review;
  const currency = currencyOf(review);
  const funds = shortOfFunds(review);

  let status: SectionStatus = "ok";
  let body;
  if (!account) {
    status = "waiting";
    const browser = connectors.filter((c) => c.kind !== "walletconnect");
    const qr = connectors.filter((c) => c.kind === "walletconnect");
    body = (
      <>
        <p className={styles.line}>{CONNECT_A_WALLET}</p>
        {browser.length === 0 ? (
          <p className={styles.muted}>
            {NO_WALLET}{" "}
            <a className={styles.link} href={FIND_A_WALLET} target="_blank" rel="noreferrer">
              Find a wallet
            </a>
          </p>
        ) : null}
        <div className={styles.actions} data-connectors="">
          {[...browser, ...qr].map((c) => (
            <FixButton key={c.id} command={connect(c.id)} icon="wallet">
              {c.name}
            </FixButton>
          ))}
        </div>
      </>
    );
  } else {
    const elsewhere = chainId !== null && account.chainId !== chainId;
    if (elsewhere || funds) status = "blocked";
    const address = toChecksum(account.address);
    body = (
      <>
        <dl className={styles.facts}>
          <dt>Account</dt>
          <dd data-account="">{account.ens ? `${account.ens} (${address})` : address}</dd>
          <dt>Kind</dt>
          <dd>{ACCOUNT_KINDS[account.kind ?? "eoa"]}</dd>
          <dt>Balance</dt>
          <dd>{account.balance === undefined ? "Reading…" : formatFee(account.balance, currency.symbol, currency.decimals)}</dd>
        </dl>
        {elsewhere ? (
          <div className={styles.actions}>
            <p className={styles.line}>{walletOn(nameOf(review, account.chainId))}</p>
            <FixButton command={commandRef("wallet.switchNetwork")} />
          </div>
        ) : null}
        {funds ? (
          <p className={styles.line} data-funds="">
            {funds}
            {chainInfo?.testnet && chainInfo.faucet ? (
              <>
                {" "}
                <a className={styles.link} href={chainInfo.faucet} target="_blank" rel="noreferrer">
                  Get test ETH from a faucet
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        {account.kind === "safe" ? (
          <div className={styles.actions}>
            <p className={styles.muted}>A Safe signs in the Safe app: import this batch in its Transaction Builder.</p>
            <FixButton command={commandRef("deploy.downloadSafeBatch")} icon="download" />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <Section id="deployer" status={status}>
      <WalletLoading />
      {body}
    </Section>
  );
}
