// Captures one concrete contamination example from the running server.
const P = Promise.all([
  fetch("http://localhost:3000/").then((r) => r.text()),
  fetch("http://localhost:3000/about").then((r) => r.text()),
]);
P.then(([h, a]) => {
  const extract = (t, label) => {
    const mm = t.match(/data-route-marker="([^"]+)" data-page="([^"]+)" data-kind="([^"]+)"/);
    const title = (t.match(/<h1>([^<]*)<\/h1>/) || [, "?"])[1];
    console.log(label, '-> h1="' + title + '" marker=', mm && mm[0]);
  };
  extract(h, "REQUEST /     ");
  extract(a, "REQUEST /about");
  console.log('\n--- / response <main> (comments stripped, truncated 600 chars) ---');
  const clean = h
    .replace(/<!--\$-->|<!--\/\$-->/g, "")
    .replace(/<!--!\$[^>]*-->/g, "");
  const mm = clean.match(/<main>[\s\S]*?<\/main>/);
  console.log(mm ? mm[0].slice(0, 600) : "(none)");
});
