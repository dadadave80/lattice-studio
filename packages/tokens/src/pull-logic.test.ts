import { describe, expect, test } from "bun:test";
import { pullTokens, type PullIo } from "./pull-logic.ts";

function fakeIo(options: {
  readonly source?: string;
  readonly vendored?: string;
}): { io: PullIo; written: { value: string | undefined } } {
  const written: { value: string | undefined } = { value: undefined };
  const io: PullIo = {
    sourceExists: () => options.source !== undefined,
    vendoredExists: () => options.vendored !== undefined || written.value !== undefined,
    readSource: async () => {
      if (options.source === undefined) throw new Error("no source");
      return options.source;
    },
    readVendored: async () => {
      if (written.value !== undefined) return written.value;
      if (options.vendored === undefined) throw new Error("no vendored copy");
      return options.vendored;
    },
    writeVendored: async (contents) => {
      written.value = contents;
    },
  };
  return { io, written };
}

const paths = { sourcePath: "/repo/.handoff/design/tokens.json", vendoredPath: "/repo/packages/tokens/tokens.json" };

describe("pullTokens", () => {
  test("skips (ok) when .handoff is absent, as in CI", async () => {
    const { io } = fakeIo({ vendored: "{}" });
    const result = await pullTokens(io, { check: false, ...paths });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("skipped");
  });

  test("--check skips (ok) when .handoff is absent", async () => {
    const { io } = fakeIo({ vendored: "{}" });
    const result = await pullTokens(io, { check: true, ...paths });
    expect(result.ok).toBe(true);
  });

  test("copies the source over the vendored copy", async () => {
    const { io, written } = fakeIo({ source: '{"v":2}', vendored: '{"v":1}' });
    const result = await pullTokens(io, { check: false, ...paths });
    expect(result.ok).toBe(true);
    expect(written.value).toBe('{"v":2}');
  });

  test("--check fails on drift", async () => {
    const { io } = fakeIo({ source: '{"v":2}', vendored: '{"v":1}' });
    const result = await pullTokens(io, { check: true, ...paths });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("drifted");
  });

  test("--check fails when there is no vendored copy yet", async () => {
    const { io } = fakeIo({ source: '{"v":2}' });
    const result = await pullTokens(io, { check: true, ...paths });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no vendored copy");
  });

  test("--check passes after a pull (no drift)", async () => {
    const { io } = fakeIo({ source: '{"v":2}', vendored: '{"v":2}' });
    const result = await pullTokens(io, { check: true, ...paths });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("pass");
  });
});
