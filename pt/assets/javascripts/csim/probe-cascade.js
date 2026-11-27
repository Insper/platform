/*
 * Health checks and the deep-check cascade (2027.1, class Observability — health checks):
 *
 *   <div class="csim" data-sim="probe-cascade" data-readiness="deep" data-liveness="shallow" data-failover="20"></div>
 *
 * Four `order` pods behind one Service. Two routes: GET /events reads only Redis, POST /orders needs
 * PostgreSQL. At t = 20 s the database fails over and is gone for `failover` seconds (the class
 * page's 20 s, or 60 s). Each pod runs the probes of the page's Deployment excerpt: readiness every
 * 5 s (2 failures → out of the Service, 1 success → back), liveness every 10 s (3 failures →
 * restart), startup every 5 s after a restart. A probe is "shallow" (the process answers: it always
 * passes) or "deep" (it also checks PostgreSQL: it fails while the database is down). Pods probe at
 * different phases (pod i at t ≡ i mod 5 and t ≡ 2i + 1 mod 10), as real pods do.
 *
 * Assumptions of the model (not of the page): a restarted container needs COLD = 30 s of start-up,
 * counted only while the database is up (Flyway and the connection pool need it at start); traffic is 100 req/s per
 * route; with no ready pod the Service answers 503 for every route; with ready pods GET /events
 * succeeds and POST /orders fails while the database is down (the failure the database causes anyway).
 */
(function () {
  "use strict";

  var PODS = 4, AT = 20, RUN = 150, COLD = 30, RATE = 100;
  var READY = { period: 5, failures: 2 }, LIVE = { period: 10, failures: 3 }, START = { period: 5 };

  function defaults() { return { readiness: "shallow", liveness: "shallow", failover: 20 }; }

  /* the whole run, second by second: cfg {readiness, liveness, failover} */
  function run(cfg) {
    cfg = Object.assign(defaults(), cfg || {});
    var pods = [], steps = [], restarts = 0, noReady = 0, ok = { events: 0, orders: 0 }, total = 0, events = [];
    for (var i = 0; i < PODS; i++) pods.push({ state: "ready", rf: 0, lf: 0, since: 0, prog: 0 });
    for (var t = 0; t < RUN; t++) {
      var dbUp = !(t >= AT && t < AT + cfg.failover);
      if (t === AT) events.push({ t: t, kind: "dbDown" });
      if (t === AT + cfg.failover) events.push({ t: t, kind: "dbUp" });
      pods.forEach(function (p, i) {
        if (p.state === "starting") {
          if (dbUp) p.prog++;
          if ((t - p.since) % START.period === 0 && p.prog >= COLD) { p.state = "unready"; p.rf = 0; p.lf = 0; events.push({ t: t, kind: "started", pod: i }); }
          return;
        }
        if ((t - (2 * i + 1)) % LIVE.period === 0) {
          if (cfg.liveness === "deep" && !dbUp) p.lf++; else p.lf = 0;
          if (p.lf >= LIVE.failures) {
            p.state = "starting"; p.since = t; p.prog = 0; restarts++;
            events.push({ t: t, kind: "restart", pod: i });
            return;
          }
        }
        if ((t - i) % READY.period === 0) {
          var pass = cfg.readiness === "shallow" || dbUp;
          if (pass) { if (p.state !== "ready") events.push({ t: t, kind: "ready", pod: i }); p.state = "ready"; p.rf = 0; }
          else if (++p.rf >= READY.failures && p.state === "ready") { p.state = "unready"; events.push({ t: t, kind: "unready", pod: i }); }
        }
      });
      var ready = pods.filter(function (p) { return p.state === "ready"; }).length;
      var ev = ready > 0, or = ready > 0 && dbUp;
      if (!ready) noReady++;
      total += RATE;
      if (ev) ok.events += RATE;
      if (or) ok.orders += RATE;
      steps.push({ t: t, dbUp: dbUp, ready: ready, events: ev ? "ok" : "503", orders: or ? "ok" : ready ? "500" : "503",
        pods: pods.map(function (p) { return p.state; }) });
    }
    return { cfg: cfg, steps: steps, events: events, restarts: restarts, noReady: noReady,
      availEvents: ok.events / total, availOrders: ok.orders / total, total: total };
  }

  var API = { run: run, defaults: defaults, PODS: PODS, AT: AT, RUN: RUN, COLD: COLD, READY: READY, LIVE: LIVE };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el;

  function dec(v, d) { var x = v.toFixed(d); return C.PT ? x.replace(".", ",") : x; }
  function pct(v) { return dec(100 * v, v === 1 ? 0 : 1) + "%"; }

  C.style("probe-cascade", [
    ".md-typeset .csim-pc { display: grid; grid-template-columns: max-content 1fr; gap: 3px 8px; align-items: center; font-size: .72rem; }",
    ".md-typeset .csim-pc-row { display: grid; grid-template-columns: repeat(" + RUN + ", 1fr); height: 14px; background: var(--c-panel); border-radius: 3px; overflow: hidden; }",
    ".md-typeset .csim-pc-row i { display: block; }",
    ".md-typeset .csim-pc-row i.ready, .md-typeset .csim-pc-row i.ok, .md-typeset .csim-pc-row i.up { background: color-mix(in srgb, var(--c-ok) 55%, var(--c-bg)); }",
    ".md-typeset .csim-pc-row i.unready { background: color-mix(in srgb, var(--c-warn) 60%, var(--c-bg)); }",
    ".md-typeset .csim-pc-row i.starting, .md-typeset .csim-pc-row i.down { background: color-mix(in srgb, var(--c-bad) 55%, var(--c-bg)); }",
    ".md-typeset .csim-pc-row i.err500 { background: color-mix(in srgb, var(--c-warn) 60%, var(--c-bg)); }",
    ".md-typeset .csim-pc-row i.err503 { background: var(--c-bad); }",
    ".md-typeset .csim-pc-name { color: var(--c-fg2); white-space: nowrap; }",
    ".md-typeset .csim-pc-axis { display: flex; justify-content: space-between; color: var(--c-fg3); font-size: .65rem; }",
    ".md-typeset .csim-pc-key { display: flex; flex-wrap: wrap; gap: .3rem .9rem; font-size: .68rem; color: var(--c-fg2); margin: .3rem 0; }",
    ".md-typeset .csim-pc-key i { display: inline-block; width: .8em; height: .8em; border-radius: 2px; margin-right: .3em; vertical-align: -.05em; }"
  ].join("\n"));

  C.register("probe-cascade", function (root) {
    var o = C.opts(root, defaults());
    var cfg = { readiness: o.readiness, liveness: o.liveness, failover: o.failover }, res, cursor = 0;
    var grid = el("div", { class: "csim-pc" });
    var note = el("p", { class: "csim-note" });
    var lg = C.log(7);
    var st = C.stats([
      { key: "events", label: t("GET /events (Redis only) OK", "GET /events (só Redis) OK") },
      { key: "orders", label: t("POST /orders (needs the DB) OK", "POST /orders (precisa do banco) OK") },
      { key: "noready", label: t("seconds with no ready pod", "segundos sem pod pronto") },
      { key: "restarts", label: t("restarts", "reinícios") }
    ]);
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    function cells(fn) {
      var row = el("div", { class: "csim-pc-row" });
      for (var k = 0; k < RUN; k++) row.appendChild(el("i", { class: k < cursor ? fn(res.steps[k]) : "" }));
      return row;
    }
    function draw() {
      C.clear(grid);
      grid.appendChild(el("span", { class: "csim-pc-name", text: "PostgreSQL" }));
      grid.appendChild(cells(function (x) { return x.dbUp ? "up" : "down"; }));
      for (var i = 0; i < PODS; i++) {
        grid.appendChild(el("span", { class: "csim-pc-name", text: "order-" + (i + 1) }));
        grid.appendChild(cells(function (x) { return x.pods[i]; }));
      }
      grid.appendChild(el("span", { class: "csim-pc-name", text: "GET /events" }));
      grid.appendChild(cells(function (x) { return x.events === "ok" ? "ok" : "err503"; }));
      grid.appendChild(el("span", { class: "csim-pc-name", text: "POST /orders" }));
      grid.appendChild(cells(function (x) { return x.orders === "ok" ? "ok" : "err" + x.orders; }));
      grid.appendChild(el("span"));
      grid.appendChild(el("div", { class: "csim-pc-axis" }, ["0 s", "30 s", "60 s", "90 s", "120 s", RUN + " s"].map(function (x) { return el("span", { text: x }); })));
      var shown = res.steps.slice(0, cursor), ev = 0, or = 0, nr = 0;
      shown.forEach(function (x) { if (x.events === "ok") ev++; if (x.orders === "ok") or++; if (!x.ready) nr++; });
      var n = Math.max(1, shown.length);
      var rs = res.events.filter(function (e) { return e.kind === "restart" && e.t < cursor; }).length;
      if (!cursor) { ["events", "orders", "noready", "restarts"].forEach(function (k) { st.set(k, "–", ""); }); return; }
      st.set("events", pct(ev / n), ev === n ? "ok" : ev / n > 0.95 ? "warn" : "bad");
      st.set("orders", pct(or / n), or === n ? "ok" : "warn");
      st.set("noready", nr + " s", nr ? "bad" : "ok");
      st.set("restarts", String(rs), rs ? "bad" : "ok");
    }
    function describe(e) {
      var pod = "order-" + (e.pod + 1);
      if (e.kind === "dbDown") return [t("t = " + e.t + " s · PostgreSQL fails over: down for " + cfg.failover + " s", "t = " + e.t + " s · o PostgreSQL faz failover: fora por " + cfg.failover + " s"), "warn"];
      if (e.kind === "dbUp") return [t("t = " + e.t + " s · PostgreSQL is back", "t = " + e.t + " s · o PostgreSQL voltou"), "ok"];
      if (e.kind === "unready") return [t("t = " + e.t + " s · " + pod + ": readiness failed twice → removed from the Service", "t = " + e.t + " s · " + pod + ": readiness falhou duas vezes → fora do Service"), "warn"];
      if (e.kind === "ready") return [t("t = " + e.t + " s · " + pod + ": ready → back in the Service", "t = " + e.t + " s · " + pod + ": pronto → de volta ao Service"), "ok"];
      if (e.kind === "restart") return [t("t = " + e.t + " s · " + pod + ": liveness failed 3 times → container restarted", "t = " + e.t + " s · " + pod + ": liveness falhou 3 vezes → container reiniciado"), "bad"];
      return [t("t = " + e.t + " s · " + pod + ": started (startup probe passed)", "t = " + e.t + " s · " + pod + ": iniciou (startup probe passou)"), ""];
    }
    function summary() {
      var r = res, x = r.cfg;
      if (r.restarts) return [t("Restart storm: the deep liveness probe failed 3 times in a row on every pod, Kubernetes restarted all " + r.restarts + ", and they could only start once PostgreSQL was back. No pod was ready for " + r.noReady + " s — longer than the " + x.failover + " s failover — and GET /events, which never needed the database, answered " + pct(r.availEvents) + ".",
        "Tempestade de reinícios: a liveness profunda falhou 3 vezes seguidas em todos os pods, o Kubernetes reiniciou os " + r.restarts + " e eles só conseguiram subir com o PostgreSQL de volta. Nenhum pod ficou pronto por " + r.noReady + " s — mais que o failover de " + x.failover + " s — e o GET /events, que nunca precisou do banco, respondeu " + pct(r.availEvents) + "."), "bad"];
      if (r.noReady) return [t("Correlated failure: the deep readiness probe failed on every pod at once, so the Service had no endpoint for " + r.noReady + " s and answered 503 to everything. GET /events, which only reads Redis, answered " + pct(r.availEvents) + ". No restart: the liveness probe " + (x.liveness === "deep" ? "is deep too, but 3 failures × 10 s take longer than this failover" : "checks only the process") + ".",
        "Falha correlacionada: a readiness profunda falhou em todos os pods ao mesmo tempo, então o Service ficou sem endpoint por " + r.noReady + " s e respondeu 503 para tudo. O GET /events, que só lê o Redis, respondeu " + pct(r.availEvents) + ". Nenhum reinício: a liveness " + (x.liveness === "deep" ? "também é profunda, mas 3 falhas × 10 s levam mais que este failover" : "verifica só o processo") + "."), "warn"];
      return [t("Shallow probes: every pod stayed in the Service. POST /orders failed while the database was away (" + pct(r.availOrders) + " OK) — the failure the database causes anyway — and GET /events kept serving from Redis (" + pct(r.availEvents) + "). The dependency belongs in metrics, alerts, timeouts and breakers, not in the probes.",
        "Probes rasas: todos os pods ficaram no Service. O POST /orders falhou enquanto o banco esteve fora (" + pct(r.availOrders) + " OK) — a falha que o banco causa de qualquer jeito — e o GET /events continuou servindo do Redis (" + pct(r.availEvents) + "). A dependência vai para métricas, alertas, timeouts e breakers, não para as probes."), "ok"];
    }
    function reset() {
      res = run(cfg); cursor = 0; lg.clear();
      say(t("Readiness " + (cfg.readiness === "deep" ? "checks PostgreSQL" : "checks only the process") + ", liveness " + (cfg.liveness === "deep" ? "checks PostgreSQL" : "checks only the process") + ". At t = " + AT + " s the database fails over for " + cfg.failover + " s. Press play.",
        "A readiness " + (cfg.readiness === "deep" ? "verifica o PostgreSQL" : "verifica só o processo") + ", a liveness " + (cfg.liveness === "deep" ? "verifica o PostgreSQL" : "verifica só o processo") + ". Em t = " + AT + " s o banco faz failover por " + cfg.failover + " s. Dê play."), "");
      draw();
    }
    function tick() {
      var from = cursor;
      cursor = Math.min(RUN, cursor + 2);
      res.events.forEach(function (e) { if (e.t >= from && e.t < cursor) { var d = describe(e); lg.add(d[0], d[1]); } });
      if (cursor >= RUN) { var s = summary(); say(s[0], s[1]); }
      draw();
      if (cursor >= RUN) return false;
    }
    function opt(v, en, pt) { return { value: v, label: t(en, pt) }; }
    var player = C.player({ interval: 160, speeds: [1, 2, 4], onTick: tick, onReset: reset,
      label: function () { return "t = " + cursor + " s"; } });
    function change(k) { return function (v) { cfg[k] = v; player.reset(); }; }
    var cR = C.choice({ label: "readiness", value: cfg.readiness, options: [opt("shallow", "process only", "só o processo"), opt("deep", "+ PostgreSQL", "+ PostgreSQL")], onChange: change("readiness") });
    var cL = C.choice({ label: "liveness", value: cfg.liveness, options: [opt("shallow", "process only", "só o processo"), opt("deep", "+ PostgreSQL", "+ PostgreSQL")], onChange: change("liveness") });
    var cF = C.choice({ label: t("DB failover", "failover do banco"), value: cfg.failover, options: [20, 60].map(function (v) { return { value: v, label: v + " s" }; }), onChange: change("failover") });
    var key = el("div", { class: "csim-pc-key" }, [
      [t("ready / up / OK", "pronto / no ar / OK"), "color-mix(in srgb, var(--c-ok) 55%, var(--c-bg))"],
      [t("not ready · 500 from the DB", "não pronto · 500 do banco"), "color-mix(in srgb, var(--c-warn) 60%, var(--c-bg))"],
      [t("restarting / DB down", "reiniciando / banco fora"), "color-mix(in srgb, var(--c-bad) 55%, var(--c-bg))"],
      [t("503: no endpoint", "503: sem endpoint"), "var(--c-bad)"]
    ].map(function (k) { return el("span", {}, [el("i", { style: "background:" + k[1] }), k[0]]); }));

    C.add(root, [
      el("p", { class: "csim-title", text: t("Shallow or deep probes: what does a 20-second database failover do to order?", "Probes rasas ou profundas: o que um failover de 20 segundos do banco faz com o order?") }),
      el("p", { class: "csim-sub", text: t("Four order pods behind one Service; readiness every 5 s (2 failures → out), liveness every 10 s (3 failures → restart). One cell = one second.",
        "Quatro pods do order atrás de um Service; readiness a cada 5 s (2 falhas → fora), liveness a cada 10 s (3 falhas → reinício). Uma célula = um segundo.") }),
      el("div", { class: "csim-row" }, [cR, cL, cF]),
      el("div", { class: "csim-stage" }, [grid, key]),
      st, lg, note, player
    ]);
    reset();
    return { destroy: function () { player.pause(); } };
  });
})();
