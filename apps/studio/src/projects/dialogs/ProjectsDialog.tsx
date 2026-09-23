import { lazy, Suspense } from "react";
import type { DialogComponentProps } from "@/contracts";

const Panel = lazy(() => import("./ProjectsDialogPanel").then((m) => ({ default: m.ProjectsDialogPanel })));

/** Projects (App menu, IR "Projects" table): recent first, with Recently deleted. */
export function ProjectsDialog(props: DialogComponentProps<"projects">) {
  return (
    <Suspense fallback={null}>
      <Panel {...props} />
    </Suspense>
  );
}
