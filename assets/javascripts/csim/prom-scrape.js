/*
 * The monitoring stack of hands-on 6 (2026.2), as a lab twin:
 *
 *   <div class="csim" data-sim="prom-scrape"></div>
 *
 * Prometheus with the lab's prometheus.yml (jobs GatewayMetrics, AuthMetrics and AccountMetrics, each
 * scraping <service>:8080 on its own metrics_path, scrape_interval 1s) and the three services counting
 * their requests in http_server_requests_seconds_count, as Actuator + Micrometer do. Traffic enters
 * through the gateway: a secured request (GET /accounts…) is counted by the gateway, by auth
 * (POST /auth/solve, which the gateway's AuthorizationFilter calls) and by account; a login only by
 * the gateway and auth. Each scrape is a request too, so it adds 1 to the counter of the service it
 * scrapes, after the sample is taken.
 *
 * Each second: the requests of that second are counted, then every target whose turn it is gets
 * scraped (the name of a stopped container does not resolve, a wrong metrics_path answers 404: either way up = 0 and no
 * sample). rate(v[w]) is Prometheus's extrapolated rate over the samples in (T - w, T]: counter resets
 * are added back, at least two samples are needed, and the result is extrapolated towards the window
 * edges by at most half a scrape interval. A restarted service starts its counter at 0.
 */
(function () {
  "use strict";

  /* setup/prometheus/prometheus.yml (prometheus/index.md) */
  var JOBS = [
    { job: "GatewayMetrics", svc: "gateway", path: "/gateway/actuator/prometheus", target: "gateway:8080", app: "Gateway Application" },
    { job: "AuthMetrics", svc: "auth", path: "/auth/actuator/prometheus", target: "auth:8080", app: "Auth Application" },
    { job: "AccountMetrics", svc: "account", path: "/accounts/actuator/prometheus", target: "account:8080", app: "Account Application" }
  ];
  var INTERVAL = 1;                       /* scrape_interval: 1s in every job */
  var METRIC = "http_server_requests_seconds_count";
  var ROUTES = { accounts: ["gateway", "auth", "account"], login: ["gateway", "auth"] };

  function create(o) {
    o = o || {};
    return { t: 0, interval: o.interval || INTERVAL, load: o.load === undefined ? 10 : o.load, route: o.route || "accounts",
      targets: JOBS.map(function (j) { return { job: j.job, svc: j.svc, path: j.path, target: j.target, running: true, broken: false, counter: 0, samples: [], last: null, health: null }; }) };
  }
  function target(st, svc) { return st.targets.filter(function (x) { return x.svc === svc || x.job === svc; })[0]; }

  /* one second of the platform and of Prometheus */
  function tick(st) {
    st.t += 1;
    var chain = ROUTES[st.route];
    for (var i = 0; i < st.load; i++) {
      for (var k = 0; k < chain.length; k++) {
        var x = target(st, chain[k]);
        if (!x.running) break;           /* the gateway answers 5xx; the services after it never see the request */
        x.counter++;
      }
    }
    var out = [];
    st.targets.forEach(function (x) { if (st.t % st.interval === 0) out.push(scrape(st, x)); });
    return out;
  }
  function scrape(st, x) {
    var r = { job: x.job, t: st.t };
    if (!x.running) { r.code = 0; r.err = "Get \"http://" + x.target + x.path + "\": dial tcp: lookup " + x.svc + " on 127.0.0.11:53: no such host"; }
    else if (x.broken) { r.code = 404; r.err = "server returned HTTP status 404 Not Found"; }
    else { r.code = 200; r.value = x.counter; x.samples.push([st.t, x.counter]); x.counter++; }
    var was = x.health;
    x.health = r.code === 200 ? "up" : "down";
    r.changed = was !== x.health;
    x.last = r;
    if (x.samples.length > 4000) x.samples.splice(0, 1000);
    return r;
  }
  function stop(st, svc) { var x = target(st, svc); x.running = false; return x; }
  function start(st, svc) { var x = target(st, svc); if (!x.running) { x.running = true; x.counter = 0; } return x; }
  function breakPath(st, svc, on) { var x = target(st, svc); x.broken = on; return x; }

  /* the samples of a target in (T - w, T] */
  function range(x, T, w) { return x.samples.filter(function (s) { return s[0] > T - w && s[0] <= T; }); }
  /* Prometheus's extrapolatedRate for a counter */
  function rate(samples, T, w) {
    if (samples.length < 2) return null;
    var first = samples[0], last = samples[samples.length - 1], result = last[1] - first[1];
    for (var i = 1; i < samples.length; i++) if (samples[i][1] < samples[i - 1][1]) result += samples[i - 1][1];
    var start = T - w, sampled = last[0] - first[0], avg = sampled / (samples.length - 1);
    var toStart = first[0] - start, toEnd = T - last[0];
    if (result > 0 && first[1] >= 0) { var toZero = sampled * (first[1] / result); if (toZero < toStart) toStart = toZero; }
    var limit = avg * 1.1, ext = sampled;
    ext += toStart < limit ? toStart : avg / 2;
    ext += toEnd < limit ? toEnd : avg / 2;
    return result * (ext / sampled) / w;
  }
  function rateOf(st, svc, w) { var x = target(st, svc); return rate(range(x, st.t, w), st.t, w); }
  function up(st, svc) { var x = target(st, svc); return x.last ? (x.last.code === 200 ? 1 : 0) : null; }
  function run(st, secs) { var out = []; for (var i = 0; i < secs; i++) out = out.concat(tick(st)); return out; }

  var API = { JOBS: JOBS, INTERVAL: INTERVAL, METRIC: METRIC, ROUTES: ROUTES, create: create, target: target, tick: tick, run: run,
    stop: stop, start: start, breakPath: breakPath, range: range, rate: rate, rateOf: rateOf, up: up };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var TONES = ["tone-ink", "tone-accent", "tone-ok"];
  var BX = [100, 276, 452], BY = 12, BW = 170, BH = 70, PR = { x: 210, y: 158, w: 200, h: 56 }, GF = { x: 470, y: 162, w: 150, h: 48 };

  C.style("prom-scrape", [
    ".md-typeset .csim .csim-pr-t { cursor: pointer; }",
    ".md-typeset .csim .csim-pr-t.sel > rect:first-child { stroke-width: 3; }",
    ".md-typeset .csim .c-wire.csim-pr-scrape { stroke-dasharray: 4 3; }",
    ".md-typeset .csim-pr-q { font-family: var(--md-code-font-family, monospace); font-size: .62rem; color: var(--c-fg2); margin: .3rem 0 0; white-space: pre-wrap; }",
    ".md-typeset .csim-log.csim-pr-term li { font-family: var(--md-code-font-family, monospace); font-size: .6rem; white-space: pre-wrap; }"
  ].join("\n"));

  C.register("prom-scrape", function (root) {
    var o = C.opts(root, { load: 10, interval: INTERVAL, window: 60 });
    var st, sel = "account", win = o.window;

    var svg = s("svg", { viewBox: "0 0 630 222", role: "img", "aria-label": t("Prometheus scraping the lab's services", "Prometheus coletando os serviços do lab") });
    var note = el("p", { class: "csim-note" });
    var expo = el("p", { class: "csim-pr-q" });
    var query = el("p", { class: "csim-pr-q" });
    var term = C.log(5); term.className += " csim-pr-term";
    var chart = C.chart({ title: t("Grafana panel: requests per second, by job", "Painel do Grafana: requisições por segundo, por job"),
      series: JOBS.map(function (j, i) { return { label: j.job, cls: TONES[i] }; }), len: 90 });
    var tiles = C.stats(JOBS.map(function (j) { return { key: j.svc, label: "rate · " + j.svc }; }).concat([{ key: "n", label: t("samples in the window", "amostras na janela") }]));

    var sLoad = C.slider({ label: t("traffic (req/s)", "tráfego (req/s)"), min: 0, max: 30, value: o.load, onInput: function (v) { st.load = v; draw(); } });
    var cRoute = C.choice({ label: t("requests", "requisições"), value: "accounts", options: [
      { value: "accounts", label: t("secured: GET /accounts…", "protegidas: GET /accounts…") }, { value: "login", label: "POST /auth/login" }
    ], onChange: function (v) { st.route = v; draw(); } });
    var cInt = C.choice({ label: "scrape_interval", value: o.interval, options: [
      { value: 1, label: t("1s (lab)", "1s (lab)") }, { value: 15, label: "15s" }, { value: 60, label: t("1m (default)", "1m (padrão)") }
    ], onChange: function (v) { st.interval = v; log(t("scrape_interval: " + v + "s (reload Prometheus)", "scrape_interval: " + v + "s (recarregue o Prometheus)"), ""); draw(); } });
    var cWin = C.choice({ label: t("rate window", "janela do rate"), value: win, options: [
      { value: 5, label: "[5s]" }, { value: 60, label: "[1m]" }, { value: 300, label: "[5m]" }
    ], onChange: function (v) { win = v; draw(); } });
    var bStop = C.button("docker compose stop", function () { var x = target(st, sel); if (x.running) { stop(st, sel); log("$ docker compose stop " + sel, "warn"); } else { start(st, sel); log("$ docker compose start " + sel + t("   # its counter starts at 0", "   # o contador começa em 0"), "ok"); } draw(); }, { tone: "bad" });
    var bPath = C.button("metrics_path", function () { var x = target(st, sel); breakPath(st, sel, !x.broken); log(x.broken ? "metrics_path: '/actuator/prometheus'   # " + t("typo: the base-path is ", "erro: o base-path é ") + x.path.replace("/prometheus", "") : "metrics_path: '" + x.path + "'", x.broken ? "warn" : "ok"); draw(); });

    var player = C.player({ interval: 450, onTick: function () { advance(); }, onReset: function () { reset(); },
      label: function () { return "t = " + (st ? st.t : 0) + " s"; } });

    function log(text, tone) { term.add(el("span", { text: text }), tone); }
    function advance() {
      var res = tick(st);
      res.forEach(function (r) {
        if (!r.changed) return;
        if (r.code === 200) log(r.job + ": up = 1  (" + target(st, r.job).target + ")", "ok");
        else log(r.job + ": up = 0  " + r.err, "bad");
      });
      chart.push(JOBS.map(function (j) { var v = rateOf(st, j.svc, win); return v === null ? 0 : v; }));
      draw();
    }
    function reset() {
      st = create({ load: sLoad.get(), interval: cInt.get(), route: cRoute.get() });
      term.clear(); chart.reset();
      note.textContent = t("Press play: every simulated second the services count their requests and Prometheus scrapes the targets whose turn it is.",
        "Aperte play: a cada segundo simulado os serviços contam suas requisições e o Prometheus coleta os alvos da vez.");
      note.className = "csim-note";
      draw();
    }

    function text(x, y, str, cls, anchor) { return s("text", { x: x, y: y, class: cls || "c-small", "text-anchor": anchor || "start" }, str); }
    function fmt(v) { return v === null ? t("no data", "sem dados") : (Math.round(v * 100) / 100).toLocaleString(C.PT ? "pt-BR" : "en-US"); }

    function draw() {
      C.clear(svg);
      var chain = ROUTES[st.route];
      /* traffic: client → gateway → auth → account */
      svg.appendChild(s("rect", { x: 4, y: BY + 14, width: 76, height: 42, rx: 7, class: "c-box on" }));
      svg.appendChild(text(42, BY + 32, t("clients", "clientes"), "c-label", "middle"));
      svg.appendChild(text(42, BY + 47, st.load + " req/s", "c-small c-mono", "middle"));
      [[80, BX[0]], [BX[0] + BW, BX[1]], [BX[1] + BW, BX[2]]].forEach(function (w, i) {
        var live = st.load > 0 && i < chain.length && chain.slice(0, i + 1).every(function (n) { return target(st, n).running; });
        svg.appendChild(s("line", { x1: w[0], y1: BY + 35, x2: w[1], y2: BY + 35, class: "c-wire" + (live ? " on" : "") }));
      });
      /* the targets */
      JOBS.forEach(function (j, i) {
        var x = target(st, j.svc), last = x.last, cls = !x.running ? "down" : last && last.code !== 200 ? "bad" : last ? "ok" : "";
        var g = s("g", { class: "csim-pr-t" + (sel === j.svc ? " sel" : ""), onclick: function () { sel = j.svc; draw(); } });
        g.appendChild(s("rect", { x: BX[i], y: BY, width: BW, height: BH, rx: 7, class: "c-box " + cls }));
        g.appendChild(text(BX[i] + 7, BY + 15, j.target, "c-label"));
        g.appendChild(text(BX[i] + 7, BY + 29, x.broken ? "/actuator/prometheus ✗" : j.path, "c-small" + (x.broken ? " c-bad" : "")));
        g.appendChild(text(BX[i] + 7, BY + 45, x.running ? t("counter ", "contador ") + x.counter : t("stopped", "parado"), "c-small"));
        g.appendChild(text(BX[i] + 7, BY + 60, last ? (last.code === 200 ? "up 1 · " + t("sample ", "amostra ") + last.value : "up 0 · " + (last.code ? "404" : "no such host")) : t("not scraped yet", "ainda não coletado"),
          "c-small" + (last && last.code !== 200 ? " c-bad" : last ? " c-ok" : "")));
        svg.appendChild(g);
        /* scrape wire from Prometheus */
        var fresh = last && last.t === st.t;
        svg.appendChild(s("line", { x1: PR.x + PR.w * (i + 1) / 4, y1: PR.y, x2: BX[i] + BW / 2, y2: BY + BH,
          class: "c-wire csim-pr-scrape" + (fresh ? (last.code === 200 ? " on" : " cut") : "") }));
      });
      svg.appendChild(s("rect", { x: PR.x, y: PR.y, width: PR.w, height: PR.h, rx: 7, class: "c-box hot" }));
      svg.appendChild(text(PR.x + 8, PR.y + 17, "Prometheus :9090", "c-label"));
      svg.appendChild(text(PR.x + 8, PR.y + 32, "scrape_interval: " + st.interval + "s", "c-small c-mono"));
      svg.appendChild(text(PR.x + 8, PR.y + 46, t("pulls; the services never push", "puxa; os serviços nunca empurram"), "c-small"));
      svg.appendChild(s("line", { x1: GF.x, y1: GF.y + GF.h / 2, x2: PR.x + PR.w, y2: GF.y + GF.h / 2, class: "c-wire on" }));
      svg.appendChild(s("rect", { x: GF.x, y: GF.y, width: GF.w, height: GF.h, rx: 7, class: "c-box on" }));
      svg.appendChild(text(GF.x + 8, GF.y + 18, "Grafana :3000", "c-label"));
      svg.appendChild(text(GF.x + 8, GF.y + 33, t("PromQL queries", "consultas PromQL"), "c-small"));
      svg.appendChild(text(4, 214, "t = " + st.t + " s", "c-small c-mono"));

      var x = target(st, sel), j = JOBS.filter(function (y) { return y.svc === sel; })[0];
      var lastLine = x.last ? (x.last.code === 200 ? "→ 200\n" + METRIC + '{application="' + j.app + '", instance="' + j.target + '", job="' + j.job + '"} ' + x.last.value : "→ " + x.last.err) : "";
      expo.textContent = "# GET http://" + j.target + (x.broken ? "/actuator/prometheus" : j.path) + " " + lastLine;
      var wl = win === 300 ? "5m" : win === 60 ? "1m" : "5s";
      query.textContent = "sum by (job) (rate(" + METRIC + "[" + wl + "]))";
      JOBS.forEach(function (y) { var v = rateOf(st, y.svc, win); tiles.set(y.svc, fmt(v), v === null ? (st.t ? "warn" : "") : "ok"); });
      var n = range(target(st, sel), st.t, win).length;
      tiles.set("n", sel + ": " + n, n < 2 && st.t ? "bad" : "");
      bStop.textContent = (x.running ? "docker compose stop " : "docker compose start ") + sel;
      bStop.className = "csim-btn " + (x.running ? "csim-btn-bad" : "csim-btn-ok");
      bPath.textContent = x.broken ? t("fix metrics_path of ", "corrigir metrics_path de ") + sel : t("wrong metrics_path on ", "metrics_path errado em ") + sel;
      if (st.t) {
        var low = n < 2;
        note.textContent = low ? t("Fewer than two samples of " + sel + " in the window: rate() has nothing to compute. Make the window at least 4 × the scrape_interval.",
          "Menos de duas amostras de " + sel + " na janela: o rate() não tem o que calcular. Use uma janela de pelo menos 4 × o scrape_interval.")
          : t("rate() takes the counter's increase over the window, divided by its seconds. At " + st.load + " req/s, " + sel + " shows " + fmt(rateOf(st, sel, win)) + ": the scrapes count too.",
            "O rate() pega o aumento do contador na janela, dividido pelos segundos dela. A " + st.load + " req/s, " + sel + " mostra " + fmt(rateOf(st, sel, win)) + ": as coletas também contam.");
        note.className = "csim-note" + (low ? " csim-warn" : "");
      }
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's Prometheus, without Docker: scrape, counter and rate()", "O Prometheus do lab, sem Docker: coleta, contador e rate()") }),
      el("p", { class: "csim-sub", text: t("The three jobs of the lab's prometheus.yml. Each service counts its requests in " + METRIC + "; Prometheus samples the counter on every scrape and rate() turns the samples into requests per second. Click a service to stop it or break its metrics_path.",
        "Os três jobs do prometheus.yml do lab. Cada serviço conta suas requisições em " + METRIC + "; o Prometheus amostra o contador a cada coleta e o rate() transforma as amostras em requisições por segundo. Clique num serviço para pará-lo ou quebrar seu metrics_path.") }),
      el("div", { class: "csim-stage" }, svg),
      expo,
      el("div", { class: "csim-row" }, [sLoad, cRoute]),
      el("div", { class: "csim-row" }, [cInt, cWin]),
      el("div", { class: "csim-row" }, [bStop, bPath]),
      note,
      player,
      el("div", { class: "csim-cols" }, [el("div", {}, [chart, query]), el("div", {}, [tiles, term])])
    ]);
    reset();
    return {};
  });
})();
