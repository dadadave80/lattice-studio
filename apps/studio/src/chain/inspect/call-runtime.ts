import { chainService } from "@/contracts";
import { createCallController } from "./calls";

let calls: ReturnType<typeof createCallController> | null = null;
export function getCallController() {
  calls ??= createCallController({
    resolve: async (name, chainId) => (await chainService()).resolveEns(name, chainId),
    call: async (chainId, to, data, options) => (await chainService()).call(chainId, to, data, options),
  });
  return calls;
}

/** Confirmed writes also invalidate results before their new snapshot arrives. */
export function invalidateInspectionCalls(): void { calls?.invalidate(); }
