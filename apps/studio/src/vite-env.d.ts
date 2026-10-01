/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in end-to-end builds (contracts §5.5). */
  readonly VITE_STUDIO_E2E?: string;
  /** This build's default Etherscan API key; public in the bundle. */
  readonly VITE_ETHERSCAN_API_KEY?: string;
}
