// Cold-cache race test: restart the production server for each trial so the
// singleton's match cache is empty, then fire ONE concurrent (/ , /about)
// pair and check for contamination. This simulates the realistic "first
// request to each route" scenario with default `await router.load()` (no
// invalidate, no sync) + async loaders.
//
// Usage: node cold-burst-test.mjs [trials] [port]

import { spawn } from "node:child_process";
import { once } from "node:events";

const TRIALS = parseInt(process.argv[2] || "15", 10);
const PORT = parseInt(process.argv[3] || "3000", 10);
const BASE = `http://localhost:${PORT}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startServer() {
  const proc = spawn("node", [".output/server/index.mjs"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(PORT) },
  });
  // wait for "Listening"
  let buf = "";
  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server start timeout")), 15000);
    proc.stdout.on("data", (d) => {
      buf += d.toString();
      if (buf.includes("Listening")) {
        clearTimeout(timer);
        resolve(proc);
      }
    });
    proc.stderr.on("data", (d) => {
      console.error("stderr:", d.toString());
    });
    proc.on("exit", (code) => {
      if (!buf.includes("Listening")) reject(new Error("server exited early code=" + code));
    });
  });
  await opened;
  // small grace
  await sleep(200);
  return proc;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { Accept: "text/html" } });
  const text = await res.text();
  return { status: res.status, text };
}

async function firePair() {
  return Promise.all([
    fetchText(`${BASE}/`).catch((e) => ({ status: 0, text: String(e) })),
    fetchText(`${BASE}/about`).catch((e) => ({ status: 0, text: String(e) })),
  ]);
}

function classify(text) {
  return {
    hasHome: text.includes("HOME_DATA") || text.includes('data-route-marker="HOME"'),
    hasAbout: text.includes("ABOUT_DATA") || text.includes('data-route-marker="ABOUT"'),
  };
}

async function trial(i) {
  const proc = await startServer();
  try {
    // NO warmup: fire the cold pair immediately.
    const [home, about] = await firePair();
    const hc = classify(home.text);
    const ac = classify(about.text);
    const issues = [];
    if (home.status !== 200) issues.push(`HOME status=${home.status}`);
    if (about.status !== 200) issues.push(`ABOUT status=${about.status}`);
    if (!hc.hasHome) issues.push("HOME-resp missing HOME marker");
    if (hc.hasAbout) issues.push("HOME-resp CONTAMINATED with ABOUT data");
    if (!ac.hasAbout) issues.push("ABOUT-resp missing ABOUT marker");
    if (ac.hasHome) issues.push("ABOUT-resp CONTAMINATED with HOME data");
    return { trial: i, issues, hc, ac };
  } finally {
    proc.kill("SIGTERM");
    await sleep(300);
  }
}

(async () => {
  console.log(`Cold-cache race test: ${TRIALS} trials (server restart per trial)`);
  let contam = 0;
  const examples = [];
  for (let i = 0; i < TRIALS; i++) {
    try {
      const r = await trial(i);
      const isContam = r.issues.some((s) => s.includes("CONTAMINATED"));
      if (isContam) {
        contam++;
        if (examples.length < 5) examples.push(r);
      }
      process.stdout.write(isContam ? "X" : ".");
    } catch (e) {
      process.stdout.write("E");
      console.error(`\ntrial ${i} error: ${e.message}`);
    }
  }
  console.log("");
  console.log(`\n================ COLD-CACHE SUMMARY ================`);
  console.log(`trials           : ${TRIALS}`);
  console.log(`contaminated     : ${contam} (${((100 * contam) / TRIALS).toFixed(1)}%)`);
  if (examples.length) {
    console.log("\n--- examples ---");
    for (const e of examples) {
      console.log(`trial #${e.trial}: ${JSON.stringify(e.issues)} hc=${JSON.stringify(e.hc)} ac=${JSON.stringify(e.ac)}`);
    }
  }
  console.log(`====================================================`);
  process.exit(contam > 0 ? 2 : 0);
})();
