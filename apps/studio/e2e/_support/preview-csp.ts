/**
 * The end-to-end preview's one change to the production headers: `connect-src` also allows the local Anvil
 * nodes the kit starts (`http://127.0.0.1:*`), which the production policy (`'self' https: wss:`, S11a's
 * `build/headers.ts`) blocks. Everything else in the policy stays as the host sends it, so a CSP violation
 * still fails an end-to-end test. Used only by `global-setup.ts`; production builds never see it. It goes away
 * once `build/headers.ts` allows the loopback origin in `--mode e2e` itself (CCR from Q0).
 */
import type { Plugin } from "vite";

/** Where the kit's Anvil nodes listen. Loopback only. */
export const LOCAL_ANVIL_SOURCE = "http://127.0.0.1:*";

/** `csp` with the local Anvil source added to `connect-src` (once). Other directives are left alone. */
export function withLocalAnvil(csp: string): string {
  return csp
    .split(";")
    .map((part) => {
      const directive = part.trim();
      if (!directive.startsWith("connect-src")) return directive;
      return directive.split(/\s+/).includes(LOCAL_ANVIL_SOURCE) ? directive : `${directive} ${LOCAL_ANVIL_SOURCE}`;
    })
    .filter((directive) => directive !== "")
    .join("; ");
}

const HEADER = "Content-Security-Policy";

/**
 * A preview-only plugin. Vite appends inline plugins after the config file's, so S11a's CSP middleware has set the
 * policy by the time this one runs; it rewrites that header in place.
 */
export function e2eConnectSrc(): Plugin {
  return {
    name: "lattice-studio:e2e-connect-src",
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        const current = res.getHeader(HEADER);
        if (typeof current === "string") res.setHeader(HEADER, withLocalAnvil(current));
        next();
      });
    },
  };
}
