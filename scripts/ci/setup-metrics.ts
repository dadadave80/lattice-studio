import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Environment = Readonly<Record<string, string | undefined>>;

function seconds(value: string | undefined): number | null {
  if (value === undefined || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function setupTimings(env: Environment, now: number): { total: number | null; frozenInstall: number | null; apt: number | null; browserDownload: number | null } {
  const started = seconds(env.SETUP_STARTED_MS);
  return {
    total: started !== null && now >= started ? (now - started) / 1000 : null,
    frozenInstall: seconds(env.SETUP_INSTALL_SECONDS),
    apt: seconds(env.SETUP_APT_SECONDS),
    browserDownload: seconds(env.SETUP_BROWSER_SECONDS),
  };
}

function command(args: string[]): string | null {
  try {
    const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "ignore" });
    return result.exitCode === 0 ? result.stdout.toString().trim() : null;
  } catch { return null; }
}

function tool(name: string, version: string[]): { path: string | null; version: string | null } {
  return { path: Bun.which(name), version: command(version) };
}

if (import.meta.main) {
  const env = process.env;
  const release = existsSync("/etc/os-release") ? readFileSync("/etc/os-release", "utf8") : "";
  const field = (name: string) => new RegExp(`^${name}=["']?([^"'\\n]+)`, "m").exec(release)?.[1] ?? "unknown";
  const fonts = command(["dpkg-query", "-W", "-f=${db:Status-Abbrev} ${binary:Package}=${Version}\n", "fonts-*"]);
  const packageFile = join(process.cwd(), "node_modules", "@playwright", "test", "package.json");
  const playwright: unknown = existsSync(packageFile) ? JSON.parse(readFileSync(packageFile, "utf8")) : null;
  const version = typeof playwright === "object" && playwright !== null && "version" in playwright && typeof playwright.version === "string" ? playwright.version : null;
  const metrics = {
    schemaVersion: 1,
    seconds: setupTimings(env, Date.now()),
    outcomes: { frozenInstall: env.SETUP_INSTALL_OUTCOME ?? "skipped", apt: env.SETUP_APT_OUTCOME ?? "skipped", browserDownload: env.SETUP_BROWSER_OUTCOME ?? "skipped" },
    tools: {
      bun: tool("bun", ["bun", "--version"]),
      node: env.SETUP_NODE === "true" ? tool("node", ["node", "--version"]) : null,
      foundry: env.SETUP_FOUNDRY === "true" ? tool("forge", ["forge", "--version"]) : null,
    },
    os: `${field("ID")}-${field("VERSION_ID")}`,
    runnerImage: { os: env.ImageOS ?? null, version: env.ImageVersion ?? null },
    browsers: (env.SETUP_BROWSERS ?? "").split(/\s+/).filter(Boolean),
    playwright: { version, cacheKey: env.SETUP_CACHE_KEY ?? "", cacheOutcome: env.SETUP_CACHE_OUTCOME ?? "skipped", cacheHit: env.SETUP_BROWSERS && env.SETUP_CACHE_OUTCOME === "success" ? env.SETUP_CACHE_HIT === "true" : null },
    fontPackages: fonts?.split("\n").filter((line) => /^ii\s/.test(line)).map((line) => line.replace(/^ii\s+/, "")) ?? [],
  };
  const path = join(env.RUNNER_TEMP ?? process.cwd(), "studio-setup-metrics.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`setup · ${JSON.stringify(metrics)}`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `path=${path}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### Studio setup\n\nOS: ${metrics.os}; Bun: ${metrics.tools.bun.version}; Node: ${metrics.tools.node?.version ?? "not requested"}; Playwright: ${version ?? "not installed"}.\n\n| Stage | Seconds |\n| --- | ---: |\n| Total | ${metrics.seconds.total ?? "unavailable"} |\n| Frozen install | ${metrics.seconds.frozenInstall ?? "not run"} |\n| Playwright apt dependencies | ${metrics.seconds.apt ?? "not run"} |\n| Browser download/check | ${metrics.seconds.browserDownload ?? "not run"} |\n\nBrowser cache hit: ${metrics.playwright.cacheHit ?? "unavailable/not requested"}.\n`);
  }
}
