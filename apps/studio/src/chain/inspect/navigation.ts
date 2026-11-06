let generation = 0;

/** Successful project replacement supersedes asynchronous address/name navigation. */
export function cancelInspectionNavigation(): void { generation++; }
export function inspectionNavigationGeneration(): number { return generation; }
