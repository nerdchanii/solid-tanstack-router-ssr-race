# SSR singleton-router race — reproducer

Confirms the "module-level router singleton leaks state across concurrent SSR
requests" concern in `solid-start-v2/with-tanstack-router`. The race is **real
and deterministically reproducible** under cold-cache concurrent requests when
async route loaders are present.

## Matrix (production build, `node .output/server/index.mjs`)

| config                                  | conditions            | contamination        |
|-----------------------------------------|-----------------------|----------------------|
| **singleton** (template's pattern)      | cold cache, 15 trials | **15/15 (100%)**     |
| **factory** (per-request router)        | cold cache, 15 trials | **0/15 (0%)**        |
| **singleton** + `invalidate`+`sync`     | warm, 300 pairs       | **300/300 (100%)**   |
| **factory**  + `invalidate`+`sync`      | warm, 300 pairs       | **0/300 (0%)**       |

Conclusion: the race is in the **singleton**, and the **per-request factory
eliminates it**.

## A concrete contamination example (cold cache)

Two requests fired simultaneously right after server start:

```
REQUEST /       ->  <h1>About</h1>
                   data-route-marker="ABOUT" data-page="about"
                   data-kind="ABOUT_DATA" data-n="792578936"

REQUEST /about  ->  <h1>About</h1>
                   data-route-marker="ABOUT" data-page="about"
                   data-kind="ABOUT_DATA" data-n="792578936"   (same n)
```

The `/` request rendered the **`/about` route's component and loader data**.
Both responses carry the identical `data-n` because they were rendered from
the same shared router state at the same instant.

## Files

- `src/entry-server.tsx`        — singleton (bug) config, stock Approach A.
- `src/router.tsx`              — `staleTime: 0` (forces cold-style loads for the warm test).
- `src/routes/{index,about}.tsx`— async loaders returning distinct, marked data.
- `race-test.mjs`               — concurrent-pair test (warm; needs invalidate+sync to open window every request).
- `cold-burst-test.mjs`         — restarts the server per trial, fires one cold pair (no invalidate/sync needed).
- `capture-cold-example.mjs`    — starts fresh server, fires one pair, dumps HTML.
- `FACTORY_PATCH.diff`          — the control/fix: switch to per-request factory wired via the request event.

## How to reproduce

```bash
pnpm install
pnpm build

# 1) Singleton (bug): restart-per-trial cold test (most realistic)
node cold-burst-test.mjs 15 3000      # expect ~100% contaminated

# 2) Apply factory patch, rebuild, rerun
patch -p0 < FACTORY_PATCH.diff        # or edit by hand
pnpm build
node cold-burst-test.mjs 15 3000      # expect 0% contaminated
```

## Why the shipped demo doesn't reproduce

The shipped template has **static routes with no loaders**, so `router.load()`
has no async work and never yields — there is no race window. **Any real app
doing data fetching** (`fetch` / DB / `createServerFn`) opens the window on the
first (cold) request to each route. Under concurrent cold requests the
contamination is deterministic.

The warm-cache case (repeated requests to already-loaded routes) is masked by
TanStack's match cache: `router.load()` returns the cached match immediately
without re-running the loader, so the yield window closes and requests are
effectively serialized on the shared router. (This is why the default
`staleTime: 5000` template "passes" even under load — the loaders only run
once.)

## Environment

node v24.15.0, pnpm 11.12.0, `@solidjs/start` 2.0.0-alpha.2,
`@tanstack/solid-router` 1.135.2, darwin 25.5.0.
