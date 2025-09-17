import fs from "fs";
import path from "path";
import { buildZodFromExtractSchema } from "./schema.js";
import {
  buildScope,
  getByPath,
  templateDeep,
  templateString,
  templateVariablesMap,
} from "./utils/templating.js";
import { trySetInputFiles, ensureFilesExist, resolveFiles } from "./utils/upload.js";
import { ConsoleReporter } from "./reporter/console.js";
import { runAssertion } from "./assertions.js";
import type {
  Suite,
  Flow,
  Step,
  RunContext,
  Reporter,
  SuiteConfig,
  Assertion,
} from "./types.js";

/**
 * Reporter factory (extendable)
 */
function createReporter(config?: SuiteConfig): Reporter {
  // TODO: add JSON/JUnit/HTML reporters
  return new ConsoleReporter();
}

function nowISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const HH = pad(d.getHours());
  const MM = pad(d.getMinutes());
  const SS = pad(d.getSeconds());
  return `${yyyy}${mm}${dd}-${HH}${MM}${SS}`;
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

async function captureArtifacts(ctx: RunContext, flowName: string, stepIndex: number) {
  try {
    const base = path.join(ctx.artifactsDir, sanitize(flowName), `step-${String(stepIndex).padStart(3, "0")}`);
    ensureDir(base);
    const screenshotPath = path.join(base, "screenshot.png");
    const htmlPath = path.join(base, "page.html");
    if (ctx.suiteConfig.screenshotOnFailure) {
      await ctx.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    }
    if (ctx.suiteConfig.htmlOnFailure) {
      const html = await ctx.page.content().catch(() => "<!-- failed to get content -->");
      fs.writeFileSync(htmlPath, html ?? "");
    }
  } catch {
    // ignore artifact errors
  }
}

function sanitize(name: string) {
  return name.replace(/[^a-z0-9._-]/gi, "_");
}

async function withRetries<T>(
  fn: () => Promise<T>,
  retries: number,
  backoffMs: number
): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastErr;
}

/**
 * Execute a single Step with templating and retries
 */
async function executeStep(step: Step, ctx: RunContext, suite: Suite, dataRow?: Record<string, any>) {
  const stepRetries = ctx.suiteConfig.retries?.step ?? 0;
  const backoffMs = ctx.suiteConfig.retries?.backoffMs ?? 1000;

  const flowName = ctx.currentFlowName ?? "Flow";
  await withRetries(
    async () => {
      const start = Date.now();
      ctx.reporter.onStepStart(stepIndexCounter.current, step);

      // Template the step deeply with current scope
      const scope = {
        variables: ctx.variables,
        data: dataRow,
        env: { ...process.env, ...(suite.suite.env ?? {}) },
        suite: suite.suite.variables ?? {},
        config: ctx.suiteConfig,
        baseUrl: ctx.suiteConfig.baseUrl, // convenience
      };
      const resolvedStep: any = templateDeep(step as any, scope);

      try {
        await handleStep(resolvedStep, ctx, suite, dataRow);
        const dur = Date.now() - start;
        ctx.reporter.onStepEnd(stepIndexCounter.current, step, { passed: true, durationMs: dur });
      } catch (e: any) {
        const dur = Date.now() - start;
        ctx.reporter.onStepEnd(stepIndexCounter.current, step, { passed: false, durationMs: dur, error: String(e?.message ?? e) });
        if (ctx.suiteConfig.screenshotOnFailure || ctx.suiteConfig.htmlOnFailure) {
          await captureArtifacts(ctx, flowName, stepIndexCounter.current).catch(() => {});
        }
        throw e;
      }
    },
    stepRetries,
    backoffMs
  );
}

// global-ish step counter for reporter indexing in a flow run
const stepIndexCounter = { current: 0 };

async function handleStep(resolvedStep: Step, ctx: RunContext, suite: Suite, dataRow?: Record<string, any>) {
  const page = ctx.page;

  // Control steps
  if ("navigate" in resolvedStep) {
    const url = resolvedStep.navigate.url;
    await page.goto(url);
    return;
  }
  if ("wait" in resolvedStep) {
    await page.waitForTimeout(resolvedStep.wait.ms);
    return;
  }
  if ("waitFor" in resolvedStep) {
    const { selector, state = "visible", timeoutMs } = resolvedStep.waitFor;
    if (!selector) throw new Error("waitFor.selector is required");
    await page.locator(selector).first().waitFor({ state: state as any, timeout: timeoutMs });
    return;
  }
  if ("waitForNavigation" in resolvedStep) {
    const { urlPattern, timeoutMs } = resolvedStep.waitForNavigation;
    const pattern = urlPattern ? new RegExp(urlPattern) : null;
    const timeout = timeoutMs ?? ctx.suiteConfig.timeouts?.navigation ?? 45000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const url = page.url();
      if (!pattern || pattern.test(url)) return;
      await page.waitForTimeout(200);
    }
    throw new Error(`waitForNavigation timed out after ${timeout}ms`);
  }
  if ("setVar" in resolvedStep) {
    const { name, value, from, code } = resolvedStep.setVar;
    if (from === "js") {
      const fn = new Function("page", "variables", "data", code ?? "return undefined;");
      const result = await Promise.resolve(fn(page, ctx.variables, dataRow));
      ctx.variables[name] = result;
    } else {
      ctx.variables[name] = value;
    }
    return;
  }
  if ("if" in resolvedStep) {
    const { when, then, else: els } = resolvedStep.if;
    let cond = false;
    if (when.selector) {
      const count = await page.locator(when.selector).count();
      cond = when.exists ?? true ? count > 0 : count === 0;
    } else if (when.varPath) {
      const val = getByPath({ variables: ctx.variables }, `variables.${when.varPath}`);
      cond = when.equals !== undefined ? JSON.stringify(val) === JSON.stringify(when.equals) : !!val;
    }
    const branch = cond ? then : els ?? [];
    for (const s of branch) {
      stepIndexCounter.current += 1;
      await executeStep(s, ctx, suite, dataRow);
    }
    return;
  }
  if ("loop" in resolvedStep) {
    const arr = getByPath({ variables: ctx.variables, data: dataRow }, resolvedStep.loop.forEach) as any[];
    if (!Array.isArray(arr)) throw new Error(`loop.forEach did not resolve to an array: ${resolvedStep.loop.forEach}`);
    for (const item of arr) {
      const row = { ...(dataRow ?? {}), loopItem: item };
      for (const s of resolvedStep.loop.body) {
        stepIndexCounter.current += 1;
        await executeStep(s, ctx, suite, row);
      }
    }
    return;
  }
  if ("include" in resolvedStep) {
    const { fixture, with: overrides } = resolvedStep.include;
    const fx = suite.suite.fixtures?.[fixture];
    if (!fx) throw new Error(`Fixture not found: ${fixture}`);
    // Shadow variables during fixture execution if overrides provided
    const backup = { ...ctx.variables };
    Object.assign(ctx.variables, overrides ?? {});
    await runFlowInternal(fx, ctx, suite, dataRow);
    // Restore variables
    ctx.variables = backup;
    return;
  }

  // Stagehand AI steps
  if ("observe" in resolvedStep) {
    const { id, instruction, options, pick, actOnPick } = resolvedStep.observe;
    const obsInput = options
      ? { instruction, ...options }
      : { instruction, returnAction: true };
    const results = await page.observe(obsInput);
    ctx.variables._lastObserve = results;
    if (id) ctx.variables[id] = results;

    if (actOnPick) {
      let idx = pick?.byIndex ?? 0;
      if (pick?.byTextIncludes) {
        const found = (results as any[]).findIndex((r) => {
          const txt = JSON.stringify(r);
          return txt.includes(pick.byTextIncludes!);
        });
        if (found >= 0) idx = found;
      }
      if (!results || results.length === 0) throw new Error("observe returned no results to act on");
      await page.act(results[idx]);
    }

    return;
  }
  if ("act" in resolvedStep) {
    const { action, variables, options } = resolvedStep.act;
    const vars = templateVariablesMap(variables, {
      variables: ctx.variables,
      data: dataRow,
      env: { ...process.env, ...(suite.suite.env ?? {}) },
      suite: suite.suite.variables ?? {},
      config: ctx.suiteConfig,
      baseUrl: ctx.suiteConfig.baseUrl,
    });
    if (!options) {
      await page.act({ action, variables: vars });
    } else {
      await page.act({ action, variables: vars, ...options });
    }
    return;
  }
  if ("extract" in resolvedStep) {
    const { id, instruction, schema, options, validate } = resolvedStep.extract;
    const zodSchema = buildZodFromExtractSchema(schema);
    const data = await page.extract({
      instruction,
      schema: zodSchema,
      ...(options ?? {}),
    });
    ctx.variables._lastExtract = data;
    if (id) ctx.variables[id] = data;
    if (validate && validate.length) {
      for (const a of validate) {
        await runAssertion(a as Assertion, ctx);
      }
    }
    return;
  }

  // Deterministic helpers
  if ("fill" in resolvedStep) {
    const { selector, value } = resolvedStep.fill;
    await page.fill(selector, value);
    return;
  }
  if ("click" in resolvedStep) {
    const { selector, button = "left", clickCount } = resolvedStep.click;
    const loc = page.locator(selector).first();
    await loc.click({ button: button as any, clickCount });
    return;
  }
  if ("press" in resolvedStep) {
    const { selector, key } = resolvedStep.press;
    if (selector) {
      await page.locator(selector).first().press(key);
    } else {
      await page.keyboard.press(key);
    }
    return;
  }
  if ("check" in resolvedStep) {
    const { selector } = resolvedStep.check;
    await page.locator(selector).first().check();
    return;
  }
  if ("uncheck" in resolvedStep) {
    const { selector } = resolvedStep.uncheck;
    await page.locator(selector).first().uncheck();
    return;
  }
  if ("hover" in resolvedStep) {
    const { selector } = resolvedStep.hover;
    await page.locator(selector).first().hover();
    return;
  }
  if ("focus" in resolvedStep) {
    const { selector } = resolvedStep.focus;
    await page.locator(selector).first().focus();
    return;
  }
  if ("upload" in resolvedStep) {
    const { selector, files, beforeAction, timeoutMs } = resolvedStep.upload;
    const abs = resolveFiles(files);
    ensureFilesExist(abs);

    const maxWait = timeoutMs ?? (ctx.suiteConfig.timeouts?.step ?? 30000);
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      // 1) Attempt direct input[type=file] assignment (works even if hidden)
      const ok = await trySetInputFiles(page, selector, abs);
      if (ok) return;

      // 2) Try native FileChooser by triggering the UI action that opens it
      if (beforeAction) {
        const fcPromise = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
        try {
          await page.act({ action: beforeAction });
        } catch {
          // ignore pre-action failure and continue
        }
        const fileChooser = await fcPromise;
        if (fileChooser) {
          try {
            await fileChooser.setFiles(abs);
            return;
          } catch {
            // fall through and retry until timeout
          }
        }
      }

      // small backoff before retry
      await page.waitForTimeout(500);
    }

    throw new Error(
      `Could not find a file input or file chooser within ${maxWait}ms. Provide upload.selector or beforeAction. Tried files: ${abs.join(", ")}`
    );
  }

  // Assertions
  if ("assert" in resolvedStep) {
    await runAssertion(resolvedStep.assert, ctx);
    return;
  }

  // Agent
  if ("agent" in resolvedStep) {
    const agent = ctx.stagehand.agent({
      instructions: "You are a helpful assistant that can use a web browser.",
    });
    await agent.execute({
      instruction: resolvedStep.agent.instruction,
      maxSteps: resolvedStep.agent.maxSteps ?? 20,
      autoScreenshot: resolvedStep.agent.autoScreenshot ?? false,
    });
    return;
  }

  throw new Error(`Unsupported step type: ${Object.keys(resolvedStep)[0]}`);
}

async function runFlowInternal(flow: Flow, ctx: RunContext, suite: Suite, dataRow?: Record<string, any>) {
  // execute steps sequentially
  for (const step of flow.steps) {
    stepIndexCounter.current += 1;
    await executeStep(step, ctx, suite, dataRow);
  }
}

async function runFlow(flow: Flow, ctx: RunContext, suite: Suite): Promise<{ passed: boolean; durationMs: number }> {
  ctx.currentFlowName = flow.name;
  stepIndexCounter.current = 0;

  const start = Date.now();
  ctx.reporter.onFlowStart(flow.name);

  const flowRetries = flow.retries ?? (ctx.suiteConfig.retries?.flow ?? 0);
  const backoffMs = ctx.suiteConfig.retries?.backoffMs ?? 1000;

  try {
    await withRetries(
      async () => {
        if (flow.dataset && flow.dataset.length) {
          for (const row of flow.dataset) {
            await runFlowInternal(flow, ctx, suite, row);
          }
        } else {
          await runFlowInternal(flow, ctx, suite);
        }
      },
      flowRetries,
      backoffMs
    );
    const dur = Date.now() - start;
    ctx.reporter.onFlowEnd(flow.name, { passed: true, durationMs: dur });
    return { passed: true, durationMs: dur };
  } catch (e) {
    const dur = Date.now() - start;
    ctx.reporter.onFlowEnd(flow.name, { passed: false, durationMs: dur });
    if (flow.bail) {
      // rethrow to abort suite if desired (not used here; suite-level bail could be added)
    }
    return { passed: false, durationMs: dur };
  } finally {
    ctx.currentFlowName = undefined;
  }
}

/**
 * Run the whole suite using an existing Stagehand instance.
 * Index.ts should initialize Stagehand with desired env and browser options.
 */
export async function runSuiteWithStagehand(stagehand: any, suite: Suite): Promise<{ passed: boolean }> {
  const page = stagehand.page;
  const context = stagehand.context;

  const cfg: SuiteConfig = {
    timeouts: { step: 30000, navigation: 45000 },
    retries: { step: 0, flow: 0, backoffMs: 1000 },
    continueOnFailure: false,
    screenshotOnFailure: true,
    htmlOnFailure: true,
    ...(suite.suite.config ?? {}),
  };

  const reporter = createReporter(cfg);
  const artifactsDir = path.join(process.cwd(), "artifacts", nowISO());
  ensureDir(artifactsDir);

  const runCtx: RunContext = {
    stagehand,
    context,
    page,
    variables: { ...(suite.suite.variables ?? {}) },
    suiteConfig: cfg,
    reporter,
    artifactsDir,
  };

  reporter.onSuiteStart(suite.suite.name);

  // Hooks
  const hooks = {
    beforeAll: suite.suite.beforeAll ?? [],
    beforeEach: suite.suite.beforeEach ?? [],
    afterEach: suite.suite.afterEach ?? [],
    afterAll: suite.suite.afterAll ?? [],
  };

  // Execute beforeAll
  for (const s of hooks.beforeAll) {
    stepIndexCounter.current += 1;
    await executeStep(s, runCtx, suite);
  }

  let allPassed = true;
  for (const flow of suite.suite.flows) {
    // beforeEach
    for (const s of hooks.beforeEach) {
      stepIndexCounter.current += 1;
      await executeStep(s, runCtx, suite);
    }

    const result = await runFlow(flow, runCtx, suite);
    allPassed = allPassed && result.passed;

    // afterEach
    for (const s of hooks.afterEach) {
      stepIndexCounter.current += 1;
      await executeStep(s, runCtx, suite);
    }
  }

  // afterAll
  for (const s of hooks.afterAll) {
    stepIndexCounter.current += 1;
    await executeStep(s, runCtx, suite);
  }

  reporter.onSuiteEnd();

  return { passed: allPassed };
}
