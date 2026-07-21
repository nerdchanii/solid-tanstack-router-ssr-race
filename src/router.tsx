import { createRouter as createTanstackSolidRouter } from "@tanstack/solid-router";
import { routeTree } from "./routeTree.gen";

export function createRouter() {
  const router = createTanstackSolidRouter({
    defaultErrorComponent: err => <div>{err.error.stack}</div>,
    routeTree,
    defaultPreload: "intent",
    defaultStaleTime: 0, // TEST: force loader re-run per request to open race window
    scrollRestoration: true
  });
  return router;
}

export const router = createRouter();

// Register things for typesafety
declare module "@tanstack/solid-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
