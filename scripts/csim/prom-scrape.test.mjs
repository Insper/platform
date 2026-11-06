import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, near, tipHas, fmt, ROOT } from "./lib.mjs";

const M = load("prom-scrape");
const LAB = "docs/2026.2/hands-on/6";
const read = f => readFileSync(path.join(ROOT, LAB, f), "utf8");
const after = (o, secs, f) => { const st = M.create(o); M.run(st, secs); if (f) f(st); return st; };

test("the jobs are the lab's prometheus.yml", () => {
  const y = read("prometheus/index.md");
  for (const j of M.JOBS) {
    const block = y.slice(y.indexOf(`job_name: '${j.job}'`)).split("job_name:")[1];
    ok(block, `job ${j.job}`);
    ok(block.includes(`metrics_path: '${j.path}'`), `${j.job}: metrics_path`);
    ok(block.includes(`- ${j.target}`), `${j.job}: target`);
    ok(block.includes(`scrape_interval: ${M.INTERVAL}s`), `${j.job}: scrape_interval`);
    ok(block.includes(`application: '${j.app}'`), `${j.job}: label`);
  }
});

test("every metrics_path is the service's base-path + /prometheus", () => {
  const ms = read("microservices/index.md");
  for (const j of M.JOBS) ok(ms.includes(`base-path: ${j.path.replace("/prometheus", "")}`), `${j.svc}: base-path`);
});

test("rate(): the scrapes count, then the traffic", () => {
  const idle = after({ load: 0 }, 90), busy = after({ load: 10 }, 90), login = after({ load: 10, route: "login" }, 90);
  eq(["gateway", "auth", "account"].map(s => M.rateOf(idle, s, 60)), [1, 1, 1], "idle: one scrape per second");
  eq(["gateway", "auth", "account"].map(s => M.rateOf(busy, s, 60)), [11, 11, 11], "10 req/s + the scrape");
  eq(["gateway", "auth", "account"].map(s => M.rateOf(login, s, 60)), [11, 11, 1], "a login never reaches account");
});

test("the window needs two samples: 4 × the scrape_interval", () => {
  eq(M.rateOf(after({ load: 10, interval: 15 }, 300), "gateway", 5), null, "[5s] at 15s: empty");
  near(M.rateOf(after({ load: 10, interval: 15 }, 300), "gateway", 60), 10 + 1 / 15, 1e-9, "[1m] at 15s");
  eq(M.rateOf(after({ load: 10, interval: 60 }, 300), "gateway", 60), null, "[1m] at 1m: empty");
  near(M.rateOf(after({ load: 10, interval: 60 }, 300), "gateway", 300), 10 + 1 / 60, 0.01, "[5m] at 1m");
});

test("a stopped service: up 0, its rate fades, a restart resets the counter", () => {
  const st = after({ load: 10 }, 90, s => M.stop(s, "account"));
  const r = M.tick(st).find(x => x.job === "AccountMetrics");
  eq([r.code, M.up(st, "account")], [0, 0], "up = 0");
  ok(r.err.includes("no such host"), "the name does not resolve");
  eq(M.rateOf(st, "auth", 60), 11, "auth still counts");
  M.run(st, 61);
  eq(M.rateOf(st, "account", 60), null, "no sample left in the window");
  M.start(st, "account"); M.run(st, 61);
  eq(M.rateOf(st, "account", 60), 11, "back, from a counter at 0");
});

test("a wrong metrics_path: 404, up 0", () => {
  const st = after({ load: 10 }, 5, s => M.breakPath(s, "auth", true));
  const r = M.tick(st).find(x => x.job === "AuthMetrics");
  eq([r.code, M.up(st, "auth")], [404, 0], "404");
});

test("extrapolation as Prometheus: a counter reset is added back", () => {
  /* 15 - 100 + 110 (the reset) = 25 over 30 s of samples, extrapolated 10 s back to the window start */
  const v = M.rate([[10, 100], [20, 110], [30, 5], [40, 15]], 40, 40);
  near(v, 25 * (40 / 30) / 40, 1e-12, "extrapolated rate");
  ok(v > 0, "never negative after a reset");
});

test("the tips", () => {
  const busy = after({ load: 10 }, 90);
  tipHas("prom-scrape", lang => [
    lang === "en" ? "rate is 1, not 0" : "o rate é 1, não 0",
    "10 req/s", fmt(M.rateOf(busy, "gateway", 60), 0, lang),
    "[5s]", "15s", "up = 0", "404"]);
});
