type Primitive = string | number | boolean | null | undefined;

export type TemplateScope = {
  variables?: Record<string, any>;
  env?: Record<string, any>;
  data?: Record<string, any>;
  suite?: Record<string, any>;
  config?: Record<string, any>;
  [key: string]: any;
};

/**
 * Resolve a dot/bracket path from an object.
 * Supports: a.b.c, a[0].b,
 */
export function getByPath(obj: any, path: string): any {
  if (!path) return undefined;
  // Convert bracket to dot e.g., items[0] => items.0
  const norm = path.replace(/\[(\d+)\]/g, ".$1").replace(/^\./, "");
  const parts = norm.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Build a resolver scope for templates.
 * Precedence:
 *  - explicit top-level keys provided by caller
 *  - variables
 *  - data
 *  - env
 *  - suite
 *  - config
 */
export function buildScope(input: TemplateScope): Record<string, any> {
  return {
    ...input,
    variables: input.variables ?? {},
    data: input.data ?? {},
    env: input.env ?? process.env,
    suite: input.suite ?? {},
    config: input.config ?? {},
  };
}

/**
 * Replace {{path.to.value}} within a string using the provided scope.
 * If a token cannot be resolved, it is left as-is.
 */
export function templateString(str: string, scope: TemplateScope): string {
  if (typeof str !== "string") return str as any;
  const ctx = buildScope(scope);
  return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expr) => {
    const value = getByPath(ctx, expr.trim());
    if (value == null) return _match; // keep token if not found
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

/**
 * Deeply template any JSON-serializable structure (object/array/primitives).
 */
export function templateDeep<T = any>(value: T, scope: TemplateScope): T {
  if (value == null) return value;
  if (typeof value === "string") {
    return templateString(value, scope) as any as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => templateDeep(v, scope)) as any as T;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, any>;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = templateDeep(v, scope);
    }
    return out as any as T;
  }
  // number, boolean, etc.
  return value;
}

/**
 * Helper to template a map of variables for Stagehand act() substitutions.
 */
export function templateVariablesMap(
  vars: Record<string, Primitive> | undefined,
  scope: TemplateScope
): Record<string, Primitive> | undefined {
  if (!vars) return undefined;
  const out: Record<string, Primitive> = {};
  for (const [k, v] of Object.entries(vars)) {
    out[k] = typeof v === "string" ? (templateString(v, scope) as Primitive) : (v as Primitive);
  }
  return out;
}
