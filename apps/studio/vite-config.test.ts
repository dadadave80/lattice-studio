import { describe, expect, test } from "bun:test";
import { e2eGuard } from "./vite.config.ts";

describe("e2eGuard", () => {
  test("a production build with the flag fails", () => {
    expect(() => e2eGuard("production", "build", "1")).toThrow("build with --mode e2e");
  });

  test("any other build mode with the flag fails, whatever its value", () => {
    expect(() => e2eGuard("staging", "build", "1")).toThrow('this one\'s mode is "staging"');
    expect(() => e2eGuard("production", "build", "true")).toThrow("VITE_STUDIO_E2E is set");
    expect(() => e2eGuard("development", "build", "0")).toThrow("VITE_STUDIO_E2E is set");
  });

  test("an e2e build with the flag passes", () => {
    expect(() => e2eGuard("e2e", "build", "1")).not.toThrow();
    expect(() => e2eGuard("e2e", "build", "true")).not.toThrow();
  });

  test("serving with the flag passes (dev server, Vitest)", () => {
    expect(() => e2eGuard("development", "serve", "1")).not.toThrow();
    expect(() => e2eGuard("test", "serve", "true")).not.toThrow();
  });

  test("builds without the flag pass", () => {
    expect(() => e2eGuard("production", "build", undefined)).not.toThrow();
    expect(() => e2eGuard("production", "build", "")).not.toThrow();
  });
});
