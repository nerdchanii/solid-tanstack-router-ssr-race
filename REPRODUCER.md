# SSR singleton-router race — reproducer

Confirms the "module-level router singleton leaks state across concurrent SSR
requests" concern in `solid-start-v2/with-tanstack-router`. The race is **real
and deterministically reproducible** under cold-cache concurrent requests when
async route loaders are present.

## Matrix (production build, `node .output/server/index.mjs`)

| config                                  | conditions            | contamination        |
|-----------------------------------------|-----------------------|----------------------|
| **singleton** (template's pattern)      | cold cache, 15 trials | **15/15 (100%)** — 30/30 across two runs |
| **factory** (per-request router)        | cold cache, 15 trials | **0/15 (0%)**        |
| **singleton** + `invalidate`+`sync`     | warm, 200 pairs       | **0/200 (0%)**       |
| **factory**  + `invalidate`+`sync`      | warm, 200 pairs       | **0/200 (0%)**       |

Conclusion: on stable 2.0.0 the race is **only deterministic in the cold
singleton case** — the per-request factory eliminates that cold contamination.
The warm case shows **no contamination in either config** (0/200 across two
independent harnesses: `race-test.mjs` at concurrency 20, and a harness-free
custom max-parallel burst). The earlier warm 300/300 claim (alpha.2 /
`defaultStaleTime: 5000`) did **not** reproduce on stable 2.0.0
(`defaultStaleTime: 0`). The cold-start result is the solid, realistic
reproduction (serverless/edge cold starts).

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
- `src/router.tsx`              — `defaultStaleTime: 0` (forces loader re-run per request; intended to open the warm race window, which did **not** reproduce on stable 2.0.0 — only the cold-start race did).
- `src/routes/{index,about}.tsx`— async loaders returning distinct, marked data.
- `src/routes/secret.tsx`       — user-scoped loader: reads `x-user-id` via `getRequestEvent().request.headers` and returns `SECRET-TOKEN-FOR-<user>`. Used to demonstrate **cross-user information disclosure** (see "Security angle" below).
- `race-test.mjs`               — concurrent-pair test (warm; needs invalidate+sync to open window every request).
- `cold-burst-test.mjs`         — restarts the server per trial, fires one cold pair (no invalidate/sync needed).
- `capture-cold-example.mjs`    — starts fresh server, fires one pair, dumps HTML.
- `leak-test.mjs`               — cold-start cross-user leak test on `/secret` (concurrent `alice`/`bob`); exit 2 on leak.
- `FACTORY_PATCH.diff`          — the control/fix: switch to per-request factory wired via the request event.

## Security angle: cross-user information disclosure

The shared-state race is not merely "the wrong route renders" — because the
router holds **request-scoped loader data**, one request's data can be rendered
into another request's response. `src/routes/secret.tsx` makes this concrete:
its loader returns `SECRET-TOKEN-FOR-<user>` keyed on the `x-user-id` header.

| mode | request pattern | leak rate |
|---|---|---|
| cold-start, concurrent pair (`leak-test.mjs`) | alice + bob hit `/secret` at once, server restart per trial | **15/15 (100%)** |
| warm, sequential (no concurrency) | alice, then bob, carol, dave on one warm server | **every request after the first** |

In both cases the request that loses the race (or simply arrives later, warm)
renders the **other user's** secret token. Cold-concurrent example:

```
alice request (x-user-id: alice) -> rendered user="alice", secret="SECRET-TOKEN-FOR-alice", n=809214741
bob   request (x-user-id: bob)   -> rendered user="alice", secret="SECRET-TOKEN-FOR-alice", n=809214741   <-- LEAK
```

```bash
pnpm build
node leak-test.mjs 15 3000      # expect 15/15 leak, exit code 2
```

The fix is the same as the race fix: a **per-request router instance** so no
request-scoped state is shared (see `FACTORY_PATCH.diff`). Warm caching hides
the concurrent race but does **not** provide isolation — the warm sequential
leak above is deterministic.



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
effectively serialized on the shared router. (This is why the **default
template**, which ships `defaultStaleTime: 5000`, "passes" even under load —
its loaders only run once. **This repro instead sets `defaultStaleTime: 0`**
in `src/router.tsx`, yet even then the warm race did **not** reproduce on
stable 2.0.0 — only the cold-start race did.)

## Environment

node v24.15.0, pnpm 10.28.2, `@solidjs/start` 2.0.0,
`@tanstack/solid-router` 1.135.2, `vite` 8.2.0, `solid-js` 1.9.10,
`nitro` 3.0.260610-beta, darwin 25.5.0.
