# Flowcheck

AI-assisted browser flow runner built on Stagehand.

What's included:
- JSON-defined suites, flows, fixtures, hooks
- Stagehand-powered steps: observe, act, extract, agent
- Deterministic helpers: navigate, click, fill, wait, upload, assertions
- Artifacts: screenshots and HTML on failure
- New: Stagehand-style caching for observe and extract steps

Caching overview
- Goal: minimize LLM calls by caching expensive steps while retaining reliability.
- What is cached:
  - observe results: the array of actionable Playwright-like actions returned by Stagehand observe (action previews).
  - extract results: the structured data returned by Stagehand extract.
- What is not cached:
  - Deterministic helpers (click/fill/press/hover/etc.) and assertions.
- Where it stores:
  - .flowcheck-cache/observe/*.json and .flowcheck-cache/extract/*.json
  - .flowcheck-cache is already gitignored

Quick start
- Record cache while developing (default mode):
  pnpm start -- --suite flows/create-folder.suite.json

- Replay only (CI/CD):
  pnpm start -- --suite flows/create-folder.suite.json --cache-mode=replay --cache-strict
  or
  pnpm replay -- --suite flows/create-folder.suite.json

- Hybrid (prefer cache, fall back to live and write cache):
  pnpm start -- --suite flows/create-folder.suite.json --cache-mode=hybrid

CLI flags
- --cache-mode=record|replay|hybrid
  - record: always run live and write cache
  - replay: use cache only; if --cache-strict and missing, fail
  - hybrid: try cache; if missing, run live and write cache
- --cache-dir=PATH
  - default .flowcheck-cache
- --cache-ttl=MS
  - time-to-live; expired cache is ignored
- --cache-strict
  - in replay mode, fail on cache miss
- --cache-verbose
  - logs cache hits/misses/reads/writes
- --cache-clear
  - clears cache directory before the run
- --cache-info
  - prints cache stats

Convenience scripts
- Record (default when no cache flags provided):
  pnpm start -- --suite flows/create-folder.suite.json
- Replay strict:
  pnpm replay -- --suite flows/create-folder.suite.json
- Cache maintenance:
  pnpm cache:info
  pnpm cache:clear

How it works
- Keying: Cache keys incorporate step instruction, stable options, current URL, suite/flow identity, and viewport.
- observe step flow:
  - replay/hybrid: lookup key -> if found, reuse results (zero extra LLM). If strict replay and miss -> error.
  - record/hybrid miss: call page.observe(), persist result, proceed.
  - actOnPick uses the cached or fresh result directly with page.act().
- extract step flow:
  - replay/hybrid: lookup -> if found, reuse data. If strict replay and miss -> error.
  - record/hybrid miss: call page.extract(), persist data, proceed.
- Non-strict replay fallback:
  - If replay is not strict and a miss occurs, we automatically run live once.

Suite-level configuration (optional)
You can set defaults inside your suite JSON under suite.config.cache. CLI flags override these.

Example:
{
  "suite": {
    "name": "My Suite",
    "config": {
      "cache": {
        "enabled": true,
        "mode": "record",             // "record" | "replay" | "hybrid"
        "dir": ".flowcheck-cache",
        "ttlMs": 86400000,            // 1 day
        "strict": false,
        "verbose": false
      }
    },
    "flows": [...]
  }
}

CI/CD usage
- Step 1: Record cache locally or in a warm-up job. Example:
  pnpm start -- --suite flows/create-folder.suite.json --cache-mode=record --cache-verbose
  Persist .flowcheck-cache as a build artifact or in a shared cache layer.

- Step 2: Replay cache in CI. Example:
  pnpm start -- --suite flows/create-folder.suite.json --cache-mode=replay --cache-strict
  This keeps runs fast and deterministic, avoiding repeated LLM calls.

Notes and best practices
- Cache invalidation:
  - Change in step instruction, modelName, returnAction/iframes/domSettleTimeoutMs, URL, suite/flow name, or viewport will create a different key and thus not reuse stale cache.
  - Use --cache-ttl to limit reuse of old caches.
- Strict replay is ideal for CI to detect unexpected page changes or missing cache.
- Hybrid mode is convenient while iterating locally to build cache incrementally.

Development
- Build:
  pnpm build
- Run with default recording:
  pnpm start -- --suite flows/create-folder.suite.json
- Replay:
  pnpm replay -- --suite flows/create-folder.suite.json
- Show cache info:
  pnpm cache:info
- Clear cache:
  pnpm cache:clear

Implementation details
- Code:
  - src/utils/cache.ts: file-based CacheManager and key builders
  - src/runner.ts: caching integrated for observe and extract steps
  - index.ts: CLI flags parsed and CacheManager initialized, passed into runner
  - src/types.ts: SuiteConfig.cache and RunContext.cache fields
- Artifacts on failure:
  - artifacts/YYYYMMDD-HHMMSS/... with screenshots and HTML page dumps

License
See LICENSE file.
