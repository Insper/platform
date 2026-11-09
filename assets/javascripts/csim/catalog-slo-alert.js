/*
 * Lab twin of hands-on 8, step 3 (2027.1): "Fire it" — stop the database and time the burn-rate alert.
 *
 *   <div class="csim" data-sim="catalog-slo-alert" data-history="hour" data-fault="stop"></div>
 *
 * The rules are infra/grafana/alerting/slo-catalog.yaml, as Grafana evaluates them every 30 s: the
 * page needs the burn rate over 1 h AND over 5 min above 14.4 for 1 minute (Pending → Firing); the
 * ticket needs 6 h AND 30 min above 6 for 5 minutes. Burn rate = error ratio / 0.005 (SLO 99.5%).
 * k6 sends the page's RATE = 50 req/s to catalog; `docker compose stop db` makes every catalog
 * request fail (fault "stop"), or a partial fault fails 4% of them (burn rate 8, the page's example).
 * The counters reach Prometheus every 10 s (OTEL_METRIC_EXPORT_INTERVAL), so the model works in 10 s
 * buckets and each window holds exactly window/10 of them.
 *
 * What is in the windows before the fault (data-history):
 *   hour    an hour of steady 50 req/s, nothing before (the stack has been up for an hour): the
 *           prediction box of the page;
 *   stress  the same hour plus lab 2's stress test (load/stress.js, PEAK = 600) run by step 2 and
 *           finished 15 minutes before the fault; catalog sees it capped at the gateway's ~320 req/s
 *           (the dashboard page's test run): about 84 thousand extra healthy requests;
 *   short   only 10 minutes of 50 req/s (the stack was just started).
 * Every LAB value is registered in scripts/csim/lab-values.mjs.
 */
(function () {
  "use strict";

  var LAB = {
    budget: 0.005, fastBurn: 14.4, slowBurn: 6, fastLong: 3600, fastShort: 300, slowLong: 21600, slowShort: 1800,
    fastFor: 60, slowFor: 300, interval: 30, rate: 50, exportS: 10, peak: 600, gwMax: 320, startRate: 10,
    stages: "0.25/30 0.25/30 0.5/30 0.5/30 0.75/30 0.75/30 1/30 1/60 0.25/15 0.25/60"   /* fraction of PEAK / seconds */
  };
  var PARTIAL = 0.04, STRESS_GAP = 900, CLOCK0 = 10 * 3600 + 12 * 60 + 31;   /* the page's "10:12:31" */

  function defaults() { return { history: "hour", fault: "stop" }; }

  /* lab 2's staircase, per second, as catalog receives it (capped by the gateway) */
  function stressProfile() {
    var out = [], from = LAB.startRate;
    LAB.stages.split(" ").map(function (x) { return x.split("/").map(Number); }).forEach(function (st) {
      var to = Math.round(LAB.peak * st[0]);
      for (var s = 0; s < st[1]; s++) out.push(Math.min(LAB.gwMax, from + (to - from) * (s + 0.5) / st[1]));
      from = to;
    });
    return out;
  }
  function stressTotal() { return stressProfile().reduce(function (a, b) { return a + b; }, 0); }

  /*
   * o: {history, fault, startAt (s after the stop, or null = never), run (s)}
   * returns the evaluations (every 30 s) with the four burn rates and both alert states, and the events
   */
  function run(o) {
    o = Object.assign(defaults(), o || {});
    var B = LAB.exportS, run = o.run || (o.fault === "stop" ? 2400 : 6 * 3600);
    var before = o.history === "short" ? 600 : 3600, first = -LAB.slowLong;
    var nb = (run - first) / B, tot = new Float64Array(nb), err = new Float64Array(nb);
    function idx(tEnd) { return Math.round((tEnd - first) / B) - 1; }      /* bucket ending at tEnd */
    for (var tEnd = first + B; tEnd <= run; tEnd += B) {
      var i = idx(tEnd), traffic = tEnd > -before ? LAB.rate * B : 0;
      tot[i] = traffic;
      var down = tEnd > 0 && (o.startAt === null || o.startAt === undefined || tEnd <= o.startAt);
      if (down) err[i] = traffic * (o.fault === "stop" ? 1 : PARTIAL);
    }
    if (o.history === "stress") {
      var prof = stressProfile(), start = -STRESS_GAP - prof.length;
      prof.forEach(function (r, s) { tot[idx(B * Math.ceil((start + s + 1) / B))] += r; });
    }
    var P = new Float64Array(nb + 1), E = new Float64Array(nb + 1);
    for (var k = 0; k < nb; k++) { P[k + 1] = P[k] + tot[k]; E[k + 1] = E[k] + err[k]; }
    function burn(t, w) {
      var hi = idx(t) + 1, lo = Math.max(0, hi - w / B), n = P[hi] - P[lo];
      return n > 0 ? (E[hi] - E[lo]) / n / LAB.budget : NaN;
    }
    var evals = [], events = [], page = { state: "Normal", since: null }, ticket = { state: "Normal", since: null };
    function step(rule, cond, t, name, A, Bv) {
      if (cond) {
        if (rule.state === "Normal") { rule.state = "Pending"; rule.since = t; events.push({ t: t, kind: "pending", rule: name, A: A, B: Bv }); }
        if (rule.state === "Pending" && t - rule.since >= (name === "page" ? LAB.fastFor : LAB.slowFor)) { rule.state = "Firing"; events.push({ t: t, kind: "firing", rule: name, A: A, B: Bv }); }
      } else if (rule.state !== "Normal") { events.push({ t: t, kind: "normal", rule: name, from: rule.state }); rule.state = "Normal"; rule.since = null; }
    }
    for (var t = 0; t <= run; t += LAB.interval) {
      var fl = burn(t, LAB.fastLong), fs = burn(t, LAB.fastShort), sl = burn(t, LAB.slowLong), ss = burn(t, LAB.slowShort);
      step(page, fl > LAB.fastBurn && fs > LAB.fastBurn, t, "page", fl, fs);
      step(ticket, sl > LAB.slowBurn && ss > LAB.slowBurn, t, "ticket", sl, ss);
      evals.push({ t: t, fastLong: fl, fastShort: fs, slowLong: sl, slowShort: ss, page: page.state, ticket: ticket.state,
        down: t > 0 && (o.startAt === null || o.startAt === undefined || t <= o.startAt) });
    }
    function find(kind, rule) { for (var j = 0; j < events.length; j++) if (events[j].kind === kind && events[j].rule === rule) return events[j]; return null; }
    return { o: o, run: run, evals: evals, events: events, burn: burn, find: find };
  }

  /* the experiment as the page runs it: stop db, start it again at the evaluation where the page fires */
  function experiment(history, fault) {
    var first = run({ history: history, fault: fault, startAt: null });
    var fire = first.find("firing", "page");
    return run({ history: history, fault: fault, startAt: fire ? fire.t : null });
  }

  /* the first moment the 1 h error ratio reaches the threshold (continuous, before the 30 s evaluation) */
  function crossing(history) {
    var r = run({ history: history, fault: "stop", startAt: null, run: 1800 });
    for (var t = 0; t <= 1800; t += LAB.exportS) if (r.burn(t, LAB.fastLong) > LAB.fastBurn) return t;
    return null;
  }

  var API = { LAB: LAB, run: run, experiment: experiment, crossing: crossing, stressProfile: stressProfile, stressTotal: stressTotal, defaults: defaults, PARTIAL: PARTIAL };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var L = 70, R = 630, TOP = 10, BOT = 170;

  function dec(v, d) { var x = v.toFixed(d); return C.PT ? x.replace(".", ",") : x; }
  function clock(sec) {
    var x = CLOCK0 + sec, h = Math.floor(x / 3600) % 24, m = Math.floor(x / 60) % 60, se = Math.floor(x % 60);
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (se < 10 ? "0" : "") + se;
  }
  function mmss(sec) { var m = Math.floor(sec / 60), x = sec % 60; return m + ":" + (x < 10 ? "0" : "") + x; }
  function br(v) { return isNaN(v) ? "NaN" : dec(v, 1); }

  C.style("catalog-slo-alert", [
    ".md-typeset .csim-sa-l1 { fill: none; stroke: var(--c-bad); stroke-width: 1.8; }",
    ".md-typeset .csim-sa-l5 { fill: none; stroke: var(--c-ink); stroke-width: 1.4; stroke-dasharray: 5 3; }",
    ".md-typeset .csim-sa-l6 { fill: none; stroke: var(--c-warn); stroke-width: 1.6; }",
    ".md-typeset .csim-sa-l30 { fill: none; stroke: var(--c-fg2); stroke-width: 1.2; stroke-dasharray: 2 3; }",
    ".md-typeset .csim-sa-th { stroke: var(--c-fg3); stroke-dasharray: 4 3; }",
    ".md-typeset .csim-sa-down { fill: color-mix(in srgb, var(--c-bad) 10%, var(--c-bg)); }",
    ".md-typeset .csim-sa-lane { fill: var(--c-panel); }",
    ".md-typeset .csim-sa-Pending { fill: var(--c-warn); } .md-typeset .csim-sa-Firing { fill: var(--c-bad); }",
    ".md-typeset .csim-sa-cursor { stroke: var(--c-accent); stroke-width: 1.5; }"
  ].join("\n"));

  C.register("catalog-slo-alert", function (root) {
    var o = C.opts(root, defaults());
    var cfg = { history: o.history, fault: o.fault }, res, cursor = 0, startAt = null, auto = true;
    var svg = s("svg", { viewBox: "0 0 640 236", role: "img", "aria-label": t("Burn rates and alert states after the database stops", "Burn rates e estados dos alertas depois que o banco para") });
    var note = el("p", { class: "csim-note" });
    var lg = C.log(7);
    var st = C.stats([
      { key: "since", label: t("since stop db", "desde o stop db") },
      { key: "b1", label: t("burn rate 1 h", "burn rate 1 h") },
      { key: "b5", label: t("burn rate 5 min", "burn rate 5 min") },
      { key: "page", label: t("page · ticket", "page · ticket") }
    ]);
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    function recompute() { res = run({ history: cfg.history, fault: cfg.fault, startAt: startAt }); }
    function X(sec) { return L + (R - L) * sec / res.run; }
    var lo = 0.1, hi = 300;
    function Y(v) { v = Math.max(lo, Math.min(hi, isNaN(v) ? lo : v)); return BOT - (BOT - TOP) * (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)); }

    function draw() {
      C.clear(svg);
      var ev = res.evals, stopEnd = startAt === null ? Math.min(cursor, res.run) : Math.min(startAt, cursor);
      if (stopEnd > 0) svg.appendChild(s("rect", { x: X(0), y: TOP, width: X(stopEnd) - X(0), height: BOT - TOP, class: "csim-sa-down" }));
      [[LAB.fastBurn, dec(LAB.fastBurn, 1) + "×"], [LAB.slowBurn, LAB.slowBurn + "×"], [1, "1×"]].forEach(function (th) {
        svg.appendChild(s("line", { x1: L, x2: R, y1: Y(th[0]), y2: Y(th[0]), class: "csim-sa-th" }));
        svg.appendChild(s("text", { x: L - 4, y: Y(th[0]) + 3, "text-anchor": "end", class: "c-small" }, th[1]));
      });
      svg.appendChild(s("text", { x: L - 4, y: Y(200) + 3, "text-anchor": "end", class: "c-small" }, "200×"));
      function line(key, cls) {
        var pts = [];
        ev.forEach(function (e) { if (e.t <= cursor && !isNaN(e[key])) pts.push(X(e.t).toFixed(1) + "," + Y(e[key]).toFixed(1)); });
        svg.appendChild(s("polyline", { class: cls, points: pts.join(" ") }));
      }
      line("fastLong", "csim-sa-l1"); line("fastShort", "csim-sa-l5");
      if (cfg.fault !== "stop") { line("slowLong", "csim-sa-l6"); line("slowShort", "csim-sa-l30"); }
      [["page", t("page (14.4×)", "page (14,4×)")], ["ticket", t("ticket (6×)", "ticket (6×)")]].forEach(function (lane, i) {
        var y = BOT + 14 + i * 18;
        svg.appendChild(s("rect", { x: L, y: y, width: R - L, height: 12, class: "csim-sa-lane" }));
        svg.appendChild(s("text", { x: L - 4, y: y + 10, "text-anchor": "end", class: "c-small" }, lane[1]));
        ev.forEach(function (e, j) {
          if (e.t > cursor || e[lane[0]] === "Normal") return;
          var nx = j + 1 < ev.length ? ev[j + 1].t : e.t + LAB.interval;
          svg.appendChild(s("rect", { x: X(e.t), y: y + 1, width: Math.max(1, X(Math.min(nx, cursor)) - X(e.t)), height: 10, class: "csim-sa-" + e[lane[0]] }));
        });
      });
      var step = cfg.fault === "stop" ? 300 : 3600;
      for (var x = 0; x <= res.run; x += step) svg.appendChild(s("text", { x: X(x), y: 232, "text-anchor": "middle", class: "c-small" }, cfg.fault === "stop" ? mmss(x) : x / 3600 + " h"));
      svg.appendChild(s("line", { x1: X(Math.min(cursor, res.run)), x2: X(Math.min(cursor, res.run)), y1: TOP, y2: BOT + 48, class: "csim-sa-cursor" }));
      var cur = null;
      ev.forEach(function (e) { if (e.t <= cursor) cur = e; });
      st.set("since", mmss(Math.min(cursor, res.run)), "");
      if (cur) {
        st.set("b1", br(cur.fastLong), cur.fastLong > LAB.fastBurn ? "bad" : cur.fastLong > 1 ? "warn" : "ok");
        st.set("b5", br(cur.fastShort), cur.fastShort > LAB.fastBurn ? "bad" : cur.fastShort > 1 ? "warn" : "ok");
        st.set("page", cur.page + " · " + cur.ticket, cur.page === "Firing" ? "bad" : cur.page === "Pending" || cur.ticket !== "Normal" ? "warn" : "ok");
      }
    }
    function describe(e) {
      var who = e.rule === "page" ? t("fast burn (page)", "queima rápida (page)") : t("slow burn (ticket)", "queima lenta (ticket)");
      var w = e.rule === "page" ? ["1 h", "5 min"] : ["6 h", "30 min"];
      if (e.kind === "pending") return [clock(e.t) + " · " + who + ": Pending — " + br(e.A) + " (" + w[0] + "), " + br(e.B) + " (" + w[1] + ")", "warn"];
      if (e.kind === "firing") return [clock(e.t) + " · " + who + ": Firing " + t("after ", "após ") + mmss(e.t) + " — \"Burn rate " + dec(e.A, 1) + " (" + w[0] + ") and " + dec(e.B, 1) + " (" + w[1] + ")\"", "bad"];
      return [clock(e.t) + " · " + who + ": Normal", "ok"];
    }
    function reset() {
      startAt = null; cursor = 0; lg.clear(); recompute();
      lg.add(clock(0) + " · docker compose " + (cfg.fault === "stop" ? "stop db" : t("(4% of the requests fail)", "(4% das requisições falham)")), "warn");
      var hist = cfg.history === "stress" ? t("an hour of 50 req/s plus the stress test of step 2 (" + Math.round(stressTotal() / 1000) + " thousand requests)", "uma hora de 50 req/s mais o teste de estresse do passo 2 (" + Math.round(stressTotal() / 1000) + " mil requisições)")
        : cfg.history === "short" ? t("only 10 minutes of 50 req/s", "só 10 minutos de 50 req/s") : t("an hour of steady 50 req/s", "uma hora de 50 req/s constantes");
      say(t("The windows hold " + hist + ". At " + clock(0) + " " + (cfg.fault === "stop" ? "the database stops and every catalog request fails" : "4% of the catalog requests start failing (burn rate 8)") + ". Press play: one tick = 10 s" + (cfg.fault === "stop" ? "" : " (60 s here)") + ".",
        "As janelas guardam " + hist + ". Às " + clock(0) + " " + (cfg.fault === "stop" ? "o banco para e toda requisição ao catalog falha" : "4% das requisições ao catalog começam a falhar (burn rate 8)") + ". Dê play: um tick = 10 s" + (cfg.fault === "stop" ? "" : " (aqui, 60 s)") + "."), "");
      draw();
    }
    function startDb() {
      if (startAt !== null || cfg.fault !== "stop") return;
      startAt = Math.ceil(cursor / LAB.interval) * LAB.interval;
      recompute();
      lg.add(clock(startAt) + " · docker compose start db", "ok");
    }
    function tick() {
      var from = cursor, dt = cfg.fault === "stop" ? 10 : 60;
      cursor = Math.min(res.run, cursor + dt);
      res.events.forEach(function (e) {
        if (e.t > from && e.t <= cursor) {
          var d = describe(e); lg.add(d[0], d[1]);
          if (e.kind === "firing" && e.rule === "page") {
            say(t("Paged " + mmss(e.t) + " after the stop. The 5-minute window was full of errors within a minute (burn rate 200 = 1 / 0.005); the 1-hour window is the slow one: it needed 7.2% errors (14.4 × 0.5%), then Pending had to last 1 minute.",
              "Page " + mmss(e.t) + " depois do stop. A janela de 5 minutos se encheu de erros em um minuto (burn rate 200 = 1 / 0,005); a de 1 hora é a lenta: precisou de 7,2% de erros (14,4 × 0,5%), e depois o Pending teve de durar 1 minuto."), "bad");
            if (auto) startDb();
          }
          if (e.kind === "normal" && e.rule === "page") say(t("The page resolved " + mmss(e.t - startAt) + " after the database came back: the 5-minute window had to drop below 7.2% errors, so almost all of the outage had to leave it. The 1-hour burn rate is still " + br(res.evals[e.t / LAB.interval].fastLong) + " — without the short window the page would keep firing for most of an hour.",
            "O page voltou ao normal " + mmss(e.t - startAt) + " depois que o banco voltou: a janela de 5 minutos precisou cair abaixo de 7,2% de erros, então quase toda a queda teve de sair dela. O burn rate de 1 hora ainda está em " + br(res.evals[e.t / LAB.interval].fastLong) + " — sem a janela curta, o page continuaria disparando por quase uma hora."), "ok");
          if (e.kind === "firing" && e.rule === "ticket" && cfg.fault !== "stop") say(t("A 4% error rate never pages: its burn rate (8) is below 14.4. The 6-hour rule opens a ticket " + dec(e.t / 3600, 1) + " hours in, once the 6-hour ratio passes 3% and Pending has lasted 5 minutes.",
            "Uma taxa de 4% de erros nunca dispara o page: o burn rate dela (8) é menor que 14,4. A regra de 6 horas abre um ticket após " + dec(e.t / 3600, 1) + " horas, quando a razão de 6 horas passa de 3% e o Pending dura 5 minutos."), "warn");
        }
      });
      draw();
      if (cursor >= res.run) return false;
    }
    var player = C.player({ interval: 140, speeds: [1, 2, 4, 8], onTick: tick, onReset: reset, label: function () { return clock(Math.min(cursor, res ? res.run : 0)); } });
    var cH = C.choice({ label: t("in the windows before", "nas janelas antes"), value: cfg.history, options: [
      { value: "short", label: t("10 min", "10 min") }, { value: "hour", label: t("1 h", "1 h") }, { value: "stress", label: t("1 h + stress test", "1 h + teste de estresse") }],
      onChange: function (v) { cfg.history = v; player.reset(); } });
    var cF = C.choice({ label: t("fault", "falha"), value: cfg.fault, options: [{ value: "stop", label: "stop db" }, { value: "partial", label: t("4% errors", "4% de erros") }],
      onChange: function (v) { cfg.fault = v; player.reset(); } });
    var tAuto = C.toggle({ label: t("start db when it fires", "start db quando disparar"), checked: true, onChange: function (v) { auto = v; } });
    var bStart = C.button("docker compose start db", function () { startDb(); draw(); }, { tone: "ok" });

    C.add(root, [
      el("p", { class: "csim-title", text: t("Lab 8, step 3: stop db — how long until somebody is paged, and until it stops?", "Lab 8, passo 3: stop db — quanto tempo até alguém ser acionado, e até parar?") }),
      el("p", { class: "csim-sub", text: t("slo-catalog.yaml as Grafana evaluates it every 30 s: red = burn rate over 1 h, dashed = over 5 min (orange and dotted: 6 h and 30 min); the lanes show Pending (orange) and Firing (red).",
        "O slo-catalog.yaml como o Grafana o avalia a cada 30 s: vermelho = burn rate em 1 h, tracejado = em 5 min (laranja e pontilhado: 6 h e 30 min); as faixas mostram Pending (laranja) e Firing (vermelho).") }),
      el("div", { class: "csim-row" }, [cH, cF]),
      el("div", { class: "csim-row" }, [tAuto, bStart]),
      el("div", { class: "csim-stage" }, svg),
      st, lg, note, player
    ]);
    reset();
    return { destroy: function () { player.pause(); } };
  });
})();
