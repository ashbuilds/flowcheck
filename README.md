# Flowcheck

Flowcheck is a lightweight, JSON-driven end-to-end browser testing and data extraction framework built on Stagehand (by Browserbase). Define flows in plain JSON, then run them against a real browser using Stagehand’s AI-powered capabilities. Flowcheck blends deterministic browser actions with AI steps and adds a caching layer to make runs fast and CI-friendly.


### Features
- JSON-defined suites, flows, fixtures, and hooks
- Stagehand-powered AI steps: observe, act, extract, agent
- Deterministic helpers: navigate, click, fill, press, check/uncheck, hover, focus, upload, waits, assertions
- Artifacts on failure: screenshots and full HTML
- Built-in, file-based caching for observe and extract to dramatically reduce LLM calls

### Why Flowcheck
- Zero boilerplate: express flows in JSON, no TS/JS needed for basic cases
- Hybrid approach: deterministic Playwright-like actions plus AI where needed
- CI-ready: strict replay mode uses pre-recorded cache for reliable, fast runs

### Requirements
- Node.js 18+
- pnpm (recommended)
- .env for environment variables your flows use (see .env.example)

### Installation
- Install dependencies:
  ```bash
  pnpm install
  ```
- Prepare environment:
  ```bash
  cp .env.example .env
  # edit .env to include required values (e.g., credentials)
  ```

### Quick Start
- Run a suite and record cache by default:
  ```bash
  pnpm start -- --suite flows/create-folder.suite.json
  ```
- Replay strictly in CI (fails on cache miss):
  ```bash
  pnpm replay -- --suite flows/create-folder.suite.json
  ```
- Hybrid mode (prefer cache, write cache on miss):
  ```bash
  pnpm start -- --suite flows/create-folder.suite.json --cache-mode=hybrid
  ```

#### Commands (scripts and common invocations)
- pnpm build
  - Type-check and compile TypeScript
  - Example:
    ```bash
    pnpm build
    ```
- pnpm start
  - Run the test runner. Default mode is record (build cache as you go)
  - Example:
    ```bash
    pnpm start -- --suite flows/create-folder.suite.json
    ```
- pnpm replay
  - Convenience script for strict replay mode (use cache only, fail on miss)
  - Example:
    ```bash
    pnpm replay -- --suite flows/create-folder.suite.json
    ```
  - Equivalent to:
    ```bash
    pnpm start -- --suite flows/create-folder.suite.json --cache-mode=replay --cache-strict
    ```
- pnpm cache:info
  - Print cache statistics (entries, directory, mode)
  - Example:
    ```bash
    pnpm cache:info
    ```
- pnpm cache:clear
  - Clear cache directory and show info
  - Example:
    ```bash
    pnpm cache:clear
    ```
- Optional direct invocation (equivalent to pnpm start)
  - Use tsx directly if preferred:
    ```bash
    pnpm tsx index.ts -- --suite flows/create-folder.suite.json [flags...]
    ```

#### CLI Flags
- --suite=PATH
  - Path to suite JSON (default: flows/create-folder.suite.json)
- --cache-mode=record|replay|hybrid
  - record: always run live and write cache (default when not specified)
  - replay: use cache only; with --cache-strict, fail on cache miss
  - hybrid: try cache; if missing, run live and write cache
- --cache-dir=PATH
  - Cache directory (default: .flowcheck-cache)
- --cache-ttl=MS
  - TTL in milliseconds; expired cache entries are ignored
- --cache-strict
  - In replay mode, fail on cache miss (non-strict replay will fall back to live once)
- --cache-verbose
  - Verbose cache logs (hits, misses, read/write)
- --cache-clear
  - Clear the cache directory before the run
- --cache-info
  - Print cache statistics (entries, directory, mode)

#### Caching (Record / Replay / Hybrid)
- Goal: minimize LLM calls while preserving reliability.
- What is cached:
  - observe: the array of action previews returned by Stagehand’s observe (Playwright-like actions)
  - extract: structured data returned by Stagehand’s extract
- Not cached:
  - Deterministic helpers (click/fill/press/hover/etc.) and assertions
- Storage:
  - .flowcheck-cache/observe/*.json and .flowcheck-cache/extract/*.json
  - .flowcheck-cache is gitignored

### How It Works
- Keying strategy includes:
  - instruction, stable options (returnAction, iframes, domSettleTimeoutMs, modelName)
  - current page URL
  - suite and flow names
  - viewport
- observe step:
  - replay/hybrid: cache lookup, reuse if found (no extra LLM). In strict replay, cache miss = error
  - record/hybrid miss: call page.observe(), persist result, continue
  - actOnPick executes the cached or fresh action with page.act()
- extract step:
  - replay/hybrid: cache lookup, reuse if found; in strict replay, miss = error
  - record/hybrid miss: call page.extract(), persist data, continue
- Non-strict replay fallback:
  - If replay is not strict and a miss occurs, Flowcheck falls back to a live call once

### CI/CD Usage
- Step 1: Record cache (in a warm-up job or locally)
  ```bash
  pnpm start -- --suite flows/create-folder.suite.json --cache-mode=record --cache-verbose
  ```
  Persist .flowcheck-cache as a pipeline artifact or in a shared cache layer.
- Step 2: Replay strictly in CI
  ```bash
  pnpm replay -- --suite flows/create-folder.suite.json
  ```
  Benefits: faster, deterministic runs that avoid repeated LLM calls.

### Outputs (Artifacts and Cache)
- Artifacts on failures:
  - Screenshots and HTML snapshots in artifacts/YYYYMMDD-HHMMSS/...
- Cache:
  - AI step results in .flowcheck-cache (gitignored)
- Exit codes:
  - Non-zero if any flow fails (suitable for CI gating)

### Configuration (suite JSON)
- Configure suite defaults under suite.config. Example (including cache):
```json
{
  "suite": {
    "name": "My Suite",
    "config": {
      "baseUrl": "https://example.com",
      "viewport": { "width": 1280, "height": 720 },
      "timeouts": { "step": 30000, "navigation": 45000 },
      "retries": { "step": 1, "flow": 0, "backoffMs": 1500 },
      "screenshotOnFailure": true,
      "htmlOnFailure": true,
      "model": { "modelName": "gpt-4o-mini", "verbose": 1 },
      "cache": {
        "enabled": true,
        "mode": "record",
        "dir": ".flowcheck-cache",
        "ttlMs": 86400000,
        "strict": false,
        "verbose": false
      }
    },
    "variables": {},
    "fixtures": { "login": { "name": "Login", "steps": [ /* ... */ ] } },
    "flows": [ { "name": "My Flow", "steps": [ /* ... */ ] } ]
  }
}
```

### Writing Flows (step types)
- Control: navigate, wait, waitFor, waitForNavigation, setVar, if, loop, include
- Stagehand AI: observe, act, extract, agent
- Deterministic: fill, click, press, check/uncheck, hover, focus, upload
- Assertions: expect text/visible/enabled/url/title/var/extract/count/custom
  - See `src/types.ts` for detailed types

### Notes and Best Practices
- Keep observe instructions concise and specific to promote stable caching
- Prefer strict replay in CI to detect unexpected page changes or missing cache
- Use hybrid mode locally to build cache incrementally as you iterate
- Ensure required environment variables are set in .env
