import type { LinesApi } from "../model/api";
import { notImplemented } from "../model/wp";

/** One builder per console line (spec L703-L729, L410, L652). Each returns a draft; the caller stamps `at`. */
export const lines: LinesApi = {
  catalogLoaded: () => notImplemented("C10", "lines.catalogLoaded"),
  projectOpened: () => notImplemented("C10", "lines.projectOpened"),
  linkOpened: () => notImplemented("C10", "lines.linkOpened"),
  recipeLoaded: () => notImplemented("C10", "lines.recipeLoaded"),
  placed: () => notImplemented("C10", "lines.placed"),
  removed: () => notImplemented("C10", "lines.removed"),
  collision: () => notImplemented("C10", "lines.collision"),
  resolved: () => notImplemented("C10", "lines.resolved"),
  missing: () => notImplemented("C10", "lines.missing"),
  dependencyMet: () => notImplemented("C10", "lines.dependencyMet"),
  fieldSet: () => notImplemented("C10", "lines.fieldSet"),
  stepMoved: () => notImplemented("C10", "lines.stepMoved"),
  tidied: () => notImplemented("C10", "lines.tidied"),
  undid: () => notImplemented("C10", "lines.undid"),
  mechanismChanged: () => notImplemented("C10", "lines.mechanismChanged"),
  reviewOpened: () => notImplemented("C10", "lines.reviewOpened"),
  simulated: () => notImplemented("C10", "lines.simulated"),
  submitted: () => notImplemented("C10", "lines.submitted"),
  proposed: () => notImplemented("C10", "lines.proposed"),
  confirmed: () => notImplemented("C10", "lines.confirmed"),
  mismatch: () => notImplemented("C10", "lines.mismatch"),
  verified: () => notImplemented("C10", "lines.verified"),
  reverted: () => notImplemented("C10", "lines.reverted"),
  diverged: () => notImplemented("C10", "lines.diverged"),
  exported: () => notImplemented("C10", "lines.exported"),
};
