/**
 * What the status region says for deploy output (spec L778: "A setting chooses which deploy output is announced:
 * errors, everything, or nothing"). The Log itself is `role="log"` with `aria-live="off"`, so each line is read
 * once: by its emitter's `announce()`, or here for deploy output.
 *
 * Deploy output is a Deploy or Verify line, or an Error line from a deploy (one starting "Deploy", or any Error
 * while a deploy is under way). Other Error lines are their emitters' to announce. A revert interrupts (spec
 * L777), so it's assertive; everything else is polite.
 */
import type { ConsoleLine } from "@lattice-studio/core";
import type { AnnounceOptions, DeployPhase, SettingsState } from "@/contracts";
import { STREAMING } from "./summary";

export type DeployAnnouncement = { text: string; options: AnnounceOptions };

function fromDeploy(line: ConsoleLine, phase: DeployPhase): boolean {
  if (line.tag === "Deploy" || line.tag === "Verify") return true;
  return line.tag === "Error" && (line.text.startsWith("Deploy") || STREAMING.has(phase));
}

export function deployAnnouncement(
  line: ConsoleLine,
  setting: SettingsState["deployAnnouncements"],
  phase: DeployPhase,
): DeployAnnouncement | null {
  if (setting === "none" || !fromDeploy(line, phase)) return null;
  if (setting === "errors" && line.tag !== "Error") return null;
  const politeness = line.tag === "Error" && line.text.startsWith("Deploy reverted") ? "assertive" : "polite";
  return { text: line.text, options: { politeness } };
}
