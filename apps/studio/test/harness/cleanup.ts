/**
 * Disposers the harness runs after each test (`setup.ts`), so a fake installed in one test never leaks into
 * the next. Outside Vitest (under `bun test`), call the fake's own `restore()` instead.
 */
const pending: (() => void | Promise<void>)[] = [];

export function onCleanup(dispose: () => void | Promise<void>): void {
  pending.push(dispose);
}

export async function runCleanups(): Promise<void> {
  // Last installed, first restored, so nested provides unwind in order.
  while (pending.length) await pending.pop()?.();
}
