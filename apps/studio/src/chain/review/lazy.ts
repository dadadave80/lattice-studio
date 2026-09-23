/**
 * Everything S8b loads after first paint, as one chunk: the review, Remove facets and what the commands do. One
 * dynamic target keeps the bundler from splitting the entry's shared modules once per lazy piece (spec L822).
 */
export { DeployReview } from "./DeployReview";
export { RemoveFacetsDialog } from "./RemoveFacetsDialog";
export * from "./command-runs";
