// Concurrent SSR race test for singleton router.
// Fires N pairs of (/ , /about) requests simultaneously,
// checks each response's HTML for cross-route contamination.
//
// Usage: node race-test.mjs [baseUrl] [pairs] [concurrency]
//   baseUrl default http://localhost:5173

const BASE = process.argv[2] || "http://localhost:5173";
const PAIRS = parseInt(process.argv[3] || "200", 10);
const CONC = parseInt(process.argv[4] || "20", 10); // in-flight pairs at once

const HOME = `${BASE}/`;
const ABOUT = `${BASE}/about`;

// Contamination signatures. The __root renders both Link texts, so we key on
// route-specific loader markers only.
const HOME_SIG = "HOME_MARKER::";
const ABOUT_SIG = "ABOUT_MARKER::";
const HOME_KIND = "HOME_DATA";
const ABOUT_KIND = "ABOUT_DATA";

function classify(html) {
  const hasHome = html.includes(HOME_SIG) || html.includes(HOME_KIND);
  const hasAbout = html.includes(ABOUT_SIG) || html.includes(ABOUT_KIND);
  return { hasHome, hasAbout };
}

async function fetchText(url) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { Accept: "text/html" } });
  const text = await res.text();
  return { url, status: res.status, text, ms: Date.now() - t0 };
}

async function firePair(idx) {
  // Fire both truly simultaneously by not awaiting sequentially.
  const [a, b] = await Promise.all([
    fetchText(HOME).catch((e) => ({ url: HOME, status: 0, text: String(e), ms: -1 })),
    fetchText(ABOUT).catch((e) => ({ url: ABOUT, status: 0, text: String(e), ms: -1 })),
  ]);
  return { idx, home: a, about: b };
}

function judge({ idx, home, about }) {
  const issues = [];
  // Status check
  if (home.status !== 200) issues.push(`HOME status=${home.status}`);
  if (about.status !== 200) issues.push(`ABOUT status=${about.status}`);

  // Home response classification
  const hc = classify(home.text);
  const ac = classify(about.text);

  // Correctness expectations:
  //  - home response should have HOME marker and NOT about marker
  //  - about response should have ABOUT marker and NOT home marker
  if (!hc.hasHome) issues.push("HOME-resp: missing HOME marker");
  if (hc.hasAbout) issues.push(`HOME-resp: CONTAMINATED with ABOUT data`);
  if (!ac.hasAbout) issues.push("ABOUT-resp: missing ABOUT marker");
  if (ac.hasHome) issues.push(`ABOUT-resp: CONTAMINATED with HOME data`);

  return { idx, issues, homeMs: home.ms, aboutMs: about.ms, hc, ac, homeText: home.text, aboutText: about.text };
}

async function run() {
  console.log(`BASE=${BASE} pairs=${PAIRS} concurrency=${CONC}`);
  console.log(`Warming up...`);
  // warmup
  for (let i = 0; i < 3; i++) {
    await fetch(HOME).then((r) => r.text());
    await fetch(ABOUT).then((r) => r.text());
  }

  const results = [];
  let inflight = 0;
  let nextIdx = 0;
  const queue = [];

  return new Promise((resolve) => {
    const launch = () => {
      while (inflight < CONC && nextIdx < PAIRS) {
        const idx = nextIdx++;
        inflight++;
        firePair(idx)
          .then((pair) => {
            const j = judge(pair);
            results.push(j);
            inflight--;
            if (results.length % 25 === 0) {
              const contam = results.filter((r) =>
                r.issues.some((s) => s.includes("CONTAMINATED"))
              ).length;
              console.log(
                `  progress ${results.length}/${PAIRS} (contaminated so far: ${contam})`
              );
            }
            launch();
            if (results.length === PAIRS) resolve(results);
          })
          .catch((e) => {
            console.error("pair error", e);
            inflight--;
            launch();
          });
      }
    };
    launch();
  });
}

run().then((results) => {
  const total = results.length;
  const contaminated = results.filter((r) =>
    r.issues.some((s) => s.includes("CONTAMINATED"))
  );
  const badStatus = results.filter((r) => r.issues.some((s) => s.includes("status=")));
  const missingMarker = results.filter((r) =>
    r.issues.some((s) => s.includes("missing"))
  );

  console.log("\n================ SUMMARY ================");
  console.log(`total pairs           : ${total}`);
  console.log(`contaminated pairs    : ${contaminated.length} (${((100 * contaminated.length) / total).toFixed(2)}%)`);
  console.log(`bad-status pairs      : ${badStatus.length}`);
  console.log(`missing-marker pairs  : ${missingMarker.length}`);

  if (contaminated.length > 0) {
    console.log("\n--- CONTAMINATION EXAMPLES (up to 5) ---");
    for (const ex of contaminated.slice(0, 5)) {
      console.log(`\n[pair #${ex.idx}] homeMs=${ex.homeMs}ms aboutMs=${ex.aboutMs}ms`);
      console.log(`  issues: ${JSON.stringify(ex.issues)}`);
      // Extract the marker lines
      const homeMarker = (ex.homeText.match(/HOME_MARKER::[^<\"]*/) || ["?"])[0];
      const aboutMarkerInHome = (ex.homeText.match(/ABOUT_MARKER::[^<\"]*/) || [null])[0];
      const aboutMarker = (ex.aboutText.match(/ABOUT_MARKER::[^<\"]*/) || ["?"])[0];
      const homeMarkerInAbout = (ex.aboutText.match(/HOME_MARKER::[^<\"]*/) || [null])[0];
      console.log(`  HOME-resp marker  : ${homeMarker} | about-leaked: ${aboutMarkerInHome}`);
      console.log(`  ABOUT-resp marker : ${aboutMarker} | home-leaked: ${homeMarkerInAbout}`);
    }
  } else {
    console.log("\nNo contamination observed.");
  }

  // Detailed timing stats
  const allMs = results.flatMap((r) => [r.homeMs, r.aboutMs]).filter((x) => x > 0);
  allMs.sort((a, b) => a - b);
  const p = (q) => allMs[Math.floor((q / 100) * allMs.length)];
  if (allMs.length) {
    console.log(
      `\nlatency ms: min=${allMs[0]} p50=${p(50)} p95=${p(95)} max=${allMs[allMs.length - 1]}`
    );
  }
  console.log("=========================================\n");
  process.exit(contaminated.length > 0 ? 2 : 0);
});
