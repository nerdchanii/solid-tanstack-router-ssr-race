# with-tanstack-router — SSR singleton-router race (reproducer)

Minimal reproducer for state leaking across concurrent SSR requests when a module-level singleton TanStack Router is shared across requests. Targets `@solidjs/start` v2 stable (2.0.0). Tracks solidjs/templates issue [#268](https://github.com/solidjs/templates/issues/268).

Remote: https://github.com/nerdchanii/solid-tanstack-router-ssr-race.git

## TL;DR

`@solidjs/start` stable 2.0.0 fixed the SSR 500 (the third `routerLoad` argument in `createHandler` was restored), so single-request SSR works. However, the module-level singleton `router` in `src/router.tsx` (`export const router = createRouter()`) still leaks state across concurrent SSR requests: on a cold start, simultaneous requests to `/` and `/about` cause `/` to render `/about`'s route component and loader data. This is **deterministic** — 15/15 trials reproduce on cold start.

## Requirements

- Node >= 24 (engines declares >=22)
- pnpm

## Setup

```bash
pnpm install
pnpm build
```

## Reproduce: cold-start concurrent (deterministic)

```bash
node cold-burst-test.mjs 15 3000
```

Restarts the prod server per trial and fires one concurrent `(/, /about)` pair, detecting cross-route contamination. The script exits with code **2** when contamination is detected. Expected: **15/15 trials contaminated**.

## Reproduce: capture one concrete pair

```bash
node capture-cold-example.mjs
```

Starts a fresh cold server, fires one concurrent `(/, /about)` pair, and dumps both responses to `/tmp/repro-cold-home.html` and `/tmp/repro-cold-about.html`. The home response contains the **ABOUT** marker.

## Baseline: single request (always correct)

After starting the server, request `/` and `/about` individually — both render correctly. Single-request SSR is **not** affected; only the concurrent case leaks state.

## What's happening

The singleton router plus `router.load()` calls `loadMatches` → `Promise.all(loaders)`. During the async yield window, two concurrent requests mutate the same shared store, so one request's matches/data overwrite the other's. The first request to resolve then renders with the wrong route component and loader data.

## Results matrix (stable `@solidjs/start` 2.0.0)

| Scenario | Reproduced / Total |
|---|---|
| Cold-start concurrent (`cold-burst-test.mjs`) | 15/15 (100%) — 30/30 across two runs |
| Warm concurrent (`race-test.mjs`, 200 pairs) | 0/200 (0%) |
| Warm concurrent (independent max-parallel burst) | 0/200 (0%) |
| Single sequential (baseline) | 0/2 |

## Honest caveat (warm)

The original issue [#268](https://github.com/solidjs/templates/issues/268) claimed warm 300/300 (100%), but re-testing on stable 2.0.0 shows warm **0/200** across two independent harnesses. Working hypothesis (unconfirmed): in the warm case the singleton holds loader results in memory, so the async loaders are not re-run per request and the race window never opens. Setting `defaultStaleTime: 0` only marks entries stale; it does not force a fresh server-side async fetch. **Only the cold-start reproduction is solid.**

## How this repo was updated

Originally based on `@solidjs/start` beta.0 (Approach A) so SSR would return 200. To check whether the singleton race still exists after stable 2.0.0 (which fixed the 500), only the toolchain was aligned (`package.json`, `vite.config.ts`, `pnpm-lock.yaml`); the SSR logic (singleton router in `src/router.tsx`, `src/entry-server.tsx`, async loader) was **not** changed. Result: the cold-start concurrent SSR race still reproduces.

## Related

- [`REPRODUCER.md`](./REPRODUCER.md) — full write-up and contamination matrix.
- [`FACTORY_PATCH.diff`](./FACTORY_PATCH.diff) — per-request factory control/fix.
- Issue: https://github.com/solidjs/templates/issues/268

## Environment

`@solidjs/start` 2.0.0, `@tanstack/solid-router` 1.135.2, `@tanstack/router-plugin` 1.135.2, `vite` ^8.0.0, `solid-js` ^1.9.10, `nitro` ^3.0.260610-beta; Node 24, pnpm; darwin.
