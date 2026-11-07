import { load, test, eq, ok, tipHas, fmt } from "./lib.mjs";

const M = load("timeout-retry");

test("the latency mixture: fast path around 150 ms, a slow tail, GC pauses up to 4 s", () => {
  const rng = M.mulberry32(1), xs = [];
  for (let i = 0; i < 20000; i++) xs.push(M.latency(rng));
  xs.sort((a, b) => a - b);
  const q = p => xs[Math.floor(p * xs.length)];
  ok(q(0.5) > 130 && q(0.5) < 200, "median " + q(0.5));
  ok(q(0.9) > 300 && q(0.9) < 900, "p90 " + q(0.9));
  ok(xs[xs.length - 1] <= 4000, "max " + xs[xs.length - 1]);
});

test("the four cases under each policy", () => {
  const T = 2000, base = { uReq: 1, uRep: 1, lat: 100 };
  const lostReply = [{ ...base, uRep: 0 }, base, base], lostReq = [{ ...base, uReq: 0 }, base, base], slow = [{ ...base, lat: 2500 }, base, base];
  const r = (w, policy) => M.call(w, { timeout: T, loss: 5, policy });
  eq([r(lostReply, "retry").att.length, r(lostReply, "retry").applied, r(lostReply, "retry").outcome], [2, 2, "dup"], "(c), at least once");
  eq(r(lostReply, "retry").wait, T + M.BACKOFF[0] + 100, "timeout + backoff + the second call");
  eq([r(lostReply, "dedupe").applied, r(lostReply, "dedupe").att[1].deduped, r(lostReply, "dedupe").outcome], [1, true, "once"], "(c), deduped");
  eq(r(lostReply, "none").outcome, "unknown", "(c), at most once: told failed, the order exists");
  eq(r(lostReq, "none").outcome, "lost", "(a), at most once: no order");
  eq([r(lostReq, "retry").applied, r(lostReq, "retry").outcome], [1, "once"], "(a): the retry is the only write");
  eq([r(slow, "retry").att[0].kind, r(slow, "retry").applied], ["slow", 2], "(d): slow but alive");
});

test("the same luck for every setting: the knobs change only the decisions", () => {
  eq(M.run({ timeout: 300 }).st.firstLat, M.run({ timeout: 5000 }).st.firstLat, "same latencies");
  for (const timeout of [300, 2000, 5000]) eq(M.run({ timeout, policy: "dedupe" }).st.dup, 0, "no duplicate with dedupe at " + timeout);
  eq(M.run({ loss: 0, timeout: 5000 }).st.dup, 0, "nothing lost and a timeout above every pause: no duplicate");
  const g = [300, 2000, 5000].map(timeout => M.run({ timeout, policy: "none" }).st);
  ok(g.every(x => x.dup === 0 && x.lost === g[0].lost), "giving up never duplicates; lost requests do not depend on the timeout");
});

test("the tip", () => {
  const d = M.run({}), long = M.run({ timeout: 5000 }), short = M.run({ timeout: 300 });
  const none = M.run({ policy: "none" }), dedShort = M.run({ timeout: 300, policy: "dedupe" });
  const late = d.st.firstLat.filter(l => l > 2000).length;
  const s = (ms, lang) => fmt(ms / 1000, 1, lang) + " s";
  ok(long.st.dup < d.st.dup && d.st.dup < short.st.dup && long.st.dup > 0, "a shorter timeout duplicates more; a long one does not cure lost replies");
  tipHas("timeout-retry", lang => lang === "en"
    ? [`${late} of the 200 first calls`, `${d.st.dup} holds get two orders, out of ${d.st.retries} retries`, `drop to ${long.st.dup}`,
       `from ${s(d.st.p99, lang)} to ${s(long.st.p99, lang)}`, `${short.st.dup} holds get two orders`,
       `${none.st.lost} fans have no order at all and ${none.st.unknown} hear`, `at 300 ms ${dedShort.st.unknown} fans still run out of attempts`]
    : [`${late} das 200 primeiras chamadas`, `${d.st.dup} holds ganham dois pedidos, em ${d.st.retries} retentativas`, `caem para ${long.st.dup}`,
       `de ${s(d.st.p99, lang)} para ${s(long.st.p99, lang)}`, `${short.st.dup} holds ganham dois pedidos`,
       `${none.st.lost} fãs ficam sem pedido nenhum e ${none.st.unknown} ouvem`, `com 300 ms, ${dedShort.st.unknown} fãs ainda esgotam as tentativas`]);
});
