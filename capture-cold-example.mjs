// Starts a fresh server (cold cache), fires one concurrent pair, dumps both
// responses' <main> for evidence.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const PORT = 3150;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start() {
  const proc = spawn("node", [".output/server/index.mjs"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(PORT) },
  });
  let buf = "";
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 15000);
    proc.stdout.on("data", (d) => {
      buf += d.toString();
      if (buf.includes("Listening")) {
        clearTimeout(t);
        resolve();
      }
    });
    proc.on("exit", (c) => reject(new Error("exited " + c)));
  });
  await sleep(200);
  return proc;
}

(async () => {
  const proc = await start();
  try {
    const [home, about] = await Promise.all([
      fetch(`${BASE}/`).then((r) => r.text()),
      fetch(`${BASE}/about`).then((r) => r.text()),
    ]);
    writeFileSync("/tmp/repro-cold-home.html", home);
    writeFileSync("/tmp/repro-cold-about.html", about);

    const strip = (t) =>
      t.replace(/<!--\$-->|<!--\/\$-->/g, "").replace(/<!--!\$[^>]*-->/g, "");
    const hMain = strip(home).match(/<main>[\s\S]*?<\/main>/);
    const aMain = strip(about).match(/<main>[\s\S]*?<\/main>/);

    const hmark = home.match(/data-route-marker="([^"]+)" data-page="([^"]+)"/);
    const amark = about.match(/data-route-marker="([^"]+)" data-page="([^"]+)"/);

    console.log("REQUEST /      -> marker:", hmark && hmark[0]);
    console.log("REQUEST /about -> marker:", amark && amark[0]);
    console.log("\n--- / response <main> ---");
    console.log(hMain ? hMain[0].slice(0, 700) : "(none)");
    console.log("\n--- /about response <main> ---");
    console.log(aMain ? aMain[0].slice(0, 700) : "(none)");
    console.log("\nFull HTML saved: /tmp/repro-cold-home.html , /tmp/repro-cold-about.html");
  } finally {
    proc.kill("SIGTERM");
  }
})();
