/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in end-to-end builds (contracts §5.5). */
  readonly VITE_STUDIO_E2E?: string;
}
