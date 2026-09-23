/**
 * The app's frozen contracts (contracts §5). Everything a module shares with another goes through here:
 * the stores and their hooks, the services, the deploy controller, the command registry, key contexts,
 * region and dialog ids, and build flags. Implementations register through the `provide*`, `register*`
 * and `define*` functions, in the module's own `commands.ts` or `services.ts` (see `discover.ts`).
 */
export {
  DEFAULT_SETTINGS, doc, history, initialSession, provideStores, session, settings, useDocument, useSession,
  useSettings,
} from "./stores";
export type {
  ConsoleTab, DocumentActions, DocumentState, DocumentStore, EditOp, InspectorView, LeftTab, NarrowPane,
  SessionState, SettingsState, StoreAccess, ThemeChoice, Tool, Viewport,
} from "./stores";

export { emptyAnalysis, getAnalysis, provideAnalysis, useAnalysis } from "./analysis";
export type { AnalysisProvider } from "./analysis";

export {
  catalogBase, getCatalog, getCatalogStatus, provideCatalogLoader, setCatalogStatus, startCatalog, useCatalog,
  useCatalogStatus, useFacetDetail,
} from "./catalog";
export type { CatalogLoader, CatalogStatus, FacetDetailState } from "./catalog";

export {
  announce, chainService, closeDialog, createProject, hideBanner, isOnline, listDeployments, loadViewport, log,
  now, openDialog, openProblemDoc, openProject, provideServices, pushEscape, putDeployment, randomBytes,
  registerDropTarget, saveStatus, saveViewport, showBanner, startCatalogDrag, subscribeCatalogDrag, toast,
  useOnline, useRegion, useSaveStatus,
} from "./services";
export type {
  AnnounceOptions, BannerProps, CatalogDrag, ConnectionService, DeploymentsService, DndService, DropTarget,
  EscapeHandler, ProjectsService, RegionProps, SaveStatus, Services, ToastInput,
} from "./services";

export type { AccountKind, ChainInfo, ChainService, ProbeOptions, WalletAccount } from "./chain";

export { deployController, provideDeployController, useDeployState } from "./deploy";
export type { DeployController, DeployPhase, DeployState } from "./deploy";

export {
  command, commandContext, commandState, defineCommands, getCommand, isPlaceholder, listCommands, onCommandRun,
  runCommand,
} from "./commands";
export type {
  Command, CommandArgs, CommandCategory, CommandConsole, CommandContext, CommandSource, Enablement,
} from "./commands";

export { KEY_CONTEXT_ATTRIBUTE, KEY_CONTEXTS } from "./keys";
export type { KeyContext, KeySpec } from "./keys";

export { REGION_IDS, REGION_LABELS } from "./regions";
export type { RegionId } from "./regions";

export { DIALOG_IDS, dialogComponent, registerDialog } from "./dialogs";
export type { DialogComponentProps, DialogEntry, DialogId, DialogProps } from "./dialogs";

export { env } from "./env";
export { applyTheme, resolveTheme, syncTheme } from "./theme";
export { layoutMetrics } from "./layout-metrics";
