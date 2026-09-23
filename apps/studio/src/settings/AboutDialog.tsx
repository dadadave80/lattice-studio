import { closeDialog, type DialogComponentProps } from "@/contracts";
import { Button, Dialog } from "@/ui";
import { AboutGroup } from "./groups/AboutGroup";

/**
 * About (App menu → About, IR L64): the same content as Settings → About, reachable without opening
 * Settings. No board yet (PA L72-L84).
 */
export function AboutDialog({ top }: DialogComponentProps<"about">) {
  const close = () => closeDialog("about");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="About"
      lossless
      top={top}
      footer={<Button onClick={close}>Close</Button>}
    >
      <AboutGroup />
    </Dialog>
  );
}
