import { exportProjectFile } from "@lattice-studio/core";
import { useRef, useState } from "react";
import { closeDialog, useDocument, type DialogComponentProps } from "@/contracts";
import { Button, Dialog, TextField } from "@/ui";

/** Save a copy… (IR "Save a copy" dialog: File name field, Save primary, Cancel). */
export function SaveCopyDialogPanel({ entry, top }: DialogComponentProps<"save-copy">) {
  const project = useDocument((s) => s.project);
  const [filename, setFilename] = useState(entry.props.filename ?? exportProjectFile(project, []).filename);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => closeDialog("save-copy");

  const save = async () => {
    const name = filename.trim();
    if (name === "") {
      setError("Name the file");
      return;
    }
    setSaving(true);
    setError(null);
    const { saveCopy } = await import("../actions");
    const result = await saveCopy(project, name);
    setSaving(false);
    if (result.ok) close();
    else setError(result.error);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Save a copy"
      lossless
      top={top}
      initialFocus={inputRef}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabledReason={saving ? "Saving…" : null}>
            Save
          </Button>
        </>
      }
    >
      <TextField
        label="File name"
        value={filename}
        onValueChange={setFilename}
        inputRef={inputRef}
        error={error}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          }
        }}
      />
    </Dialog>
  );
}
