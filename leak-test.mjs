// Cold-start cross-user leak test for the /secret route.
//
// Restarts the production server per trial so the singleton router's match cache
// is cold, then fires ONE concurrent pair of requests to the SAME route
// (/secret) with DIFFERENT `x-user-id` headers (alice, bob). Under the
// module-level singleton router, the two requests share mutable router state;
// the loader runs effectively once and both responses render the SAME user's
// data. The request that loses the race gets the OTHER user's secret — a
// cross-request / cross-user information disclosure.
//
// Modeled on cold-burst-test.mjs. Exit code 2 means a leak was detected.
//
// Usage: node leak-test.mjs [trials] [port]

import { spawn } from "node:child_process";

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
  let buf = "";
  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("server start timeout")),
      15000
    );
    proc.stdout.on("data", (d) => {
      buf += d.toString();
      if (buf.includes("Listening")) {
        clearTimeout(timer);
        resolve(proc);
      }
    });
    proc.stderr.on("data", (d) => {
      // Suppress the server's graceful-shutdown chatter (we SIGTERM it on
      // purpose each trial); surface anything else.
      const line = d.toString();
      if (/Stopping server|Server closed/.test(line)) return;
      console.error("stderr:", line);
    });
    proc.on("exit", (code) => {
      if (!buf.includes("Listening"))
        reject(new Error("server exited early code=" + code));
    });
  });
  await opened;
  await sleep(200);
  return proc;
}

// Pull the rendered user/secret straight out of the SSR HTML attributes
// (these are static strings, so they aren't wrapped in Solid hydration markers).
function extractRendered(text) {
  const u = text.match(/data-user="([^"]*)"/);
  const s = text.match(/data-secret="([^"]*)"/);
  const n = text.match(/data-n="(\d+)"/);
  const marker = text.match(/data-route-marker="([^"]*)"/);
  return {
    marker: marker ? marker[1] : null,
    renderedUser: u ? u[1] : null,
    renderedSecret: s ? s[1] : null,
    n: n ? n[1] : null,
  };
}

async function fetchSecret(userId) {
  const res = await fetch(`${BASE}/secret`, {
    headers: { "x-user-id": userId, Accept: "text/html" },
  });
  const text = await res.text();
  return { requestedUser: userId, status: res.status, ...extractRendered(text) };
}

async function firePair() {
  return Promise.all([
    fetchSecret("alice").catch((e) => ({
      requestedUser: "alice",
      status: 0,
      renderedUser: null,
      renderedSecret: null,
      n: null,
      error: String(e),
    })),
    fetchSecret("bob").catch((e) => ({
      requestedUser: "bob",
      status: 0,
      renderedUser: null,
      renderedSecret: null,
      n: null,
      error: String(e),
    })),
  ]);
}

function diagnose(alice, bob) {
  const issues = [];
  if (alice.status !== 200) issues.push(`alice status=${alice.status}`);
  if (bob.status !== 200) issues.push(`bob status=${bob.status}`);
  if (alice.renderedUser !== "alice")
    issues.push(
      `alice-resp rendered user="${alice.renderedUser}" (expected "alice") — LEAK`
    );
  if (bob.renderedUser !== "bob")
    issues.push(
      `bob-resp rendered user="${bob.renderedUser}" (expected "bob") — LEAK`
    );
  // Same n on both responses => both rendered from one shared loader result.
  if (
    alice.n &&
    bob.n &&
    alice.n === bob.n &&
    (alice.renderedUser || bob.renderedUser)
  ) {
    issues.push(
      `shared-state evidence: both responses carry identical data-n="${alice.n}"`
    );
  }
  return issues;
}

async function trial(i) {
  const proc = await startServer();
  try {
    const [alice, bob] = await firePair();
    const issues = diagnose(alice, bob);
    return { trial: i, alice, bob, issues };
  } finally {
    proc.kill("SIGTERM");
    await sleep(300);
  }
}

(async () => {
  console.log(
    `Cold-start cross-user leak test: ${TRIALS} trials (server restart per trial, concurrent alice+bob on /secret)`
  );
  let leakTrials = 0;
  const examples = [];
  for (let i = 0; i < TRIALS; i++) {
    try {
      const r = await trial(i);
      const isLeak = r.issues.some((s) => s.includes("LEAK"));
      if (isLeak) {
        leakTrials++;
        if (examples.length < 3) examples.push(r);
      }
      process.stdout.write(isLeak ? "X" : ".");
    } catch (e) {
      process.stdout.write("E");
      console.error(`\ntrial ${i} error: ${e.message}`);
    }
  }
  console.log("");
  console.log(`\n================ LEAK TEST SUMMARY ================`);
  console.log(`trials              : ${TRIALS}`);
  console.log(
    `leaked (cross-user) : ${leakTrials} (${((100 * leakTrials) / TRIALS).toFixed(1)}%)`
  );
  if (examples.length) {
    console.log("\n--- example trials (raw evidence) ---");
    for (const e of examples) {
      console.log(`trial #${e.trial}`);
      console.log(
        `  alice request (x-user-id: alice) -> HTTP ${e.alice.status}, rendered user="${e.alice.renderedUser}", secret="${e.alice.renderedSecret}", n=${e.alice.n}`
      );
      console.log(
        `  bob   request (x-user-id: bob)   -> HTTP ${e.bob.status}, rendered user="${e.bob.renderedUser}", secret="${e.bob.renderedSecret}", n=${e.bob.n}`
      );
      for (const issue of e.issues) console.log(`  ! ${issue}`);
    }
  }
  console.log(`====================================================`);
  process.exit(leakTrials > 0 ? 2 : 0);
})();
