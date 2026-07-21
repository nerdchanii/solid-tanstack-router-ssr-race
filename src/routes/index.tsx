import { createFileRoute } from "@tanstack/solid-router";
import Counter from "~/components/Counter";

export const Route = createFileRoute("/")({
  // Async loader to open the yield window in loadMatches -> Promise.all.
  loader: async () => {
    await new Promise((r) => setTimeout(r, 50));
    return { page: "home", kind: "HOME_DATA", n: Math.floor(Math.random() * 1e9) };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const data = Route.useLoaderData();
  return (
    <main>
      <h1>Hello world!</h1>
      {/* Distinct marker so we can detect cross-route contamination in raw HTML */}
      <div data-route-marker="HOME" data-page={data().page} data-kind={data().kind} data-n={data().n}>
        HOME_MARKER::{data().page}::{data().kind}::{data().n}
      </div>
      <Counter />
      <p>
        Visit{" "}
        <a href="https://start.solidjs.com" target="_blank">
          start.solidjs.com
        </a>{" "}
        to learn how to build SolidStart apps.
      </p>
    </main>
  );
}
