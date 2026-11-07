import { load, test, ok, near, tipHas, fmt } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const M = load("slow-dependency");
const C = M.CFG;
const here = path.dirname(fileURLToPath(import.meta.url));
const page = readFileSync(path.join(here, "../../docs/2026.2/classes/reliability/patterns/index.md"), "utf8");
const run = o => M.run(o).summary;

/* a YAML key of the page's examples: "  key: value" */
function yaml(key) {
  const m = page.match(new RegExp("^\\s+" + key + ":\\s*([^\\s#]+)", "m"));
  if (!m) throw new Error(`the page has no ${key}`);
  return m[1];
}
const ms = v => /ms$/.test(v) ? parseFloat(v) : /s$/.test(v) ? parseFloat(v) * 1000 : +v;

test("the switches use the page's application.yaml (Feign timeouts, retry and breaker)", () => {
  near(ms(yaml("read-timeout")), C.readTimeout, 0, "read-timeout");
  near(+yaml("max-attempts"), C.attempts, 0, "max-attempts");
  near(ms(yaml("wait-duration")), C.waitMs, 0, "retry wait-duration");
  near(+yaml("exponential-backoff-multiplier"), C.mult, 0, "multiplier");
  near(+yaml("randomized-wait-factor"), C.jitter, 0, "randomized-wait-factor");
  near(+yaml("sliding-window-size"), C.window, 0, "sliding-window-size");
  near(+yaml("minimum-number-of-calls"), C.minCalls, 0, "minimum-number-of-calls");
  near(+yaml("failure-rate-threshold"), C.failRate, 0, "failure-rate-threshold");
  near(ms(yaml("slow-call-duration-threshold")), C.slowMs, 0, "slow-call-duration-threshold");
  near(+yaml("slow-call-rate-threshold"), C.slowRate, 0, "slow-call-rate-threshold");
  near(ms(yaml("wait-duration-in-open-state")), C.openMs, 0, "wait-duration-in-open-state");
  near(+yaml("permitted-number-of-calls-in-half-open-state"), C.probes, 0, "half-open probes");
  ok(C.slowMs < C.readTimeout, "the slow-call threshold sits below the timeout");
  ok(page.includes("ignore-exceptions:") && page.includes("CallNotPermittedException  # breaker open"), "an open breaker is not retried");
});

test("Little's law: steady state ≈ 60 × 50 ms + 40 × 20 ms threads; 60 × 3 s ≈ 180 while slow", () => {
  const n = run({});
  near(n.steadyBusy, C.postRate * C.normalMs / 1000 * Math.exp(0.045) + C.getRate * C.getMs / 1000, 0.5, "steady threads");
  near(n.busyAvg, 180, 10, "threads during the fault, no pattern");
  near(run({ timeout: true }).busyAvg, C.postRate * C.readTimeout / 1000, 3, "threads with the timeout");
});

test("the story: timeout frees threads, timeout + retry is worse than nothing, the breaker fails fast", () => {
  const none = run({}), to = run({ timeout: true }), tr = run({ timeout: true, retry: true }), all = run({ timeout: true, retry: true, breaker: true });
  ok(none.getOk < 100 && to.getOk === 100, "GET /orders: hurt without a timeout, intact with it");
  ok(to.postOk < 1, "with only a timeout every order fails after 1 s");
  ok(tr.getOk < none.getOk && tr.fullSeconds > none.fullSeconds, "the retry exhausts the pool more than no pattern");
  ok(tr.callsPerSec > 2 * C.postRate, "the retry multiplies the calls to product");
  ok(all.getOk === 100 && all.busyAvg < 5 && all.p95 < 5 && all.openAt < 3, "the breaker opens in seconds and orders fail in ms");
  ok(all.closedAt > C.faultTo / 1000 && all.closedAt < C.faultTo / 1000 + C.openMs / 1000, "it closes after product recovers, within one wait");
  const down = run({ fault: "down", timeout: true, retry: true });
  near(down.amplification, C.attempts, 0.1, "down: every order makes 3 attempts");
});

test("the tip quotes the model", () => {
  const none = run({}), to = run({ timeout: true }), tr = run({ timeout: true, retry: true });
  const allR = M.run({ timeout: true, retry: true, breaker: true }), all = allR.summary;
  const down = run({ fault: "down", timeout: true, retry: true });
  const probeAt = allR.events.filter(e => e.state === "half")[0].t / 1000;
  console.log(`       none ${none.busyAvg.toFixed(1)} busy, full ${none.fullSeconds} s, GET ${none.getOk.toFixed(2)}%; timeout ${to.busyAvg.toFixed(1)}; ` +
    `retry full ${tr.fullSeconds} s GET ${tr.getOk.toFixed(2)}% calls ${tr.callsPerSec.toFixed(1)}/s; breaker open +${all.openAt.toFixed(2)} s busy ${all.busyAvg.toFixed(2)} probe ${probeAt.toFixed(1)} closed ${all.closedAt.toFixed(2)}; down ×${down.amplification.toFixed(2)}`);
  ok(Math.floor(probeAt) === 41, "first probes at 41 s");
  tipHas("slow-dependency", lang => [
    fmt(none.busyAvg, 0, lang), String(none.fullSeconds), fmt(none.getOk, 1, lang) + "%",
    fmt(to.busyAvg, 0, lang), "100%",
    String(tr.fullSeconds), fmt(tr.getOk, 1, lang) + "%", fmt(tr.callsPerSec, 0, lang),
    fmt(all.openAt, 1, lang) + " s", fmt(all.busyAvg, 0, lang), fmt(all.closedAt, 1, lang) + " s",
    fmt(all.closedAt - C.faultTo / 1000, 1, lang) + " s", fmt(down.amplification, 1, lang)
  ]);
});
