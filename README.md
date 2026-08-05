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

## Why this matters (security / isolation)

This is not just "the wrong route component renders." Because the shared router state holds **request-scoped data** (loader output), one request's data can be rendered into **another request's response**. The moment a loader reads anything keyed to the request — an `x-user-id` header, a cookie, an auth session, a per-user DB row — that user-specific data can leak into a different user's SSR response. That is a cross-request, and potentially **cross-user, information disclosure**.

The `/secret` route demonstrates this concretely:

- `src/routes/secret.tsx` — the loader reads `x-user-id` via `getRequestEvent().request.headers` and returns `SECRET-TOKEN-FOR-<user>`.
- `leak-test.mjs` — cold-start, concurrent `alice`/`bob` pair on `/secret`. Reproduces **15/15**: bob's request (sent with `x-user-id: bob`) renders **alice's** secret token. Both responses carry the identical `data-n`, proving they were rendered from one shared loader result. Exit code **2** on leak.

Example raw evidence (cold-start, concurrent pair):

```
alice request (x-user-id: alice) -> rendered user="alice", secret="SECRET-TOKEN-FOR-alice", n=809214741
bob   request (x-user-id: bob)   -> rendered user="alice", secret="SECRET-TOKEN-FOR-alice", n=809214741   <-- LEAK
```

The same root cause also leaks in the **warm sequential** case (no concurrency at all). Once alice's request warms the singleton cache, every subsequent user — even on a quiet, serialized server — receives alice's cached data:

```
request x-user-id: alice -> rendered SECRET-TOKEN-FOR-alice  (n=44740098)
request x-user-id: bob   -> rendered SECRET-TOKEN-FOR-alice  (n=44740098)   <-- LEAK
request x-user-id: carol -> rendered SECRET-TOKEN-FOR-alice  (n=44740098)   <-- LEAK
request x-user-id: dave  -> rendered SECRET-TOKEN-FOR-alice  (n=44740098)   <-- LEAK
```

### Root principle

On the server you must never share **request-scoped state** across requests. The router instance — its match cache, loader data, and in-flight loads — is request-scoped. The correct fix is a **fresh router instance per request** (see [`FACTORY_PATCH.diff`](./FACTORY_PATCH.diff)). A module-level singleton is fine for the client (one browser tab = one user), but on the server it is an isolation bug.

### Why "it usually doesn't leak" is not a security property

Warm caching masks the symptom: the loader is not re-run, so the async race window closes and the cold-concurrent contamination above stops firing. But the underlying state is still shared, so the warm sequential leak above takes over — once user A's data is cached, **every** later user gets A's data. "Most requests don't leak" is an availability/timing observation, not an isolation guarantee. For a security property you need per-request state, full stop.

### Reproduce the leak

```bash
pnpm build
node leak-test.mjs 15 3000     # cold-start concurrent; expect 15/15 leak, exit code 2
```

## Results matrix (stable `@solidjs/start` 2.0.0)

| Scenario | Reproduced / Total |
|---|---|
| Cold-start concurrent (`cold-burst-test.mjs`) | 15/15 (100%) — 30/30 across two runs |
| Warm concurrent (`race-test.mjs`, 200 pairs) | 0/200 (0%) |
| Warm concurrent (independent max-parallel burst) | 0/200 (0%) |
| Single sequential (baseline) | 0/2 |
| **Cold-start cross-user leak (`leak-test.mjs`, `/secret`)** | **15/15 (100%)** |
| **Warm sequential cross-user leak (`/secret`, no concurrency)** | **every request after the first** |

## Honest caveat (warm)

The original issue [#268](https://github.com/solidjs/templates/issues/268) claimed warm 300/300 (100%), but re-testing on stable 2.0.0 shows warm **0/200** across two independent harnesses. Working hypothesis (unconfirmed): in the warm case the singleton holds loader results in memory, so the async loaders are not re-run per request and the race window never opens. Setting `defaultStaleTime: 0` only marks entries stale; it does not force a fresh server-side async fetch. **Only the cold-start reproduction is solid.**

## How this repo was updated

Originally based on `@solidjs/start` beta.0 (Approach A) so SSR would return 200. To check whether the singleton race still exists after stable 2.0.0 (which fixed the 500), only the toolchain was aligned (`package.json`, `vite.config.ts`, `pnpm-lock.yaml`); the SSR logic (singleton router in `src/router.tsx`, `src/entry-server.tsx`, async loader) was **not** changed. Result: the cold-start concurrent SSR race still reproduces.

## Related

- [`REPRODUCER.md`](./REPRODUCER.md) — full write-up and contamination matrix.
- [`FACTORY_PATCH.diff`](./FACTORY_PATCH.diff) — per-request factory control/fix.
- [`leak-test.mjs`](./leak-test.mjs) — cold-start cross-user leak test on `/secret` (see "Why this matters" above).
- [`src/routes/secret.tsx`](./src/routes/secret.tsx) — user-scoped loader (`x-user-id` → `SECRET-TOKEN-FOR-<user>`) used to demonstrate cross-user disclosure.
- Issue: https://github.com/solidjs/templates/issues/268

## Environment

`@solidjs/start` 2.0.0, `@tanstack/solid-router` 1.135.2, `@tanstack/router-plugin` 1.135.2, `vite` ^8.0.0, `solid-js` ^1.9.10, `nitro` ^3.0.260610-beta; Node 24, pnpm; darwin.
