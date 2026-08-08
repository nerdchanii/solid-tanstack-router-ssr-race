# Verification: per-request router fixes the SSR leak (PR solidjs/templates#271)

Independent before/after measurement against this reproducer, confirming that
the **per-request router pattern** (solidjs/templates PR #271) eliminates the
cold-start cross-user SSR leak on `@solidjs/start` 2.0.0 stable.

## Setup

- `@solidjs/start` 2.0.0 (stable), `@tanstack/solid-router` 1.135.2, Node 24, pnpm, darwin
- `leak-test.mjs` — cold-start (server restart per trial), one concurrent
  `alice` + `bob` pair on `/secret`, each with a different `x-user-id` header.
  Exit code **2** = leak detected, **0** = clean.

> **Harness note — always use an isolated port.** An earlier run reused port
> 3000, where a stale server from a previous session was still listening. That
> made *every* configuration appear to leak 15/15 — including the per-request
> factory control, which is known-good. On isolated ports the per-request
> configs pass cleanly. If a result looks implausible, confirm the port is free
> (`lsof -i :PORT`) before trusting it. This trap cost real time during this
> verification.

## Results (isolated ports)

| Configuration | `leak-test.mjs` | exit |
|---|---|---|
| **Baseline — singleton router** (`main`) | **15/15 (100%) leaked** | 2 |
| **Per-request — PR #271 form** (`routerLoad` + `event.locals.router`, 3-arg `createHandler`) | **0/15 (0%) leaked** | 0 |
| **Per-request — factory control** (`FACTORY_PATCH.diff`, `context.__router`, 2-arg `createHandler`) | **0/5 (0%) leaked** | 0 |

Per-request evidence (cold-start concurrent pair, isolated port):

```
alice (x-user-id: alice) -> user="alice", secret="SECRET-TOKEN-FOR-alice", ran=true, per-request-router-reached=true
bob   (x-user-id: bob)   -> user="bob",   secret="SECRET-TOKEN-FOR-bob",   ran=true, per-request-router-reached=true
```

Each request renders its own user's data; `data-n` differs between the two
(no shared loader result). `data-ran=true` confirms the loader executed for
each request, and `per-request-router-reached=true` confirms the request-scoped
router reached `app.tsx` (no singleton fallback on the server).

## Conclusion

The per-request router pattern — a fresh `createRouter()` per request, threaded
to the render through the request context (`event.locals.router` / `context.__router`)
and read back in `app.tsx` via `getRequestEvent()` — **removes the leak**.

- PR #271 (`event.locals.router`, 3-arg `createHandler`) and the factory control
  (`context.__router`, 2-arg) are **equivalent per-request approaches** and both pass.
- The singleton baseline leaks **100%** on cold-start concurrent requests.
- The match state is instance-scoped (`this.state.pendingMatches` in router-core),
  so a per-request `createRouter()` gives each request its own match cache —
  which is exactly why the leak disappears.

## How to reproduce the "after"

```bash
# Apply PR #271's src/entry-server.tsx + src/app.tsx (router.tsx already exports createRouter)
pnpm build
node leak-test.mjs 15 <isolated-port>   # expect 0/15, exit 0
```

## Links

- PR: https://github.com/solidjs/templates/pull/271
- Issue: https://github.com/solidjs/templates/issues/268
- Factory control patch: [`FACTORY_PATCH.diff`](./FACTORY_PATCH.diff)
