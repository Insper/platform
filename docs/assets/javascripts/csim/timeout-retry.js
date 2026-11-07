/*
 * Slow or dead? Timeouts, retries and delivery semantics (2027.1, distributed systems — overview):
 *
 *   <div class="csim" data-sim="timeout-retry" data-timeout="2000" data-loss="5" data-policy="retry"></div>
 *
 * The gateway sends POST /orders for each of 200 fans' seat holds to order. Every attempt can meet
 * one of the four cases of the page: (a) the request is lost (or order crashed before writing), (c)
 * the reply is lost, (d) order is just slow — its latency is a mixture of a fast path (median 150 ms),
 * a slow path (median 600 ms, 10% of the calls) and garbage-collection pauses (1.5 to 4 s, 4%) — or
 * the reply arrives in time. The gateway waits `timeout` ms. The policy decides the delivery semantics:
 * "none" never retries (at most once: some holds get no order, some fans hear "failed" for an order
 * that exists); "retry" sends up to 3 attempts, backoff 200 ms then 400 ms (at least once: every
 * attempt that reaches order creates an order); "dedupe" retries and order keeps one order per hold
 * (lab 7's ON CONFLICT (hold_id) DO NOTHING), so the retries are harmless (effectively once).
 *
 * Each fan's world (loss draws and latencies of the 3 attempts) is seeded per fan, so moving the
 * timeout, the loss or the policy changes only the decisions, not the luck: the run is recomputed at
 * once. The player walks through the fans whose first attempt got no reply in time.
 * (The payment version, with lab 9's client settings, is idempotent-retry on the integrations page.)
 */
(function () {
  "use strict";

  var FANS = 200, ATTEMPTS = 3, BACKOFF = [200, 400];
  var DEFAULTS = { fans: FANS, timeout: 2000, loss: 5, policy: "retry", seed: 42 };

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function lognormal(rng, median, sigma) {
    var u = Math.max(rng(), 1e-12), v = rng();
    return median * Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
  }
  /* order's latency for one call, in ms */
  function latency(rng) {
    var u = rng();
    if (u < 0.04) return Math.round(1500 + rng() * 2500);          /* a GC pause */
    if (u < 0.14) return Math.round(lognormal(rng, 600, 0.35));     /* the slow path */
    return Math.round(lognormal(rng, 150, 0.35));                   /* the fast path */
  }
  /* the luck of fan i: for each attempt, two uniform draws (request, reply) and a latency */
  function world(seed, i) {
    var rng = mulberry32((seed * 7919 + i * 104729) >>> 0), out = [];
    for (var k = 0; k < ATTEMPTS; k++) out.push({ uReq: rng(), uRep: rng(), lat: latency(rng) });
    return out;
  }

  /* one fan: the attempts the policy allows, how many orders exist for the hold, what the fan hears */
  function call(w, o) {
    var t = 0, applied = 0, got = false, att = [], loss = o.loss / 100, max = o.policy === "none" ? 1 : ATTEMPTS;
    for (var k = 0; k < max; k++) {
      var d = w[k], reqLost = d.uReq < loss, repLost = d.uRep < loss;
      var reached = !reqLost, wrote = reached && !(o.policy === "dedupe" && applied > 0);
      if (wrote) applied++;
      var ok = reached && !repLost && d.lat <= o.timeout;
      var kind = reqLost ? "req" : d.lat > o.timeout ? "slow" : repLost ? "rep" : "ok";
      att.push({ start: t, lat: d.lat, kind: kind, reached: reached, wrote: wrote, deduped: reached && !wrote,
        end: t + (ok ? d.lat : o.timeout) });
      t = att[k].end;
      if (ok) { got = true; break; }
      if (k < max - 1) t += BACKOFF[k];
    }
    var outcome = applied > 1 ? "dup" : got ? "once" : applied ? "unknown" : "lost";
    return { att: att, applied: applied, got: got, wait: att[att.length - 1].end, outcome: outcome };
  }

  function quantile(sorted, q) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] : 0; }

  function run(opts) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = opts && opts[k] !== undefined ? opts[k] : DEFAULTS[k];
    var fans = [], st = { once: 0, dup: 0, unknown: 0, lost: 0, extra: 0, attempts: 0, retries: 0, slow: 0, rep: 0, req: 0 };
    for (var i = 0; i < o.fans; i++) {
      var f = call(world(o.seed, i), o);
      f.id = i + 1;
      fans.push(f);
      st[f.outcome]++;
      st.extra += Math.max(0, f.applied - 1);
      st.attempts += f.att.length;
      st.retries += f.att.length - 1;
      f.att.forEach(function (a) { if (a.kind !== "ok") st[a.kind]++; });
    }
    var waits = fans.map(function (f) { return f.wait; }).sort(function (a, b) { return a - b; });
    st.p50 = quantile(waits, 0.5); st.p99 = quantile(waits, 0.99);
    st.firstLat = fans.map(function (f) { return world(o.seed, f.id - 1)[0].lat; });
    return { o: o, fans: fans, st: st };
  }

  var API = { FANS: FANS, ATTEMPTS: ATTEMPTS, BACKOFF: BACKOFF, DEFAULTS: DEFAULTS, latency: latency, world: world, call: call, run: run, mulberry32: mulberry32 };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  function n(x) { return x.toLocaleString(PT ? "pt-BR" : "en-US"); }
  function secs(ms) { return ms >= 1000 ? (ms / 1000).toFixed(ms % 1000 ? 1 : 0).replace(".", PT ? "," : ".") + " s" : ms + " ms"; }

  C.style("timeout-retry", [
    ".md-typeset .csim-tr-win { fill: none; stroke: var(--c-fg3); stroke-dasharray: 4 3; }",
    ".md-typeset .csim-tr-axis { stroke: var(--c-line); }",
    ".md-typeset .csim-tr-to { stroke: var(--c-bad); stroke-width: 1.6; stroke-dasharray: 5 3; }",
    ".md-typeset .csim-tr-x { stroke: var(--c-bad); stroke-width: 2; }"
  ].join("\n"));

  C.register("timeout-retry", function (root) {
    var o = C.opts(root, { timeout: DEFAULTS.timeout, loss: DEFAULTS.loss, policy: DEFAULTS.policy });
    var cur, retried = [], sel = null;

    var svg = s("svg", { viewBox: "0 0 640 236", role: "img", "aria-label": t("Latency of order and one fan's attempts", "Latência do order e as tentativas de um fã") });
    var note = el("p", { class: "csim-note" });
    var log = C.log(4);
    var tiles = C.stats([
      { key: "once", label: t("exactly one order", "exatamente um pedido") },
      { key: "dup", label: t("two or more orders for one hold", "dois ou mais pedidos por hold") },
      { key: "unknown", label: t("told “failed”, but the order exists", "ouviram “falhou”, mas o pedido existe") },
      { key: "lost", label: t("no order at all", "nenhum pedido") },
      { key: "p99", label: t("fan's wait, p99", "espera do fã, p99") }
    ]);
    var sTimeout = C.slider({ label: t("gateway's timeout", "timeout do gateway"), min: 100, max: 5000, step: 100, value: o.timeout,
      fmt: secs, onInput: function () { recompute(true); } });
    var sLoss = C.slider({ label: t("messages lost", "mensagens perdidas"), min: 0, max: 20, step: 1, value: o.loss,
      fmt: function (v) { return v + "%"; }, onInput: function () { recompute(true); } });
    var cPolicy = C.choice({ label: t("on a timeout", "num timeout"), value: o.policy, options: [
      { value: "none", label: t("give up (at most once)", "desistir (no máximo uma vez)") },
      { value: "retry", label: t("retry (at least once)", "tentar de novo (pelo menos uma vez)") },
      { value: "dedupe", label: t("retry + dedupe by hold", "tentar + deduplicar por hold") }
    ], onChange: function () { recompute(true); } });
    var player = C.player({
      interval: 1600,
      onTick: function (k) { if (k > retried.length) return false; pick(retried[k - 1]); },
      onPrev: function (k) { if (k) pick(retried[k - 1]); else { sel = null; intro(); draw(); } },
      onReset: function () { sel = null; intro(); draw(); },
      label: function (k, total) { return t("fan without a timely reply ", "fã sem resposta a tempo ") + k + "/" + total; }
    });

    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    function policy() { return cPolicy.get(); }

    function recompute(keepSel) {
      cur = run({ timeout: sTimeout.get(), loss: sLoss.get(), policy: policy() });
      retried = cur.fans.filter(function (f) { return f.att[0].kind !== "ok"; });
      player.total(retried.length);
      if (player.count() > retried.length) player.jump(retried.length);
      if (keepSel && sel) { sel = cur.fans[sel.id - 1]; explain(sel); }
      else summary();
      draw();
    }
    function summary() {
      var st = cur.st, p = policy();
      if (p === "none") say(t("At most once: no hold gets two orders, but " + n(st.lost) + " fan(s) have no order at all and " + n(st.unknown) + " hear “failed” for an order that exists.",
        "No máximo uma vez: nenhum hold ganha dois pedidos, mas " + n(st.lost) + " fã(s) ficam sem pedido e " + n(st.unknown) + " ouvem “falhou” por um pedido que existe."), "warn");
      else if (p === "retry") say(t("At least once: every hold gets its order, but " + n(st.dup) + " get two or more — every retry after a lost reply or a slow-but-alive order wrote again.",
        "Pelo menos uma vez: todo hold ganha o seu pedido, mas " + n(st.dup) + " ganham dois ou mais — cada nova tentativa depois de uma resposta perdida ou de um order lento, mas vivo, gravou de novo."), st.dup ? "bad" : "ok");
      else say(t("Retries plus a receiver that keeps one order per hold: no duplicate; " + n(st.unknown) + " fan(s) still run out of attempts with an order that exists — ask order before saying “failed”.",
        "Novas tentativas e um receptor que guarda um pedido por hold: nenhuma duplicata; " + n(st.unknown) + " fã(s) ainda esgotam as tentativas com um pedido que existe — pergunte ao order antes de dizer “falhou”."), st.unknown ? "warn" : "ok");
    }
    function intro() { summary(); }
    var KIND = {
      req: [t("(a) request lost: order never saw it", "(a) requisição perdida: o order nunca a viu"), "warn"],
      rep: [t("(c) order wrote it, the reply was lost", "(c) o order gravou, a resposta se perdeu"), "bad"],
      slow: [t("(d) order wrote it, but slower than the timeout", "(d) o order gravou, mais lento que o timeout"), "bad"],
      ok: [t("reply in time", "resposta a tempo"), "ok"]
    };
    function explain(f) {
      log.clear();
      f.att.forEach(function (a, i) {
        var what = KIND[a.kind][0] + (a.wrote ? t(" · order written", " · pedido gravado") : a.deduped ? t(" · same hold: existing order returned", " · mesmo hold: pedido existente devolvido") : "");
        log.add(t("attempt ", "tentativa ") + (i + 1) + " @ " + secs(a.start) + ": " + what, a.kind === "ok" ? "ok" : a.wrote && i > 0 ? "bad" : a.kind === "req" ? "warn" : "");
      });
      var end = f.got ? t("the fan sees “order placed” after ", "o fã vê “pedido feito” depois de ") : t("the fan sees “something went wrong” after ", "o fã vê “algo deu errado” depois de ");
      say(t("Fan ", "Fã ") + f.id + ": " + f.att.length + t(" attempt(s), ", " tentativa(s), ") + f.applied + t(" order(s) for the hold; ", " pedido(s) para o hold; ") + end + secs(f.wait) + ".",
        f.applied > 1 ? "bad" : !f.got ? "warn" : "ok");
    }
    function pick(f) { sel = f; explain(f); draw(); }

    /* layout: histogram on the left, the selected fan's attempts on the right */
    var HX = 34, HW = 262, HY = 30, HH = 150, MAXL = 5000, BIN = 100;
    var GX = 330, GW = 300;

    function draw() {
      C.clear(svg);
      var T = cur.o.timeout, st = cur.st;
      /* histogram of first-attempt latency */
      var bins = [], maxc = 1, i;
      for (i = 0; i < MAXL / BIN; i++) bins.push(0);
      st.firstLat.forEach(function (l) { bins[Math.min(bins.length - 1, Math.floor(l / BIN))]++; });
      bins.forEach(function (c) { if (c > maxc) maxc = c; });
      var scale = function (c) { return Math.sqrt(c / maxc) * HH; };
      svg.appendChild(s("text", { x: HX, y: 14, class: "c-label" }, t("order's latency, 200 calls", "latência do order, 200 chamadas")));
      svg.appendChild(s("line", { x1: HX, y1: HY + HH, x2: HX + HW, y2: HY + HH, class: "csim-tr-axis" }));
      bins.forEach(function (c, j) {
        if (!c) return;
        var x = HX + j * HW / bins.length, h = Math.max(1.5, scale(c));
        svg.appendChild(s("rect", { x: x + 0.4, y: HY + HH - h, width: HW / bins.length - 0.8, height: h,
          class: (j + 1) * BIN <= T ? "c-fill-ink" : "c-fill-warn" }));
      });
      [0, 1000, 2000, 3000, 4000, 5000].forEach(function (v) {
        svg.appendChild(s("text", { x: HX + v / MAXL * HW, y: HY + HH + 13, "text-anchor": "middle", class: "c-small" }, v ? (v / 1000) + " s" : "0"));
      });
      var tx = HX + Math.min(T, MAXL) / MAXL * HW;
      svg.appendChild(s("line", { x1: tx, y1: HY - 4, x2: tx, y2: HY + HH, class: "csim-tr-to" }));
      svg.appendChild(s("text", { x: Math.min(tx + 4, HX + HW - 4), y: HY + 6, "text-anchor": tx > HX + HW - 70 ? "end" : "start", class: "c-small c-bad" }, "timeout " + secs(T)));
      var late = st.firstLat.filter(function (l) { return l > T; }).length;
      svg.appendChild(s("text", { x: HX, y: HY + HH + 30, class: "c-small" },
        t(late + " of 200 first calls outlive the timeout: order is alive and writing", late + " de 200 primeiras chamadas passam do timeout: o order está vivo e gravando")));
      svg.appendChild(s("text", { x: HX, y: HY + HH + 44, class: "c-small" },
        t("plus " + sLoss.get() + "% of requests and of replies lost on the way", "mais " + sLoss.get() + "% das requisições e das respostas perdidas no caminho")));

      /* the selected fan */
      svg.appendChild(s("text", { x: GX, y: 14, class: "c-label" }, sel ? t("fan ", "fã ") + sel.id + t(": gateway → order, attempt by attempt", ": gateway → order, tentativa por tentativa") : t("press play or → for the fans without a timely reply", "aperte play ou → para ver os fãs sem resposta a tempo")));
      tiles.set("once", n(st.once), "ok");
      tiles.set("dup", n(st.dup), st.dup ? "bad" : "ok");
      tiles.set("unknown", n(st.unknown), st.unknown ? "warn" : "");
      tiles.set("lost", n(st.lost), st.lost ? "warn" : "");
      tiles.set("p99", secs(st.p99), st.p99 > 3000 ? "warn" : "");
      if (!sel) return;
      var span = sel.att.reduce(function (m, a) { return Math.max(m, a.start + Math.max(T, a.reached ? a.lat : 0)); }, sel.wait) * 1.04, X = function (ms) { return GX + 60 + ms / span * (GW - 64); };
      sel.att.forEach(function (a, k) {
        var y = 34 + k * 52;
        svg.appendChild(s("text", { x: GX, y: y + 12, class: "c-small" }, t("attempt ", "tentativa ") + (k + 1)));
        svg.appendChild(s("rect", { x: X(a.start), y: y, width: X(a.start + T) - X(a.start), height: 18, rx: 3, class: "csim-tr-win" }));
        if (a.reached) {
          var w = X(a.start + Math.min(a.lat, span - a.start)) - X(a.start);
          svg.appendChild(s("rect", { x: X(a.start), y: y + 4, width: Math.max(2, w), height: 10, rx: 2,
            class: a.kind === "ok" ? "c-fill-ok" : a.wrote ? "c-fill-bad" : "c-fill-mute" }));
        } else {
          var xx = X(a.start) + 8;
          svg.appendChild(s("path", { d: "M" + (xx - 5) + "," + (y + 4) + " l10,10 m0,-10 l-10,10", class: "csim-tr-x" }));
        }
        var lbl = KIND[a.kind][0] + (a.wrote ? t(" · written", " · gravou") : a.deduped ? t(" · deduped", " · deduplicado") : "");
        svg.appendChild(s("text", { x: GX + 60, y: y + 32, class: "c-small" + (KIND[a.kind][1] === "bad" ? " c-bad" : KIND[a.kind][1] === "ok" ? " c-ok" : " c-warn") }, lbl));
      });
      svg.appendChild(s("text", { x: GX, y: 34 + ATTEMPTS * 52 + 4, class: "c-small" },
        t("dashed: timeout window · bar: order working · ✗: request lost", "tracejado: janela do timeout · barra: order trabalhando · ✗: perdida")));

    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("Slow or dead? 200 seat holds become orders through a network that loses messages",
        "Lento ou morto? 200 holds de assento viram pedidos por uma rede que perde mensagens") }),
      el("p", { class: "csim-sub", text: t("The gateway sends POST /orders and waits up to the timeout; the policy decides what happens then (3 attempts at most). Move the knobs: the counters are recomputed for the same 200 fans and the same luck.",
        "O gateway envia POST /orders e espera até o timeout; a política decide o que acontece então (no máximo 3 tentativas). Mexa nos controles: os contadores são recalculados para os mesmos 200 fãs e a mesma sorte.") }),
      el("div", { class: "csim-row" }, [sTimeout, sLoss]),
      el("div", { class: "csim-row" }, [cPolicy]),
      el("div", { class: "csim-stage" }, svg),
      note,
      player,
      el("div", { class: "csim-cols" }, [tiles, log])
    ]);
    recompute(false);
    return {};
  });
})();
