import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/about")({
  // Async loader to open the yield window in loadMatches -> Promise.all.
  loader: async () => {
    await new Promise((r) => setTimeout(r, 50));
    return { page: "about", kind: "ABOUT_DATA", n: Math.floor(Math.random() * 1e9) };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const data = Route.useLoaderData();
  return (
    <main>
      <h1>About</h1>
      <div data-route-marker="ABOUT" data-page={data().page} data-kind={data().kind} data-n={data().n}>
        ABOUT_MARKER::{data().page}::{data().kind}::{data().n}
      </div>
    </main>
  );
}
