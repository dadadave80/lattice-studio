/** The inspector's "doc" view (contracts/inspector.ts): a code's page, or the index without one. */
import { commandRef, runCommand, type InspectorViewProps } from "@/contracts";
import { HelpIndex } from "./HelpIndex";
import { ProblemDoc } from "./ProblemDoc";
import { ProblemNavigation } from "@/panels/inspector/shared/ProblemNavigation";

export function DocView({ view }: InspectorViewProps<"doc">) {
  return (
    <>
      <ProblemNavigation />
      {!view.code ? <HelpIndex /> : <ProblemDoc
      code={view.code}
      onBack={() => {
        void runCommand(commandRef("help.open"), "button");
      }}
      />}
    </>
  );
}
