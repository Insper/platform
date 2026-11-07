import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, near, tipHas, ROOT } from "./lib.mjs";

const M = load("http-versions");
const page = readFileSync(path.join(ROOT, "docs/2027.1/classes/edge/protocols/index.md"), "utf8");
const ms = x => Math.round(x * 1000);
const SER = 1e-4 * M.CALLS * M.PKTS;   /* the serialization of all packets, at most */

test("the round trips before the first request match the page's chart", () => {
  ok(page.includes('"TCP + TLS 1.2": 1 + 2 + 1') && page.includes('"TCP + TLS 1.3": 1 + 1 + 1') && page.includes('"QUIC (HTTP/3)": 1 + 1'), "the chart's stacks");
  eq(M.SETUP, { h1new: 1 + 2, h1ka: 1 + 1, h2: 1 + 1, h3: 1 }, "handshakes: the chart minus the request's own round trip");
});

test("no loss: 30 calls cost round trips only, as the Think first counts them", () => {
  const rtt = 150, r = M.all({ rtt, loss: 0, seed: 3 });
  near(r.h1new.end, (M.CALLS / M.PARALLEL) * 4 * rtt / 1000, 0.002, "5 batches × 4 RTT ≈ 3 s");
  near(r.h1ka.end, (2 + M.CALLS / M.PARALLEL) * rtt / 1000, 0.002, "2 RTT + 5 requests in turn");
  near(r.h2.end, 3 * rtt / 1000, SER + 1e-9, "1 handshake + 1 RTT");
  near(r.h3.end, 2 * rtt / 1000, SER + 1e-9, "QUIC: 2 RTT");
  ok(page.includes("means 5 batches") && page.includes("≈ **3 seconds**") && page.includes("300–450 ms"), "the page's numbers");
  for (const l of M.LANES) eq(r[l].blocked, 0, `${l}: nobody blocked without loss`);
});

test("every stack loses the same packets", () => {
  for (const seed of [1, 2, 3, 9]) {
    const r = M.all({ rtt: 100, loss: 5, seed });
    const lost = l => r[l].calls.map(c => c.lostPkts).join(",");
    eq(new Set(M.LANES.map(lost)).size, 1, `seed ${seed}`);
  }
});

test("head-of-line blocking: TCP multiplexing makes every later call wait, QUIC only the one that lost", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = M.all({ rtt: 150, loss: 2, seed });
    ok(r.h2.lost > 0, `seed ${seed} loses something`);
    eq(r.h3.blocked, 0, `seed ${seed}: QUIC blocks nobody else`);
    eq(r.h1new.blocked + r.h1ka.blocked, 0, `seed ${seed}: one response at a time per connection`);
    ok(r.h2.blocked > M.CALLS / 2, `seed ${seed}: HTTP/2 blocks most calls (${r.h2.blocked})`);
    ok(r.h2.half - r.h3.half > 0.15 * 1.5, `seed ${seed}: half the calls back much later on HTTP/2`);
    r.h3.calls.forEach(c => ok(c.lostPkts || Math.abs(c.done - r.h3.calls[0].ready - 0.15) < SER + 1e-9, `seed ${seed}: an unlucky-free QUIC call ends one RTT after its request`));
  }
});

test("a lost packet costs one round trip", () => {
  const r = M.simulate("h3", { rtt: 100, loss: 100, seed: 1 });
  near(r.end, 0.1 + 0.1 + 0.1, SER + 1e-9, "every packet lost: QUIC ends 1 RTT later");
});

test("the tip", () => {
  const a = M.all({ rtt: 150, loss: 0, seed: 3 }), b = M.all({ rtt: 150, loss: 2, seed: 3 }), c = M.all({ rtt: 10, loss: 0, seed: 3 });
  const s = (x, lang) => { const v = ms(x); return v >= 1000 ? (lang === "pt" ? (v / 1000).toFixed(2).replace(".", ",") : (v / 1000).toFixed(2)) + " s" : v + " ms"; };
  tipHas("http-versions", lang => [
    s(a.h1new.end, lang), s(a.h1ka.end, lang), s(a.h2.end, lang), s(a.h3.end, lang),
    s(b.h2.end, lang), s(b.h3.end, lang), s(b.h2.half, lang), s(b.h3.half, lang), String(b.h2.blocked),
    s(c.h1new.end, lang), s(c.h2.end, lang)
  ]);
});
