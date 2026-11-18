/*
 * Retries and dead letters: blocking in place, retry topics, or forever (2027.1, class 8 — delivery semantics):
 *
 *   <div class="csim" data-sim="retry-topics" data-strategy="blocking" data-failure="transient"></div>
 *
 * One partition of order-events receives a record every 0.5 s; the consumer takes LAB.emailMs per
 * record (lab 7's simulated e-mail latency). The record OrderConfirmed o-1005 fails: "transient" fails
 * every attempt that starts in its first 2 s, "poison" fails forever. One second after it, the same key
 * brings OrderCancelled o-1005.
 *
 *   - blocking: lab 7's DefaultErrorHandler — retry in place after LAB.backoffMs, × LAB.multiplier, at
 *     most LAB.retries times, then the dead-letter topic; the partition waits meanwhile;
 *   - topics: @RetryableTopic of the class page — the failed record goes to retry topics with delays of
 *     1 s, 4 s and 16 s, then to the DLT; the main partition never waits;
 *   - forever: blocking with no limit (the backoff stops growing at LAB.maxBackoffMs).
 *
 * "classify" sends a poison record (a non-retryable exception) straight to the DLT, as lab 7 does with
 * IllegalArgumentException. Times are integer milliseconds; the run is deterministic.
 */
(function () {
  "use strict";

  var LAB = { emailMs: 50, backoffMs: 500, multiplier: 2, retries: 3, maxBackoffMs: 5000 };
  var EVERY = 500, HORIZON = 30000, BAD = 8, SAME = 10, TRANSIENT = 2000;
  var TOPIC_DELAYS = [1000, 4000, 16000];          /* @RetryableTopic(attempts = "4", delay 1 s, multiplier 4) */
  var DLT = "order-events-dlt";

  function topicName(k) { return "order-events-retry-" + k; }
  function records() {
    var out = [];
    for (var i = 0; i * EVERY <= HORIZON; i++) {
      var id = "o-" + (1001 + i - (i > SAME ? 1 : 0));
      var r = { i: i, arrive: i * EVERY, key: id, type: i % 2 ? "OrderConfirmed" : "OrderPlaced", attempts: [], waits: 0 };
      if (i === BAD) { r.key = "o-1005"; r.type = "OrderConfirmed"; r.bad = true; }
      if (i === SAME) { r.key = "o-1005"; r.type = "OrderCancelled"; }
      out.push(r);
    }
    return out;
  }
  /* the backoff before retry k (1-based) of the blocking handler */
  function backoff(k) { return Math.min(LAB.maxBackoffMs, LAB.backoffMs * Math.pow(LAB.multiplier, k - 1)); }

  /*
   * o: {strategy: "blocking" | "topics" | "forever", failure: "transient" | "poison", classify: bool}
   * Each record gets: attempts [{t, ok, where}], committed (when the main partition moved past it),
   * done (when its effect happened) and route ("ok" | "dlt" | null), parked [{topic, from, to}].
   */
  function simulate(o) {
    var recs = records(), S = LAB.emailMs, free = 0;
    function fails(r, t) { return !!r.bad && (o.failure === "poison" || t < r.arrive + TRANSIENT); }
    function permanent(r) { return o.classify && r.bad && o.failure === "poison"; }
    recs.forEach(function (r) {
      var t = Math.max(free, r.arrive);
      r.start = t;
      if (t >= HORIZON) { r.committed = null; return; }
      var ok = !fails(r, t);
      r.attempts.push({ t: t, ok: ok, where: "order-events" });
      t += S;
      r.parked = [];
      if (ok) { r.done = t; r.route = "ok"; r.committed = t; free = t; return; }
      if (permanent(r)) { r.done = t; r.route = "dlt"; r.committed = t; free = t; return; }
      if (o.strategy === "topics") {
        r.committed = t; free = t;          /* the main partition moves on at once */
        for (var k = 0; k < TOPIC_DELAYS.length; k++) {
          var due = t + TOPIC_DELAYS[k];
          r.parked.push({ topic: topicName(k), from: t, to: due });
          t = due;
          ok = !fails(r, t);
          r.attempts.push({ t: t, ok: ok, where: topicName(k) });
          t += S;
          if (ok) { r.done = t; r.route = "ok"; return; }
        }
        r.done = t; r.route = "dlt";
        return;
      }
      /* blocking, in place: the partition waits */
      for (var n = 1; o.strategy === "forever" || n <= LAB.retries; n++) {
        var w = backoff(n);
        if (t + w >= HORIZON) { r.waits += HORIZON - t; r.parked.push({ topic: "backoff", from: t, to: HORIZON }); r.done = null; r.route = null; r.committed = null; free = Infinity; return; }
        r.parked.push({ topic: "backoff", from: t, to: t + w });
        r.waits += w; t += w;
        ok = !fails(r, t);
        r.attempts.push({ t: t, ok: ok, where: "order-events" });
        t += S;
        if (ok) { r.done = t; r.route = "ok"; r.committed = t; free = t; return; }
      }
      r.done = t; r.route = "dlt"; r.committed = t; free = t;
    });
    return { o: o, recs: recs };
  }

  /* records of the main partition arrived by t and not yet committed */
  function lagAt(sim, t) {
    var n = 0;
    sim.recs.forEach(function (r) { if (r.arrive <= t && (r.committed === null || r.committed === undefined || r.committed > t)) n++; });
    return n;
  }

  /* the highest lag in the window (from, to], sampled every 10 ms */
  function peakLag(sim, from, to) {
    var m = 0;
    for (var t = Math.max(0, from + 10); t <= to; t += 10) m = Math.max(m, lagAt(sim, t));
    return m;
  }

  function outcome(o) {
    var sim = simulate(o), bad = sim.recs[BAD], same = sim.recs[SAME], maxLag = 0;
    for (var t = 0; t <= HORIZON; t += 10) maxLag = Math.max(maxLag, lagAt(sim, t));
    var stall = 0;
    sim.recs.forEach(function (r) { stall += r.waits; });
    /* out of order: the later record of the key took effect before the failing one did */
    var reordered = bad.route === "ok" && same.route === "ok" && same.done < bad.done;
    return {
      stall: stall, maxLag: maxLag, lagEnd: lagAt(sim, HORIZON), attempts: bad.attempts.length,
      route: bad.route, badDone: bad.done, sameDone: same.done === undefined ? null : same.done,
      reordered: reordered, lead: reordered && bad.done ? bad.done - same.done : 0,
      dlt: sim.recs.filter(function (r) { return r.route === "dlt"; }).length
    };
  }

  /* what happened at each instant, for the log: [{t, kind, i, ...}] in time order */
  function events(sim) {
    var out = [];
    sim.recs.forEach(function (r) {
      if (!r.bad && r.i !== SAME) return;
      r.attempts.forEach(function (a, k) { out.push({ t: a.t + LAB.emailMs, kind: a.ok ? "ok" : "fail", i: r.i, n: k + 1, where: a.where }); });
      (r.parked || []).forEach(function (p) { out.push({ t: p.from, kind: p.topic === "backoff" ? "wait" : "park", i: r.i, topic: p.topic, ms: p.to - p.from }); });
      if (r.route === "dlt") out.push({ t: r.done, kind: "dlt", i: r.i });
    });
    out.sort(function (a, b) { return a.t - b.t || (a.kind === "fail" ? -1 : 1); });
    return out;
  }

  var API = { LAB: LAB, EVERY: EVERY, HORIZON: HORIZON, BAD: BAD, SAME: SAME, TRANSIENT: TRANSIENT, TOPIC_DELAYS: TOPIC_DELAYS,
    records: records, backoff: backoff, simulate: simulate, lagAt: lagAt, peakLag: peakLag, outcome: outcome, events: events };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  var TICK = 250;
  function sec(ms) { var v = String(Math.round(ms / 10) / 100); return (PT ? v.replace(".", ",") : v) + " s"; }

  C.style("retry-topics", [
    ".md-typeset .csim-rt-cell { stroke-width: 1; }",
    ".md-typeset .csim-rt-cell.done { fill: var(--c-tint2); stroke: var(--c-ink); }",
    ".md-typeset .csim-rt-cell.wait { fill: var(--c-bg); stroke: var(--c-warn); stroke-dasharray: 3 2; }",
    ".md-typeset .csim-rt-cell.bad { fill: color-mix(in srgb, var(--c-bad) 18%, var(--c-bg)); stroke: var(--c-bad); stroke-width: 1.6; }",
    ".md-typeset .csim-rt-cell.same { stroke: var(--c-accent); stroke-width: 2; }",
    ".md-typeset .csim-rt-lane { fill: none; stroke: var(--c-line); stroke-dasharray: 5 4; }"
  ].join("\n"));

  C.register("retry-topics", function (root) {
    var o = C.opts(root, { strategy: "blocking", failure: "transient", classify: true });
    var plan = { strategy: o.strategy, failure: o.failure, classify: o.classify };
    var sim, evs, now = 0, shown = 0;

    var svg = s("svg", { viewBox: "0 0 640 236", role: "img", "aria-label": t("A partition, its retry topics and the dead-letter topic", "Uma partição, seus tópicos de retry e o tópico de dead letter") });
    var note = el("p", { class: "csim-note" });
    var lg = C.log(6);
    var chart = C.chart({ title: t("lag of the main partition (records)", "atraso da partição principal (registros)"), len: HORIZON / TICK + 1,
      series: [{ label: t("peak lag in each 0.25 s", "pico de atraso a cada 0,25 s"), cls: "tone-warn" }] });
    var tiles = C.stats([
      { key: "stall", label: t("partition stopped", "partição parada") },
      { key: "lag", label: t("max lag", "atraso máximo") },
      { key: "bad", label: "OrderConfirmed o-1005" },
      { key: "order", label: t("o-1005 in order?", "o-1005 em ordem?") }
    ]);
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    function label(r) { return r.type + " " + r.key; }

    function describe(e) {
      var r = sim.recs[e.i], name = label(r);
      switch (e.kind) {
        case "fail": return [t(name + ": attempt " + e.n + " fails (" + e.where + ")", name + ": tentativa " + e.n + " falha (" + e.where + ")"), "bad"];
        case "ok": return [t(name + ": attempt " + e.n + " succeeds — e-mail sent", name + ": tentativa " + e.n + " dá certo — e-mail enviado"), e.i === SAME && sim.recs[BAD].done > e.t ? "warn" : "ok"];
        case "wait": return [t("the partition waits " + sec(e.ms) + " (backoff in place)", "a partição espera " + sec(e.ms) + " (backoff no lugar)"), "warn"];
        case "park": return [t(name + " → " + e.topic + " (due in " + sec(e.ms) + "); order-events moves on", name + " → " + e.topic + " (volta em " + sec(e.ms) + "); order-events segue"), "info"];
        default: return [t(name + " → " + DLT + " (with the exception in the headers)", name + " → " + DLT + " (com a exceção nos cabeçalhos)"), "warn"];
      }
    }

    function finalNote() {
      var r = outcome(plan);
      if (plan.strategy === "forever" && r.route === null) return [t("Retry forever: the poison record never leaves the head of the partition. " + r.lagEnd + " records wait behind it after 30 s, and the lag only grows — the pitfall of infinite retries.",
        "Retry para sempre: o registro venenoso nunca sai da cabeça da partição. " + r.lagEnd + " registros esperam atrás dele depois de 30 s e o atraso só cresce — a armadilha dos retries infinitos."), "bad"];
      if (r.reordered) return [t("Retry topics: the partition never stopped (max lag " + r.maxLag + "), but OrderCancelled o-1005 was applied " + sec(r.lead) + " before OrderConfirmed o-1005: the fan gets \"cancelled\", then \"confirmed\".",
        "Tópicos de retry: a partição nunca parou (atraso máximo " + r.maxLag + "), mas OrderCancelled o-1005 foi aplicado " + sec(r.lead) + " antes de OrderConfirmed o-1005: o fã recebe \"cancelado\" e depois \"confirmado\"."), "bad"];
      if (r.route === "dlt") return [t("o-1005 ended in " + DLT + " after " + r.attempts + " attempt(s); the partition stopped for " + sec(r.stall) + " and the stream kept flowing. Someone must alert on the DLT, fix the cause and redrive it.",
        "o-1005 terminou em " + DLT + " depois de " + r.attempts + " tentativa(s); a partição ficou parada " + sec(r.stall) + " e o fluxo seguiu. Alguém precisa alertar sobre a DLT, corrigir a causa e reenviá-la."), "warn"];
      return [t("Blocking retries: o-1005 succeeded at attempt " + r.attempts + ", the partition stopped for " + sec(r.stall) + " (lag up to " + r.maxLag + "), and OrderCancelled came after OrderConfirmed: the order of the key is kept.",
        "Retries bloqueantes: o-1005 deu certo na tentativa " + r.attempts + ", a partição ficou parada " + sec(r.stall) + " (atraso até " + r.maxLag + ") e OrderCancelled veio depois de OrderConfirmed: a ordem da chave é mantida."), "ok"];
    }

    var X0 = 112, CW = 30, NCELL = 13;
    function cellState(r) {
      if (r.committed !== null && r.committed !== undefined && r.committed <= now) return "done";
      return "wait";
    }
    function draw() {
      C.clear(svg);
      var bad = sim.recs[BAD];
      svg.appendChild(s("text", { x: 4, y: 14, class: "c-small" }, t("order-events · one partition · a record every 0.5 s", "order-events · uma partição · um registro a cada 0,5 s")));
      /* main lane: the last NCELL records that have arrived */
      var all = sim.recs.filter(function (r) { return r.arrive <= now; }), arrived = all.slice(-NCELL);
      /* the head of the partition (the oldest record not committed) stays in view, after a gap */
      var head = all.filter(function (r) { return cellState(r) === "wait"; })[0];
      if (head && arrived.indexOf(head) < 0) {
        arrived = [head, null].concat(all.slice(-(NCELL - 2)));
      }
      svg.appendChild(s("text", { x: 4, y: 42, class: "c-label" }, "order-events"));
      svg.appendChild(s("line", { x1: X0, y1: 52, x2: X0 + NCELL * CW, y2: 52, class: "csim-rt-lane" }));
      arrived.forEach(function (r, j) {
        var x = X0 + j * CW;
        if (!r) { svg.appendChild(s("text", { x: x + (CW - 4) / 2, y: 41, "text-anchor": "middle", class: "c-small" }, "…")); return; }
        var st = cellState(r);
        var cls = "csim-rt-cell " + (r.bad && st !== "done" ? "bad" : st) + (r.key === "o-1005" ? " same" : "");
        svg.appendChild(s("rect", { x: x, y: 26, width: CW - 4, height: 22, rx: 3, class: cls }));
        svg.appendChild(s("text", { x: x + (CW - 4) / 2, y: 41, "text-anchor": "middle", class: "c-small c-mono" }, r.key.slice(2)));
      });
      /* consumer */
      var busy = bad.parked && bad.parked.filter(function (p) { return p.topic === "backoff" && p.from <= now && (now < p.to || p.to >= HORIZON); })[0];
      var cx = X0 + NCELL * CW + 10;
      svg.appendChild(s("rect", { x: cx, y: 22, width: 640 - cx - 4, height: 32, rx: 6, class: "c-box " + (busy ? "warn" : "on") }));
      svg.appendChild(s("text", { x: cx + 6, y: 36, class: "c-label" }, "notification"));
      svg.appendChild(s("text", { x: cx + 6, y: 49, class: "c-small" }, busy ? t("backoff: waits", "backoff: espera") : t("reading", "lendo")));
      /* retry lanes */
      var lanes = plan.strategy === "topics" ? [0, 1, 2].map(function (k) { return { name: topicName(k), sub: sec(TOPIC_DELAYS[k]) }; })
        : [{ name: t("in place (backoff)", "no lugar (backoff)"), sub: plan.strategy === "forever" ? t("no limit", "sem limite") : [1, 2, 3].slice(0, LAB.retries).map(function (k) { return sec(backoff(k)); }).join(", ") }];
      lanes.forEach(function (ln, k) {
        var y = 76 + k * 30;
        svg.appendChild(s("text", { x: 4, y: y + 14, class: "c-label" }, ln.name));
        svg.appendChild(s("text", { x: 636, y: y + 14, "text-anchor": "end", class: "c-small" }, ln.sub));
        svg.appendChild(s("line", { x1: 200, y1: y + 18, x2: 560, y2: y + 18, class: "csim-rt-lane" }));
        var p = (bad.parked || []).filter(function (q) { return q.from <= now && (now < q.to || q.to >= HORIZON) && (plan.strategy === "topics" ? q.topic === topicName(k) : q.topic === "backoff"); })[0];
        if (p) {
          var f = (now - p.from) / (p.to - p.from);
          svg.appendChild(s("rect", { x: 200 + f * 330, y: y + 2, width: 30, height: 20, rx: 3, class: "csim-rt-cell bad same" }));
          svg.appendChild(s("text", { x: 215 + f * 330, y: y + 16, "text-anchor": "middle", class: "c-small c-mono" }, "1005"));
        }
      });
      /* DLT */
      var yd = 76 + lanes.length * 30 + 6, inDlt = bad.route === "dlt" && bad.done <= now;
      svg.appendChild(s("rect", { x: 4, y: yd, width: 632, height: 26, rx: 6, class: "c-box " + (inDlt ? "warn" : "down") }));
      svg.appendChild(s("text", { x: 12, y: yd + 17, class: "c-label" }, DLT));
      svg.appendChild(s("text", { x: 628, y: yd + 17, "text-anchor": "end", class: "c-small c-mono" }, inDlt ? "OrderConfirmed o-1005" : t("(empty)", "(vazio)")));
      /* the fan's e-mails for o-1005, in the order they were sent */
      var ye = yd + 44, mails = [];
      [bad, sim.recs[SAME]].forEach(function (r) { if (r.route === "ok" && r.done <= now) mails.push(r); });
      mails.sort(function (a, b) { return a.done - b.done; });
      svg.appendChild(s("text", { x: 4, y: ye, class: "c-small" }, t("e-mails of o-1005, in the order the fan gets them:", "e-mails do o-1005, na ordem em que o fã recebe:")));
      mails.forEach(function (r, j) {
        var wrong = r.i === SAME && (bad.route === "ok" ? bad.done > r.done : false);
        svg.appendChild(s("rect", { x: 250 + j * 190, y: ye - 14, width: 180, height: 20, rx: 4, class: "c-box " + (wrong ? "bad" : "ok") }));
        svg.appendChild(s("text", { x: 340 + j * 190, y: ye, "text-anchor": "middle", class: "c-small" }, (j + 1) + ". " + r.type.replace("Order", "") + " · " + sec(r.done)));
      });
      /* tiles, from the run up to now */
      var stallNow = 0, maxNow = 0;
      sim.recs.forEach(function (x) { (x.parked || []).forEach(function (p) { if (p.topic === "backoff") stallNow += Math.max(0, Math.min(now, p.to) - p.from); }); });
      for (var q = 0; q <= now; q += 10) maxNow = Math.max(maxNow, lagAt(sim, q));
      tiles.set("stall", sec(stallNow), stallNow > 2000 ? "warn" : stallNow ? "" : "ok");
      tiles.set("lag", String(maxNow), maxNow > 3 ? "warn" : "ok");
      var bdone = bad.done !== null && bad.done <= now;
      tiles.set("bad", bdone ? (bad.route === "dlt" ? "DLT · " + sec(bad.done) : t("sent · ", "enviado · ") + sec(bad.done)) : now >= HORIZON ? t("stuck", "travado") : t("pending", "pendente"), bdone ? (bad.route === "dlt" ? "warn" : "ok") : now >= HORIZON ? "bad" : "");
      var sd = sim.recs[SAME].done, sdone = sd !== null && sd !== undefined && sd <= now;
      var okNow = bdone && bad.route === "ok";
      var wrongNow = sdone && bad.route === "ok" && bad.done > sd;
      var order = wrongNow ? ["❌", "bad"] : okNow && sdone ? ["✅", "ok"] : (bdone && bad.route === "dlt") || (now >= HORIZON && !bdone) ? ["—", ""] : ["…", ""];
      tiles.set("order", order[0], order[1]);
    }

    function rebuild() {
      sim = simulate(plan); evs = events(sim); now = 0; shown = 0;
      lg.clear(); chart.reset(); chart.push([0]);
      player.total(HORIZON / TICK); player.jump(0);
      say(t("OrderConfirmed o-1005 will " + (plan.failure === "poison" ? "always fail (an invalid address)" : "fail for its first 2 s (the provider answers 503)") + "; OrderCancelled o-1005 follows 1 s later on the same key. Press play.",
        "OrderConfirmed o-1005 vai " + (plan.failure === "poison" ? "falhar sempre (um endereço inválido)" : "falhar nos primeiros 2 s (o provedor responde 503)") + "; OrderCancelled o-1005 vem 1 s depois na mesma chave. Dê play."), "");
      draw();
    }
    function advance(to) {
      while (shown < evs.length && evs[shown].t <= to) { var d = describe(evs[shown]); lg.add(sec(evs[shown].t) + " · " + d[0], d[1] === "info" ? "" : d[1]); say(d[0], d[1] === "info" ? "" : d[1]); shown++; }
    }

    var cStrat = C.choice({ label: t("Retries", "Retries"), value: plan.strategy, options: [
      { value: "blocking", label: t("blocking (lab 7)", "bloqueante (lab 7)") },
      { value: "topics", label: t("retry topics", "tópicos de retry") },
      { value: "forever", label: t("forever", "para sempre") }], onChange: function (v) { plan.strategy = v; rebuild(); } });
    var cFail = C.choice({ label: t("o-1005 fails", "o-1005 falha"), value: plan.failure, options: [
      { value: "transient", label: t("for 2 s (transient)", "por 2 s (transitória)") },
      { value: "poison", label: t("always (poison)", "sempre (venenosa)") }], onChange: function (v) { plan.failure = v; rebuild(); } });
    var tClass = C.toggle({ label: t("permanent errors skip the retries", "erros permanentes pulam os retries"), checked: plan.classify,
      onChange: function (v) { plan.classify = v; rebuild(); } });

    var player = C.player({ interval: 250,
      label: function (c) { return "t = " + sec(c * TICK); },
      onTick: function (c) {
        now = c * TICK; advance(now); chart.push([peakLag(sim, now - TICK, now)]); draw();
        if (now >= HORIZON) { var f = finalNote(); say(f[0], f[1]); return false; }
      },
      onPrev: function (c) { var k = c; rebuild(); for (var j = 1; j <= k; j++) { now = j * TICK; advance(now); chart.push([peakLag(sim, now - TICK, now)]); } player.jump(k); draw(); },
      onReset: function () { rebuild(); } });

    C.add(root, [
      el("p", { class: "csim-title", text: t("A failing record: retry in place, park it in retry topics, or retry forever?", "Um registro que falha: retry no lugar, estacionar em tópicos de retry ou retry para sempre?") }),
      el("p", { class: "csim-sub", text: t("Each cell is a record of the partition (the end of its order id): filled ones are committed, dashed ones wait, red is OrderConfirmed o-1005, and both o-1005 records have a colored border.",
        "Cada célula é um registro da partição (o fim do id do pedido): as cheias foram confirmadas, as tracejadas esperam, a vermelha é OrderConfirmed o-1005 e os dois registros de o-1005 têm borda colorida.") }),
      el("div", { class: "csim-row" }, [cStrat, cFail, tClass]),
      el("div", { class: "csim-stage" }, svg),
      note,
      player,
      tiles,
      el("div", { class: "csim-cols" }, [chart, lg])
    ]);
    rebuild();
    return { destroy: function () { player.pause(); } };
  });
})();
