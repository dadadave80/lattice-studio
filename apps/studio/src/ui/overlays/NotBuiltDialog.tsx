import { closeDialog, type DialogComponentProps } from "@/contracts";
import { Button } from "../buttons/Button";
import { DIALOG_CATALOG, notBuiltText } from "./dialog-catalog";
import { Dialog } from "./Dialog";

/** What `DialogHost` renders for a dialog whose owner hasn't registered it yet. Closing loses nothing. */
export function NotBuiltDialog({ entry, top }: DialogComponentProps) {
  const close = () => closeDialog(entry.id);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={DIALOG_CATALOG[entry.id].title}
      lossless
      top={top}
      footer={<Button onClick={close}>Close</Button>}
    >
      <p>{notBuiltText(entry.id)}</p>
    </Dialog>
  );
}
