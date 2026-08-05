import { createFileRoute } from "@tanstack/solid-router";
import { getRequestEvent } from "solid-js/web";

// Security/isolation scenario: the loader returns data SCOPED TO THE REQUEST
// (here: the `x-user-id` request header). Under the singleton router, this
// per-request data can be rendered into a DIFFERENT user's response — a
// cross-request (potentially cross-user) information disclosure.
//
// See leak-test.mjs for the reproduction.
export const Route = createFileRoute("/secret")({
  loader: async () => {
    // SolidStart wires the current FetchEvent into the async context, so
    // getRequestEvent() inside an async loader returns this request's event.
    const event = getRequestEvent();
    const user =
      event?.request?.headers?.get("x-user-id") ?? "anonymous";
    // Async yield window (same mechanism as /, /about) so the singleton
    // router's shared mutable state can be raced by concurrent requests.
    await new Promise((r) => setTimeout(r, 50));
    const n = Math.floor(Math.random() * 1e9);
    const secret = `SECRET-TOKEN-FOR-${user}`;
    return { user, secret, n };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const data = Route.useLoaderData();
  return (
    <main>
      <h1>Secret</h1>
      {/* Distinct, user-scoped markers so cross-user leakage is visible in raw HTML. */}
      <div
        data-route-marker="SECRET"
        data-user={data().user}
        data-secret={data().secret}
        data-n={data().n}
      >
        SECRET_MARKER::{data().user}::{data().secret}::{data().n}
      </div>
    </main>
  );
}
