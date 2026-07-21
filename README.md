# with-tanstack-router — SSR singleton-router race (reproducer)

Minimal reproducer for a **concurrency race in `solidjs/templates` → `solid-start-v2/with-tanstack-router`**: the template exports a **module-level singleton router** (`export const router = createRouter()`), and under concurrent SSR requests one request renders *another request's* route data.

The race is **real and deterministically reproducible** — and the per-request factory eliminates it. Full details, the contamination matrix, and the "why the shipped demo doesn't show it" analysis are in **[`REPRODUCER.md`](./REPRODUCER.md)**.

> This repo scaffolds the official `with-tanstack-router` template, applies [Approach A](./src/entry-server.tsx) (so SSR returns 200), keeps the singleton, and adds a small async loader so the yield window opens. The control/fix lives in [`FACTORY_PATCH.diff`](./FACTORY_PATCH.diff).

## TL;DR

| config | cold (15 trials) | warm (300 pairs) |
|---|---|---|
| **singleton** (template pattern) | **15/15 contaminated (100%)** | **300/300 (100%)** |
| **per-request factory** (control) | **0/15 (0%)** | **0/300 (0%)** |

A request to `/` came back rendering the `/about` route's component + loader data, with the same internal `data-n` as the overlapping `/about` response.

## Quick start

```bash
pnpm install
pnpm build

# Singleton (bug): restart-per-trial cold test — most realistic
node cold-burst-test.mjs 15 3000      # expect ~100% contaminated

# Apply the factory control, rebuild, rerun
patch -p0 < FACTORY_PATCH.diff
pnpm build
node cold-burst-test.mjs 15 3000      # expect 0% contaminated
```

## Why the shipped demo doesn't reproduce

The shipped template has **static routes with no loaders**, so `router.load()` has no async work and never yields — no race window. **Any real app doing data fetching** (`fetch` / DB / `createServerFn`) opens the window on the first cold request to each route. Warm cache (TanStack match cache, `defaultStaleTime: 5000`) further masks it by returning cached matches synchronously. See [`REPRODUCER.md`](./REPRODUCER.md) for the full write-up.

## Environment

node v24.15.0, pnpm 11.12.0, `@solidjs/start` 2.0.0-alpha.2, `@tanstack/solid-router` 1.135.2, darwin 25.5.0.
