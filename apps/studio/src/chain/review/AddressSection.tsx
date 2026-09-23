import { CREATEX, isAddress, toChecksum } from "@lattice-studio/core";
import { useState } from "react";
import { commandRef, runCommand } from "@/contracts";
import { Button, RadioGroup, TextField } from "@/ui";
import type { SectionStatus } from "./copy";
import { FixButton } from "./FixButton";
import { pathName, problemStatus, worse } from "./model";
import { ProblemList } from "./ProblemList";
import { problemsIn, useReview } from "./review-data";
import { useReviewState } from "./review-state";
import styles from "./review.module.css";
import { Section } from "./Section";

const SCOPES = [
  { value: "every-chain", label: "Same address on every chain" },
  { value: "this-chain", label: "This chain only" },
] as const;

/**
 * Address (spec L565, IR L229-L233): the path (LatticeFactory at its release address by default, or CreateX CREATE3
 * through Use CreateX instead), the salt with Use a new salt, the scope on the CreateX path, the predicted address in
 * full with Copy, the check that it's free, and Preview for another account….
 */
export function AddressSection() {
  const review = useReview();
  const { project, catalog, prediction, chain, chainId, chainName, acked } = review;
  const problems = problemsIn(review, "address");
  const path = project.deploy.path;
  const own = chainId === null ? undefined : catalog.chains.find((c) => c.chainId === chainId)?.factory;
  const pathAddress = path === "createx" ? CREATEX : toChecksum(own?.address ?? catalog.factory.address);

  let status: SectionStatus = problemStatus(problems, acked);
  if (prediction.status !== "ready") status = worse(status, "waiting");

  let free: string;
  if (prediction.status !== "ready" || !chain) free = "The address is checked once the chain is read.";
  else if (chain.predictedHasCode === true) free = "Taken: there's already code at this address.";
  else if (chain.predictedHasCode === false) free = `Free: no code at this address on ${chainName}.`;
  else free = "Not checked yet.";

  return (
    <Section id="address" status={status}>
      <dl className={styles.facts}>
        <dt>Path</dt>
        <dd>
          {path === "createx" ? "CreateX CREATE3" : pathName(path)} at {pathAddress}
        </dd>
        <dt>Salt</dt>
        <dd data-salt="">{prediction.status === "ready" ? prediction.salt : `entropy ${project.deploy.entropy}`}</dd>
        <dt>Predicted</dt>
        <dd data-predicted="">{prediction.status === "ready" ? prediction.address : prediction.reason}</dd>
      </dl>
      <div className={styles.actions}>
        <FixButton command={commandRef("deploy.usePath", { path: path === "createx" ? "factory" : "createx" })} />
        <FixButton command={commandRef("deploy.newSalt")} />
        <FixButton command={commandRef("deploy.copyAddress")} icon="copy" />
      </div>
      {path === "createx" ? (
        <RadioGroup
          label="Scope"
          options={SCOPES}
          value={project.deploy.scope}
          onValueChange={(scope) => {
            if (scope === "every-chain" || scope === "this-chain") void runCommand(commandRef("deploy.setScope", { scope }), "button");
          }}
        />
      ) : null}
      <p className={styles.line} data-free="">
        {free}
      </p>
      <ProblemList problems={problems} omitFixes={["deploy.newSalt"]} />
      <PreviewForAccount />
    </Section>
  );
}

/** Preview for another account… (spec L565): any address, such as a Safe, without connecting it. */
function PreviewForAccount() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const preview = useReviewState((s) => s.preview);
  const value = text.trim();
  const error = value !== "" && !isAddress(value) ? "Enter a 20-byte address: 0x and 40 hex digits" : null;
  const run = () => {
    if (isAddress(value)) void runCommand(commandRef("deploy.previewFor", { address: toChecksum(value) }), "button");
  };
  if (!open) {
    return (
      <div className={styles.actions}>
        <Button size="small" onClick={() => setOpen(true)}>
          Preview for another account…
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.content} data-preview="">
      <form
        className={styles.actions}
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
      >
        <TextField label="Another account" mono value={text} onValueChange={setText} placeholder="0x…" error={error} />
        <Button size="small" type="submit" disabledReason={isAddress(value) ? null : "Enter an address to preview, such as a Safe"}>
          Preview
        </Button>
      </form>
      {preview ? (
        <output className={styles.line}>
          {preview.result.ok ? `Deployed by ${preview.account}, this diamond would be at ${preview.result.address}.` : preview.result.reason}
        </output>
      ) : null}
    </div>
  );
}
