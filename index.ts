import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { runSuiteWithStagehand } from "./src/runner.js";
import type { Suite } from "./src/types.js";
import { CacheManager, type CacheMode } from "./src/utils/cache.js";

function getArg(name: string): string | undefined {
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
    if (arg === `--${name}` && i + 1 < process.argv.length) return process.argv[i + 1];
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const defaultSuitePath = "flows/create-folder.suite.json";
  const suitePathArg = getArg("suite") ?? defaultSuitePath;
  const suitePath = path.resolve(suitePathArg);

  if (!fs.existsSync(suitePath)) {
    throw new Error(`Suite file not found: ${suitePath}`);
  }

  const suite: Suite = JSON.parse(fs.readFileSync(suitePath, "utf-8"));
  const cfg = suite.suite.config ?? {};

  // Initialize cache manager (defaults to recording on normal runs)
  const cacheModeArg = (getArg("cache-mode") as CacheMode | undefined);
  const cacheDirArg = getArg("cache-dir");
  const cacheTtlArg = getArg("cache-ttl");
  const cacheStrictFlag = hasFlag("cache-strict");
  const cacheVerboseFlag = hasFlag("cache-verbose");
  const cacheClearFlag = hasFlag("cache-clear");
  const cacheInfoFlag = hasFlag("cache-info");

  const enableViaCli =
    !!cacheModeArg ||
    !!cacheDirArg ||
    !!cacheTtlArg ||
    cacheStrictFlag ||
    cacheVerboseFlag ||
    cacheClearFlag ||
    cacheInfoFlag;

  const cacheEnabled = (cfg.cache?.enabled ?? true) || enableViaCli;

  let cache: CacheManager | undefined;
  if (cacheEnabled) {
    const cacheMode: CacheMode = cacheModeArg ?? (cfg.cache?.mode as CacheMode) ?? "record";
    const cacheDir = cacheDirArg ?? cfg.cache?.dir ?? ".flowcheck-cache";
    const cacheTtlMs = cacheTtlArg ? Number(cacheTtlArg) : cfg.cache?.ttlMs;
    const cacheStrict = cacheStrictFlag || (cfg.cache?.strict ?? false);
    const cacheVerbose = cacheVerboseFlag || (cfg.cache?.verbose ?? false);

    cache = new CacheManager({
      dir: cacheDir,
      mode: cacheMode,
      ttlMs: cacheTtlMs,
      strict: cacheStrict,
      verbose: cacheVerbose,
    });

    if (cacheClearFlag) {
      console.log("[cache] clearing cache directory:", cacheDir);
      cache.clear();
    }
    if (cacheInfoFlag) {
      const info = cache.info();
      console.log("[cache] info:", info);
    }
  }

  const stagehand = new Stagehand({
    env: cfg.env ?? "LOCAL",
    modelName: cfg.model?.modelName ?? undefined,
    verbose: cfg.model?.verbose ?? 1,
    localBrowserLaunchOptions: {
      headless: false,
      devtools: false,
      viewport: cfg.viewport ?? { width: 1280, height: 720 },
      executablePath: puppeteer.executablePath(),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-web-security",
        "--allow-running-insecure-content",
      ],
      env: {
        NODE_ENV: "development",
        DEBUG: "true",
      },
    },
  });

  await stagehand.init();

  console.log(`Stagehand Session Started`);
  if ((stagehand as any).browserbaseSessionID) {
    console.log(`Watch live: https://browserbase.com/sessions/${(stagehand as any).browserbaseSessionID}`);
  }

  const result = await runSuiteWithStagehand(stagehand, suite, { cache });

  await stagehand.close();

  if (!result.passed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
