import type { Assertion, RunContext } from "./types.js";
import { getByPath } from "./utils/templating.js";

function toRegex(pattern: string): RegExp {
  // If user supplied like "/foo/i", try to parse flags
  const m = pattern.match(/^\/(.+)\/([a-z]*)$/i);
  if (m) return new RegExp(m[1], m[2]);
  return new RegExp(pattern);
}

async function expectEventually(
  fn: () => Promise<boolean>,
  timeoutMs = 30000,
  intervalMs = 250
): Promise<void> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const ok = await fn();
      if (ok) return;
    } catch {
      // ignore, retry
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Expectation not met within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function runAssertion(assertion: Assertion, ctx: RunContext): Promise<void> {
  const { page, variables } = ctx;

  if ("expectText" in assertion) {
    const a = assertion.expectText;
    const timeout = a.timeoutMs ?? ctx.suiteConfig.timeouts?.step ?? 30000;
    await expectEventually(async () => {
      const locator = page.locator(a.selector);
      const count = await locator.count();
      if (count === 0) return false;
      const text = await locator.first().innerText();
      if (a.equals != null) return text === a.equals;
      if (a.includes != null) return text.includes(a.includes);
      if (a.regex != null) return toRegex(a.regex).test(text);
      return true;
    }, timeout);
    return;
  }

  if ("expectVisible" in assertion) {
    const a = assertion.expectVisible;
    const visible = a.visible ?? true;
    const timeout = a.timeoutMs ?? ctx.suiteConfig.timeouts?.step ?? 30000;
    await expectEventually(async () => {
      const locator = page.locator(a.selector);
      const vis = await locator.first().isVisible();
      return vis === visible;
    }, timeout);
    return;
  }

  if ("expectEnabled" in assertion) {
    const a = assertion.expectEnabled;
    const enabled = a.enabled ?? true;
    const timeout = a.timeoutMs ?? ctx.suiteConfig.timeouts?.step ?? 30000;
    await expectEventually(async () => {
      const locator = page.locator(a.selector);
      const en = await locator.first().isEnabled();
      return en === enabled;
    }, timeout);
    return;
  }

  if ("expectUrl" in assertion) {
    const a = assertion.expectUrl;
    const timeout = a.timeoutMs ?? ctx.suiteConfig.timeouts?.step ?? 30000;
    await expectEventually(async () => {
      const url = page.url();
      if (a.equals != null) return url === a.equals;
      if (a.includes != null) return url.includes(a.includes);
      if (a.regex != null) return toRegex(a.regex).test(url);
      return true;
    }, timeout);
    return;
  }

  if ("expectTitle" in assertion) {
    const a = assertion.expectTitle;
    const timeout = a.timeoutMs ?? ctx.suiteConfig.timeouts?.step ?? 30000;
    await expectEventually(async () => {
      const title = await page.title();
      if (a.equals != null) return title === a.equals;
      if (a.includes != null) return title.includes(a.includes);
      if (a.regex != null) return toRegex(a.regex).test(title);
      return true;
    }, timeout);
    return;
  }

  if ("expectVar" in assertion) {
    const a = assertion.expectVar;
    const value = getByPath({ variables }, `variables.${a.path}`);
    if (a.type) {
      const t = Array.isArray(value) ? "array" : typeof value;
      if (t !== a.type) {
        throw new Error(`expectVar type mismatch at ${a.path}: expected ${a.type}, got ${t}`);
      }
    }
    if (a.equals !== undefined) {
      const pass = JSON.stringify(value) === JSON.stringify(a.equals);
      if (!pass) throw new Error(`expectVar equals failed at ${a.path}: ${JSON.stringify(value)} !== ${JSON.stringify(a.equals)}`);
    }
    if (a.includes !== undefined) {
      const s = String(value);
      if (!s.includes(a.includes)) throw new Error(`expectVar includes failed at ${a.path}: "${s}" does not include "${a.includes}"`);
    }
    if (a.regex !== undefined) {
      const s = String(value);
      if (!toRegex(a.regex).test(s)) throw new Error(`expectVar regex failed at ${a.path}: "${s}" does not match ${a.regex}`);
    }
    return;
  }

  if ("expectExtract" in assertion) {
    const a = assertion.expectExtract;
    const base = variables[a.from];
    if (!base) throw new Error(`expectExtract: extract id "${a.from}" not found in variables`);
    const val = base[a.field];
    if (a.equals !== undefined) {
      const pass = JSON.stringify(val) === JSON.stringify(a.equals);
      if (!pass) throw new Error(`expectExtract equals failed for ${a.from}.${a.field}: ${JSON.stringify(val)} !== ${JSON.stringify(a.equals)}`);
    }
    if (a.includes !== undefined) {
      const s = Array.isArray(val) ? JSON.stringify(val) : String(val);
      if (!s.includes(a.includes)) throw new Error(`expectExtract includes failed for ${a.from}.${a.field}: "${s}" does not include "${a.includes}"`);
    }
    if (a.regex !== undefined) {
      const s = String(val);
      if (!toRegex(a.regex).test(s)) throw new Error(`expectExtract regex failed for ${a.from}.${a.field}: "${s}" does not match ${a.regex}`);
    }
    return;
  }

  if ("expectCount" in assertion) {
    const a = assertion.expectCount;
    const timeout = a.timeoutMs ?? ctx.suiteConfig.timeouts?.step ?? 30000;
    await expectEventually(async () => {
      const count = await page.locator(a.selector).count();
      if (a.equals != null) return count === a.equals;
      if (a.min != null && a.max != null) return count >= a.min && count <= a.max;
      if (a.min != null) return count >= a.min;
      if (a.max != null) return count <= a.max;
      return count > 0;
    }, timeout);
    return;
  }

  if ("custom" in assertion) {
    const a = assertion.custom;
    const timeout = a.timeoutMs ?? ctx.suiteConfig.timeouts?.step ?? 30000;
    await expectEventually(async () => {
      const fn = new Function("page", "variables", `${a.js}`);
      const result = await Promise.resolve(fn(page, variables));
      return !!result;
    }, timeout).catch((e) => {
      const msg = a.message ? `${a.message} - ${String(e)}` : String(e);
      throw new Error(`custom assert failed: ${msg}`);
    });
    return;
  }

  throw new Error(`Unsupported assertion: ${JSON.stringify(assertion)}`);
}
