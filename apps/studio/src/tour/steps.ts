/**
 * The tour's five coach marks (spec L400, Flow 1): "catalog, placing a facet, a collision note, the
 * console, Deploy". Each targets a `[data-tour="<id>"]` element elsewhere in the app; `Tour.tsx` falls back
 * to a centered card when that module hasn't added the attribute yet.
 */
export type TourStepId = "catalog" | "place-facet" | "collision" | "console" | "deploy";

export type TourStep = {
  id: TourStepId;
  title: string;
  text: string;
};

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "catalog",
    title: "The catalog",
    text: "Drag a facet from here onto the sheet, or search by name.",
  },
  {
    id: "place-facet",
    title: "Placing a facet",
    text: "Drop it anywhere on the sheet. It lands selected, and the checks run right away.",
  },
  {
    id: "collision",
    title: "A collision note",
    text: "When two facets claim the same selector, a note on the sheet marks it and the console explains the fix.",
  },
  {
    id: "console",
    title: "The console",
    text: "Every edit narrates here in plain sentences, so nothing you do is a silent no-op.",
  },
  {
    id: "deploy",
    title: "Deploy",
    text: "Once the checks are clear, this sends the diamond to a wallet or a Safe.",
  },
];
