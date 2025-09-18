import type { z } from "zod";

/**
 * High-level config for the suite and runner
 */
export type SuiteConfig = {
  baseUrl?: string;
  env?: "LOCAL" | "BROWSERBASE";
  viewport?: { width: number; height: number };
  timeouts?: { step?: number; navigation?: number };
  retries?: { step?: number; flow?: number; backoffMs?: number };
  continueOnFailure?: boolean;
  screenshotOnFailure?: boolean;
  htmlOnFailure?: boolean;
  video?: boolean;
  parallel?: number;
  reporter?: { type: "console" | "json" | "junit" | "html"; outputDir?: string };
  model?: {
    modelName?: string;
    iframes?: boolean;
    domSettleTimeoutMs?: number;
    verbose?: 0 | 1 | 2;
  };
  cache?: {
    enabled?: boolean;
    mode?: "record" | "replay" | "hybrid";
    dir?: string;
    ttlMs?: number;
    strict?: boolean;
    verbose?: boolean;
    selfHeal?: boolean;
  };
};

/**
 * Minimal JSON-style schema we compile to Zod for Stagehand extract()
 */
export type ExtractSchema =
  | { type: "string"; description?: string }
  | { type: "number"; description?: string }
  | { type: "boolean"; description?: string }
  | { type: "array"; items: ExtractSchema; description?: string }
  | {
      type: "object";
      properties: Record<string, ExtractSchema>;
      required?: string[];
      description?: string;
    };

/**
 * Assertions supported by the framework (extend as needed)
 */
export type ExpectText = {
  expectText: {
    selector: string;
    includes?: string;
    equals?: string;
    regex?: string;
    timeoutMs?: number;
  };
};

export type ExpectVisible = {
  expectVisible: {
    selector: string;
    visible?: boolean; // default true
    timeoutMs?: number;
  };
};

export type ExpectEnabled = {
  expectEnabled: {
    selector: string;
    enabled?: boolean; // default true
    timeoutMs?: number;
  };
};

export type ExpectUrl = {
  expectUrl: {
    equals?: string;
    includes?: string;
    regex?: string;
    timeoutMs?: number;
  };
};

export type ExpectTitle = {
  expectTitle: {
    equals?: string;
    includes?: string;
    regex?: string;
    timeoutMs?: number;
  };
};

export type ExpectVar = {
  expectVar: {
    path: string; // dot path in variables map
    equals?: any;
    includes?: string;
    regex?: string;
    type?: "string" | "number" | "boolean" | "object" | "array";
  };
};

export type ExpectExtract = {
  expectExtract: {
    from: string; // extract id
    field: string;
    equals?: any;
    includes?: string;
    regex?: string;
  };
};

export type ExpectCount = {
  expectCount: {
    selector: string;
    equals?: number;
    min?: number;
    max?: number;
    timeoutMs?: number;
  };
};

export type CustomAssert = {
  custom: {
    js: string; // returns boolean; executed in Node with {page, variables} in scope (sandbox-ish)
    message?: string;
    timeoutMs?: number;
  };
};

export type Assertion =
  | ExpectText
  | ExpectVisible
  | ExpectEnabled
  | ExpectUrl
  | ExpectTitle
  | ExpectVar
  | ExpectExtract
  | ExpectCount
  | CustomAssert;

/**
 * Step union types
 */
export type StepNavigate = { navigate: { url: string } };
export type StepWait = { wait: { ms: number } };
export type StepWaitFor = {
  waitFor: {
    selector?: string;
    state?: "attached" | "visible" | "hidden" | "detached";
    timeoutMs?: number;
  };
};
export type StepWaitForNavigation = {
  waitForNavigation: { urlPattern?: string; timeoutMs?: number };
};

export type StepSetVar = {
  setVar: { name: string; value?: any; from?: "js"; code?: string };
};

export type StepIf = {
  if: {
    when: { selector?: string; exists?: boolean; varPath?: string; equals?: any };
    then: Step[];
    else?: Step[];
  };
};

export type StepLoop = {
  loop: { forEach: string; body: Step[] }; // dot-path to array variable
};

export type StepInclude = {
  include: { fixture: string; with?: Record<string, any> };
};

// Stagehand AI
export type StepObserve = {
  observe: {
    id?: string; // variables[id] = result
    instruction: string;
    options?: {
      returnAction?: boolean;
      iframes?: boolean;
      domSettleTimeoutMs?: number;
      modelName?: string;
    };
    pick?: {
      byIndex?: number;
      byTextIncludes?: string;
      byRole?: string;
    };
    actOnPick?: boolean;
  };
};

export type StepAct = {
  act: {
    action: string;
    variables?: Record<string, any>;
    options?: {
      iframes?: boolean;
      domSettleTimeoutMs?: number;
      modelName?: string;
      timeoutMs?: number;
    };
  };
};

export type StepExtract = {
  extract: {
    id?: string;
    instruction: string;
    schema: ExtractSchema;
    options?: {
      selector?: string;
      iframes?: boolean;
      domSettleTimeoutMs?: number;
      modelName?: string;
    };
    validate?: Assertion[];
  };
};

// Deterministic helpers (Playwright-like)
export type StepFill = { fill: { selector: string; value: string } };
export type StepClick = {
  click: { selector: string; button?: "left" | "right" | "middle"; clickCount?: number };
};
export type StepPress = { press: { selector?: string; key: string } };
export type StepCheck = { check: { selector: string } };
export type StepUncheck = { uncheck: { selector: string } };
export type StepHover = { hover: { selector: string } };
export type StepFocus = { focus: { selector: string } };

export type StepUpload = {
  upload: {
    selector?: string;
    files: string[];
    beforeAction?: string; // optional AI instruction to open the file picker area first
    timeoutMs?: number; // optional max time to wait for a file input to appear
  };
};

// Assertion step
export type StepAssert = { assert: Assertion };

// Agent step (optional)
export type StepAgent = { agent: { instruction: string; maxSteps?: number; autoScreenshot?: boolean } };

export type Step =
  | StepNavigate
  | StepWait
  | StepWaitFor
  | StepWaitForNavigation
  | StepSetVar
  | StepIf
  | StepLoop
  | StepInclude
  | StepObserve
  | StepAct
  | StepExtract
  | StepFill
  | StepClick
  | StepPress
  | StepCheck
  | StepUncheck
  | StepHover
  | StepFocus
  | StepUpload
  | StepAssert
  | StepAgent;

export type Flow = {
  name: string;
  description?: string;
  dataset?: Record<string, any>[]; // data-driven runs
  steps: Step[];
  retries?: number;
  tags?: string[];
  bail?: boolean;
};

export type Suite = {
  suite: {
    name: string;
    config?: SuiteConfig;
    variables?: Record<string, any>;
    env?: Record<string, string>;
    fixtures?: { [name: string]: Flow };
    beforeAll?: Step[];
    beforeEach?: Step[];
    afterEach?: Step[];
    afterAll?: Step[];
    flows: Flow[];
  };
};

// Runtime context
export type RunContext = {
  stagehand: any;
  context: any; // BrowserContext
  page: any; // Stagehand Page
  variables: Record<string, any>;
  suiteConfig: SuiteConfig;
  reporter: Reporter;
  artifactsDir: string;
  cache?: any;
  currentFlowName?: string;
};

/**
 * Minimal reporter interface
 */
export type Reporter = {
  onSuiteStart(name: string): void;
  onSuiteEnd(): void;
  onFlowStart(name: string): void;
  onFlowEnd(name: string, result: { passed: boolean; durationMs: number }): void;
  onStepStart(index: number, step: Step): void;
  onStepEnd(index: number, step: Step, result: { passed: boolean; durationMs: number; error?: string }): void;
  log(message: string): void;
};
