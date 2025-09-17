import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { runSuiteWithStagehand } from "./src/runner.js";
import type { Suite } from "./src/types.js";

function getArg(name: string): string | undefined {
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
    if (arg === `--${name}` && i + 1 < process.argv.length) return process.argv[i + 1];
  }
  return undefined;
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

  const result = await runSuiteWithStagehand(stagehand, suite);

  await stagehand.close();

  if (!result.passed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
