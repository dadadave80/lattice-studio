/**
 * The app's frozen contracts (contracts §5). Everything a module shares with another goes through here:
 * the stores and their hooks, the services, the deploy controller, the command registry, key contexts and
 * bindings, region and dialog ids, the sheet seam, and build flags.
 *
 * Implementations register through the `provide*`, `register*` and `define*` functions, at module
 * evaluation, in the module's own `commands.ts` or `services.ts`. `discover.ts` imports both eagerly into
 * the entry chunk and into every browser test, so keep them to registration calls and lazy `import()`s:
 * no IndexedDB opens, fetches or heavy imports.
 */
export {
  DEFAULT_SETTINGS, doc, history, initialSession, provideStores, session, settings, useDocument, useSession,
  useSettings,
} from "./stores";
export type {
  ConsoleTab, DocumentActions, DocumentChange, DocumentState, DocumentStore, EditOp, InspectorView, LeftTab,
  NarrowPane, SessionState, SettingsState, StoreAccess, ThemeChoice, Tool, Viewport,
} from "./stores";

export { emptyAnalysis, getAnalysis, provideAnalysis, subscribeAnalysis, useAnalysis } from "./analysis";
export type { AnalysisProvider } from "./analysis";

export {
  catalogBase, getCatalog, getCatalogStatus, loadCreationCode, loadFacetDetail, provideCatalogLoader,
  setCatalogStatus, startCatalog, subscribeCatalog, useCatalog, useCatalogStatus, useFacetDetail,
} from "./catalog";
export type { CatalogLoader, CatalogStatus, FacetDetailState } from "./catalog";

export { log, now, randomBytes } from "./kernel";

export {
  announce, chainService, closeDialog, createProject, hideBanner, isOnline, listDeployments, loadViewport,
  openDialog, openProblemDoc, openProject, provideServices, pushEscape, putDeployment, registerDropTarget,
  saveStatus, saveViewport, showBanner, startCatalogDrag, subscribeCatalogDrag, subscribeDeployments, toast,
  subscribeOnline, subscribeSaveStatus, useDeployments, useOnline, useRegion, useSaveStatus,
} from "./services";
export type {
  AnnounceOptions, BannerProps, CatalogDrag, ConnectionService, DeploymentsService, DndService, DropTarget,
  EscapeHandler, NewProjectOptions, ProjectsService, RegionProps, SaveStatus, Services, ToastInput,
} from "./services";

export type {
  AccountKind, ChainInfo, ChainReadiness, ChainService, ProbeOptions, WalletAccount, WalletConnector,
} from "./chain";

export { deployController, deployState, provideDeployController, subscribeDeployState, useDeployState } from "./deploy";
export type { DeployController, DeployPhase, DeployState } from "./deploy";

export {
  command, commandContext, commandState, defineCommands, getCommand, isPlaceholder, listBindings, listCommands,
  listPaletteRows, onCommandRun, runCommand, subscribeCommands, useCommandState,
} from "./commands";
export { commandRef } from "./command-args";
export type { CommandArgsMap, CommandArgsOf, Direction, SheetPoint } from "./command-args";
export type {
  Command, CommandArgs, CommandCategory, CommandConsole, CommandContext, CommandSource, Enablement,
  PaletteRow, ResolvedBinding,
} from "./commands";

export { bindingId, KEY_CONTEXT_ATTRIBUTE, KEY_CONTEXTS } from "./keys";
export type { BindingId, KeyBinding, KeyContext, KeySpec } from "./keys";

export { REGION_IDS, REGION_LABELS } from "./regions";
export type { RegionId } from "./regions";

export { DIALOG_IDS, dialogComponent, registerDialog } from "./dialogs";
export type {
  DialogComponentProps, DialogEntry, DialogId, DialogProps, DialogPropsMap, SettingsGroup,
} from "./dialogs";

export {
  provideSheetInteractions, registerEdgeType, registerNodeType, registerSheetLayer, sheetEdgeTypes,
  sheetLayers, sheetNodeTypes, useSheetInteractions,
} from "./sheet";
export type { SheetInteractionProps, SheetLayer } from "./sheet";

export { inspectorViewComponent, registerInspectorView } from "./inspector";
export type { InspectorViewKind, InspectorViewProps } from "./inspector";

export { env } from "./env";
export { applyMotion, applyTheme, resolveMotion, resolveTheme, syncTheme } from "./theme";
export { layoutMetrics } from "./layout-metrics";
