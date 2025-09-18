import fs from "fs";
import path from "path";
import crypto from "crypto";

export type CacheMode = "record" | "replay" | "hybrid";

export type CacheEntry =
  | {
      kind: "observe";
      url: string;
      result: any[]; // Stagehand observe results array
      createdAt: number;
      meta?: Record<string, any>;
    }
  | {
      kind: "extract";
      url: string;
      data: any; // Extracted schema data
      createdAt: number;
      meta?: Record<string, any>;
    };

export type CacheOptions = {
  dir?: string; // default .flowcheck-cache
  mode?: CacheMode; // default record
  ttlMs?: number; // optional TTL
  strict?: boolean; // if true during replay, fail when missing instead of falling back
  verbose?: boolean;
};

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function stableStringify(obj: any): string {
  const seen = new WeakSet();
  const stringify = (val: any): any => {
    if (val === null || typeof val !== "object") return val;
    if (seen.has(val)) return "[Circular]";
    seen.add(val);
    if (Array.isArray(val)) return val.map(stringify);
    const out: Record<string, any> = {};
    for (const key of Object.keys(val).sort()) {
      out[key] = stringify(val[key]);
    }
    return out;
  };
  return JSON.stringify(stringify(obj));
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export class CacheManager {
  private dir: string;
  private mode: CacheMode;
  private ttlMs?: number;
  private strict: boolean;
  private verbose: boolean;

  constructor(opts?: CacheOptions) {
    this.dir = path.resolve(opts?.dir ?? ".flowcheck-cache");
    this.mode = opts?.mode ?? "record";
    this.ttlMs = opts?.ttlMs;
    this.strict = opts?.strict ?? false;
    this.verbose = !!opts?.verbose;
    ensureDir(this.dir);
    ensureDir(path.join(this.dir, "observe"));
    ensureDir(path.join(this.dir, "extract"));
    this.writeMetadata();
  }

  getMode() {
    return this.mode;
  }
  isRecord() {
    return this.mode === "record";
  }
  isReplay() {
    return this.mode === "replay";
  }
  isHybrid() {
    return this.mode === "hybrid";
  }
  isStrict() {
    return this.strict;
  }

  setMode(mode: CacheMode) {
    this.mode = mode;
    this.writeMetadata();
  }

  private metaPath() {
    return path.join(this.dir, "metadata.json");
  }

  private writeMetadata() {
    try {
      fs.writeFileSync(
        this.metaPath(),
        JSON.stringify(
          {
            mode: this.mode,
            ttlMs: this.ttlMs ?? null,
            strict: this.strict,
            updatedAt: Date.now(),
            version: 1,
          },
          null,
          2
        )
      );
    } catch {
      /* ignore */
    }
  }

  private entryPath(kind: CacheEntry["kind"], key: string) {
    const subdir = path.join(this.dir, kind);
    ensureDir(subdir);
    return path.join(subdir, `${key}.json`);
  }

  computeKey(kind: CacheEntry["kind"], payload: Record<string, unknown>): string {
    // Include kind to avoid collisions across kinds
    const s = stableStringify({ kind, payloadVersion: 1, payload });
    return sha256(s);
  }

  private withinTTL(createdAt: number) {
    if (!this.ttlMs) return true;
    return Date.now() - createdAt <= this.ttlMs;
  }

  get(kind: "observe", key: string): Extract<CacheEntry, { kind: "observe" }> | undefined;
  get(kind: "extract", key: string): Extract<CacheEntry, { kind: "extract" }> | undefined;
  get(kind: CacheEntry["kind"], key: string): CacheEntry | undefined {
    try {
      const p = this.entryPath(kind, key);
      if (!fs.existsSync(p)) return undefined;
      const raw = fs.readFileSync(p, "utf-8");
      const parsed: CacheEntry = JSON.parse(raw);
      if (!this.withinTTL(parsed.createdAt)) {
        if (this.verbose) console.log(`[cache] expired ${kind}:${key}`);
        return undefined;
      }
      if (this.verbose) console.log(`[cache] hit ${kind}:${key}`);
      return parsed;
    } catch (e) {
      if (this.verbose) console.warn("[cache] read error:", e);
      return undefined;
    }
  }

  set(
    kind: "observe",
    key: string,
    value: { url: string; result: any[]; meta?: Record<string, any> }
  ): void;
  set(
    kind: "extract",
    key: string,
    value: { url: string; data: any; meta?: Record<string, any> }
  ): void;
  set(kind: CacheEntry["kind"], key: string, value: any): void {
    try {
      const p = this.entryPath(kind, key);
      const entry: CacheEntry =
        kind === "observe"
          ? { kind, createdAt: Date.now(), url: value.url, result: value.result, meta: value.meta }
          : { kind, createdAt: Date.now(), url: value.url, data: value.data, meta: value.meta };
      fs.writeFileSync(p, JSON.stringify(entry, null, 2));
      if (this.verbose) console.log(`[cache] write ${kind}:${key}`);
    } catch (e) {
      if (this.verbose) console.warn("[cache] write error:", e);
    }
  }

  clear(): void {
    try {
      if (fs.existsSync(this.dir)) {
        fs.rmSync(this.dir, { recursive: true, force: true });
      }
      ensureDir(this.dir);
      ensureDir(path.join(this.dir, "observe"));
      ensureDir(path.join(this.dir, "extract"));
      this.writeMetadata();
    } catch {
      /* ignore */
    }
  }

  info(): { entries: { observe: number; extract: number }; dir: string; mode: CacheMode } {
    const count = (sub: string) => {
      try {
        const d = path.join(this.dir, sub);
        if (!fs.existsSync(d)) return 0;
        return fs.readdirSync(d).filter((f) => f.endsWith(".json")).length;
      } catch {
        return 0;
      }
    };
    return {
      entries: { observe: count("observe"), extract: count("extract") },
      dir: this.dir,
      mode: this.mode,
    };
  }
}

// Helpers to build keys consistently for the runner:

export function buildObserveKey(
  cache: CacheManager,
  args: {
    instruction: string;
    options?: any;
    url: string;
    suite?: string;
    flow?: string;
    viewport?: { width: number; height: number };
  }
) {
  const payload = {
    instruction: args.instruction,
    // only include stable, small options that affect inference
    options: args.options
      ? {
          returnAction: !!args.options.returnAction,
          iframes: !!args.options.iframes,
          domSettleTimeoutMs:
            Number.isFinite(args.options.domSettleTimeoutMs) ? args.options.domSettleTimeoutMs : undefined,
          modelName: args.options.modelName ?? undefined,
        }
      : { returnAction: true },
    url: args.url,
    suite: args.suite ?? undefined,
    flow: args.flow ?? undefined,
    viewport: args.viewport ?? undefined,
  };
  return cache.computeKey("observe", payload);
}

export function buildExtractKey(
  cache: CacheManager,
  args: {
    instruction: string;
    schema: any;
    options?: any;
    url: string;
    suite?: string;
    flow?: string;
    viewport?: { width: number; height: number };
  }
) {
  const payload = {
    instruction: args.instruction,
    schema: args.schema, // schema influences inference; keep as-is
    options: args.options
      ? {
          selector: args.options.selector ?? undefined,
          iframes: !!args.options.iframes,
          domSettleTimeoutMs:
            Number.isFinite(args.options.domSettleTimeoutMs) ? args.options.domSettleTimeoutMs : undefined,
          modelName: args.options.modelName ?? undefined,
        }
      : undefined,
    url: args.url,
    suite: args.suite ?? undefined,
    flow: args.flow ?? undefined,
    viewport: args.viewport ?? undefined,
  };
  return cache.computeKey("extract", payload);
}
