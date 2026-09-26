/** The verify engine's dependencies in the app: the real `fetch`, a real clock, and S7a's deployment records. */
import { doc, listDeployments, putDeployment } from "@/contracts";
import { loadProxyBuild } from "./standard-json";
import type { VerifyDeps } from "./ports";

export function appVerifyDeps(): VerifyDeps {
  return {
    fetchImpl: (input, init) => globalThis.fetch(input, init),
    clock: {
      now: () => Date.now(),
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    records: { list: listDeployments, put: putDeployment },
    projectId: () => doc.get().id,
    proxyBuild: (chainId, path) => loadProxyBuild((input, init) => globalThis.fetch(input, init), chainId, path),
  };
}
