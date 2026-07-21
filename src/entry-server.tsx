// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";
import { createMemoryHistory } from "@tanstack/solid-router";
import { router } from "./router";

// BUG-REPRODUCING CONFIG: singleton router (the template's current pattern).
// `router` is a module-level singleton imported by both entry-server.tsx AND
// app.tsx (via RouterProvider). Under concurrent SSR requests with async
// route loaders, the shared mutable router state leaks across requests.
// See race-test.mjs / cold-burst-test.mjs.
export default createHandler(
  () => (
    <StartServer
      document={({ assets, children, scripts }) => (
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <link rel="icon" href="/favicon.ico" />
            {assets}
          </head>
          <body>
            <div id="app">{children}</div>
            {scripts}
          </body>
        </html>
      )}
    />
  ),
  async (context) => {
    const url = new URL(context.request.url);
    const path = url.href.replace(url.origin, "");

    router.update({
      history: createMemoryHistory({
        initialEntries: [path]
      })
    });

    await router.load();

    return {};
  }
);
