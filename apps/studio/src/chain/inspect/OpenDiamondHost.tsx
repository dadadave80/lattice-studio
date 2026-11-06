import { closeDialog, env, session, type DialogComponentProps } from "@/contracts";
import { chainInfo, pickerChains } from "@/chain/infra/chains";
import { openInspection } from "./app";
import { OpenDiamondDialog } from "./OpenDiamondDialog";

/** Adapts the shared dialog seam without starting an RPC or changing the composition. */
export function OpenDiamondHost({ entry, top }: DialogComponentProps<"open-diamond">) {
  return <OpenDiamondDialog
    chains={pickerChains(env.e2e).map(chainInfo)} top={top}
    initialTarget={entry.props.target ?? entry.props.address ?? ""}
    initialChainId={entry.props.chainId ?? session.get().chainId}
    onInspect={openInspection} onClose={() => closeDialog("open-diamond")}
  />;
}
