/**
 * Where the last press on a card was, noted in the first load (it's tiny), so a drag anchors where the card was
 * grabbed even when it's the first gesture and the interactions runtime is still loading.
 */
export type Press = { facet: string; client: { x: number; y: number } };

let last: Press | null = null;

/** Notes a press on a card, or forgets the last one (`null`: a press elsewhere). */
export function notePress(press: Press | null): void {
  last = press;
}

/** The press on `facet` a drag starts from, once: null when the last press was elsewhere. */
export function takePress(facet: string): Press | null {
  const press = last?.facet === facet ? last : null;
  last = null;
  return press;
}
