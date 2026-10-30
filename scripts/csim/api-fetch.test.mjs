import { load, test, eq, ok, tipHas, fmt } from "./lib.mjs";

const M = load("api-fetch");
const per = rtt => rtt + M.COST.app + M.COST.db;

test("REST needs 2 + N requests; sequential pays one RTT each, parallel two waves", () => {
  const s = M.rest(10, 100, "seq"), p = M.rest(10, 100, "par");
  eq([s.trips, p.trips], [12, 12], "requests");
  eq([s.waves, p.waves], [12, 2], "waves");
  eq(s.latency, 12 * per(100), "sequential latency");
  eq(p.latency, 2 * per(100), "parallel latency");
  for (let i = 1; i < s.reqs.length; i++) ok(s.reqs[i].start >= s.reqs[i - 1].end, "a sequential request started before the previous answer");
});

test("REST downloads full representations: most of the payload is unused", () => {
  const r = M.rest(10, 100, "seq"), g = M.graphql(10, 100, false);
  eq(r.used, g.used, "both deliver the same fields the screen shows");
  ok(r.unused / r.payload > 0.8, "over-fetching should dominate the REST payload");
  eq(g.unused, 0, "GraphQL fetches exact fields");
  ok(r.bytes > 8 * g.bytes, "REST should download several times more");
});

test("GraphQL: one round trip; N + 2 queries without DataLoader, 3 with it", () => {
  for (const n of [1, 10, 50]) {
    eq(M.graphql(n, 100, false).queries, n + 2, `naive queries at N=${n}`);
    eq(M.graphql(n, 100, true).queries, 3, `batched queries at N=${n}`);
    eq(M.graphql(n, 100, false).trips, 1, "one round trip");
  }
  ok(M.graphql(50, 100, true).latency < M.graphql(50, 100, false).latency, "batching should cut latency");
});

test("the N + 1 on the server can cost more than the round trips saved", () => {
  ok(M.graphql(50, 100, false).latency > M.rest(50, 100, "par").latency, "naive GraphQL at N=50 should lose to parallel REST");
  ok(M.graphql(50, 100, true).latency < M.rest(50, 100, "par").latency, "with DataLoader it should win again");
  ok(M.graphql(10, 20, false).latency > M.rest(10, 20, "par").latency, "on a short RTT the naive server loses too");
});

test("the tip's numbers", () => {
  const s = M.rest(10, 100, "seq"), p = M.rest(10, 100, "par");
  const g = M.graphql(10, 100, false), d = M.graphql(10, 100, true), g50 = M.graphql(50, 100, false), p50 = M.rest(50, 100, "par");
  console.log(`       seq ${s.trips} trips ${s.latency} ms; par ${p.latency} ms; REST ${s.bytes} B, unused ${(100 * s.unused / s.payload).toFixed(1)}%; ` +
    `GraphQL ${g.bytes} B, ${g.latency} ms / ${g.queries} q; DataLoader ${d.latency} ms / ${d.queries} q; N=50 ${g50.latency} vs ${p50.latency} ms`);
  tipHas("api-fetch", lang => [
    `${s.trips} round trips`.replace("round trips", lang === "pt" ? "idas e voltas" : "round trips"),
    fmt(s.latency, 0, lang) + " ms",
    fmt(p.latency, 0, lang) + " ms",
    fmt(s.bytes / 1000, 1, lang) + " kB",
    Math.round(100 * s.unused / s.payload) + "%",
    fmt(g.bytes / 1000, 1, lang) + " kB",
    fmt(g.latency, 0, lang) + " ms",
    (lang === "pt" ? `${g.queries} consultas` : `${g.queries} DB queries`),
    (lang === "pt" ? `${d.queries} consultas` : `${d.queries} queries`),
    fmt(d.latency, 0, lang) + " ms",
    fmt(g50.latency, 0, lang) + " ms",
    fmt(p50.latency, 0, lang) + " ms"
  ]);
});
