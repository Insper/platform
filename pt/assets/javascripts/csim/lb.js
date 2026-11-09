/*
 * Load-balancing algorithms (2027.1, Traffic & edge — load balancing):
 *
 *   <div class="csim" data-sim="lb" data-algo="rr" data-rate="100" data-slow="off"></div>
 *
 * One load balancer in front of 4 `catalog` replicas, each a FIFO queue with one worker. The same
 * stream of requests (same arrival times, same service times) is routed by four algorithms at
 * once — round robin, random, least connections and power of two choices — so the chart compares
 * their p99 on identical traffic. The stage shows the chosen algorithm. Switching "catalog-3 slows
 * down" multiplies that replica's service time (a GC pause, a noisy neighbour): round robin and
 * random keep sending it a quarter of the traffic, least connections and P2C route around it.
 */
(function () {
  "use strict";

  var ALGOS = ["rr", "random", "lc", "p2c"];
  var N = 4, SLOW = 2, WINDOW = 2000;

  /* mulberry32: seeded, so a run can be replayed */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* o: {rate req/s, service ms (mean), factor (slowdown), seed} */
  function create(o) {
    o = o || {};
    var sim = { now: 0, slow: !!o.slow, rate: o.rate || 100, service: o.service || 25, factor: o.factor || 5,
      arrive: rng(o.seed || 7), next: 0, runs: {} };
    sim.next = gap(sim);
    ALGOS.forEach(function (a, i) {
      var reps = [];
      for (var r = 0; r < N; r++) reps.push({ deps: [], last: 0 });
      sim.runs[a] = { algo: a, reps: reps, rr: 0, pick: rng(101 + i), recs: [], routed: [0, 0, 0, 0] };
    });
    return sim;
  }
  function gap(sim) { return -Math.log(1 - sim.arrive()) * 1000 / sim.rate; }
  /* service time: 40% fixed + exponential, mean = service */
  function serviceTime(sim) { return sim.service * (0.4 + 0.6 * -Math.log(1 - sim.arrive())); }

  /* requests in the replica (waiting + being served) at time t */
  function inSystem(rep, t) {
    while (rep.deps.length && rep.deps[0] <= t) rep.deps.shift();
    return rep.deps.length;
  }

  function choose(run, t) {
    var reps = run.reps, i, best, n;
    if (run.algo === "rr") { i = run.rr % N; run.rr++; return i; }
    if (run.algo === "random") return Math.floor(run.pick() * N);
    if (run.algo === "lc") {
      best = -1; n = Infinity;
      for (var k = 0; k < N; k++) {            /* ties: rotate the starting point */
        i = (run.rr + k) % N;
        var c = inSystem(reps[i], t);
        if (c < n) { n = c; best = i; }
      }
      run.rr++;
      return best;
    }
    /* p2c: two different replicas at random, the one with fewer requests in flight */
    var a = Math.floor(run.pick() * N), b = Math.floor(run.pick() * (N - 1));
    if (b >= a) b++;
    return inSystem(reps[b], t) < inSystem(reps[a], t) ? b : a;
  }

  function route(sim, run, t, s) {
    var i = choose(run, t), rep = run.reps[i];
    var cost = i === SLOW && sim.slow ? s * sim.factor : s;
    var start = Math.max(t, rep.last), done = start + cost;
    rep.last = done;
    rep.deps.push(done);
    run.recs.push({ t: t, lat: done - t, r: i });
    run.routed[i]++;
    return i;
  }

  /* move the clock forward by dt ms, routing every arrival with every algorithm */
  function advance(sim, dt) {
    var until = sim.now + dt;
    while (sim.next <= until) {
      var t = sim.next, s = serviceTime(sim);
      ALGOS.forEach(function (a) { route(sim, sim.runs[a], t, s); });
      sim.next = t + gap(sim);
    }
    sim.now = until;
    ALGOS.forEach(function (a) {
      var recs = sim.runs[a].recs;
      while (recs.length && recs[0].t < until - WINDOW) recs.shift();
    });
  }

  function pct(sorted, p) {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  }

  /* latency of the requests sent in the last 2 s (FIFO: known when routed), queues now, share per replica */
  function metrics(sim, algo) {
    var run = sim.runs[algo];
    var lat = run.recs.map(function (r) { return r.lat; }).sort(function (a, b) { return a - b; });
    var share = [0, 0, 0, 0];
    run.recs.forEach(function (r) { share[r.r]++; });
    var queues = run.reps.map(function (rep) { return inSystem(rep, sim.now); });
    return { p50: pct(lat, 0.5), p99: pct(lat, 0.99), queues: queues, maxQueue: Math.max.apply(null, queues),
      share: share.map(function (c) { return run.recs.length ? c / run.recs.length : 0; }) };
  }

  var API = { create: create, advance: advance, metrics: metrics, inSystem: inSystem, ALGOS: ALGOS, SLOW: SLOW };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var TICK = 200, STEPS = 150;
  var NAMES = { rr: t("round robin", "round robin"), random: t("random", "aleatório"),
    lc: t("least connections", "menos conexões"), p2c: t("power of two (P2C)", "duas escolhas (P2C)") };
  var TONES = { rr: "tone-warn", random: "tone-mute dashed", lc: "tone-ink", p2c: "tone-ok" };

  function ms(v) {
    if (v >= 1000) return (v / 1000).toFixed(1).replace(".", C.PT ? "," : ".") + " s";
    return Math.round(v) + " ms";
  }
  function pc(f) { return Math.round(100 * f) + "%"; }

  C.style("lb", [
    ".md-typeset .csim-lb-q { fill: var(--c-ink); }",
    ".md-typeset .csim-lb-q.warn { fill: var(--c-warn); }",
    ".md-typeset .csim-lb-q.bad { fill: var(--c-bad); }",
    ".md-typeset .csim-lb-sel { stroke-width: 3.2; }"
  ].join("\n"));

  C.register("lb", function (root) {
    var o = C.opts(root, { algo: "rr", rate: 100, slow: false, factor: 5 });
    var algo = ALGOS.indexOf(o.algo) >= 0 ? o.algo : "rr";
    var sim, lastRouted, slowSince = null;

    var svg = s("svg", { viewBox: "0 0 360 210", role: "img", "aria-label": t("Load balancer and replicas", "Balanceador e réplicas") });
    var note = el("p", { class: "csim-note" });
    var st = C.stats([
      { key: "p50", label: "p50" },
      { key: "p99", label: t("p99 (last 2 s)", "p99 (últimos 2 s)") },
      { key: "q", label: t("longest queue", "maior fila") },
      { key: "share", label: t("share to catalog-3", "fatia para catalog-3") }
    ]);
    var chart = C.chart({ title: t("p99 latency per algorithm, same requests", "Latência p99 por algoritmo, mesmas requisições"),
      series: ALGOS.map(function (a) { return { label: NAMES[a], cls: TONES[a] }; }), max: 1000, len: STEPS, unit: " ms" });

    var pick = C.choice({
      label: t("Algorithm", "Algoritmo"), value: algo,
      options: ALGOS.map(function (a) { return { value: a, label: NAMES[a] }; }),
      onChange: function (v) { algo = v; draw(); }
    });
    var sw = C.toggle({ label: t("catalog-3 slows down (×" + o.factor + ")", "catalog-3 fica lento (×" + o.factor + ")"),
      checked: o.slow, title: t("a GC pause or a noisy neighbour", "uma pausa de GC ou um vizinho barulhento"),
      onChange: function (v) { sim.slow = v; slowSince = v ? sim.now : null; draw(); } });

    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    function reset() {
      sim = create({ rate: o.rate, factor: o.factor, slow: sw.get(), seed: 7 });
      slowSince = sw.get() ? 0 : null;
      lastRouted = [0, 0, 0, 0];
      chart.reset();
      draw();
    }

    function tick() {
      var before = sim.runs[algo].routed.slice();
      advance(sim, TICK);
      lastRouted = sim.runs[algo].routed.map(function (c, i) { return c - before[i]; });
      chart.push(ALGOS.map(function (a) { return metrics(sim, a).p99; }));
      draw();
    }

    function narrate(m) {
      var name = NAMES[algo];
      if (sim.now === 0) return say(t("Press play: " + o.rate + " requests/s reach the balancer, each replica serves about 40/s.",
        "Aperte play: " + o.rate + " requisições/s chegam ao balanceador, cada réplica atende cerca de 40/s."), "");
      if (!sim.slow) return say(t("All replicas are equally fast: every algorithm keeps the queues short (" + name + ": p99 " + ms(m.p99) + "). Now slow catalog-3 down.",
        "Todas as réplicas são igualmente rápidas: todo algoritmo mantém as filas curtas (" + name + ": p99 " + ms(m.p99) + "). Agora deixe o catalog-3 lento."), "");
      if (sim.now - slowSince < 1000) return say(t("catalog-3 now takes " + o.factor + "× longer per request: it serves about " + Math.round(40 / o.factor) + "/s.",
        "O catalog-3 agora leva " + o.factor + "× mais por requisição: atende cerca de " + Math.round(40 / o.factor) + "/s."), "warn");
      var sh = pc(m.share[SLOW]);
      if (algo === "rr" || algo === "random") return say(t(name[0].toUpperCase() + name.slice(1) + " does not look at the replicas: catalog-3 still gets " + sh +
        " of the requests, more than it can serve. Its queue only grows, and every request sent there waits behind it — p99 " + ms(m.p99) + ".",
        "Com " + name + ", o LB não olha as réplicas: o catalog-3 ainda recebe " + sh + " das requisições, mais do que consegue atender. A fila dele só cresce, e toda requisição mandada para lá espera atrás dela — p99 " + ms(m.p99) + "."), "bad");
      return say(t(name[0].toUpperCase() + name.slice(1) + " sees catalog-3's requests piling up and sends it only " + sh +
        " of the traffic: the slow replica gets what it can handle, the others absorb the rest — p99 " + ms(m.p99) + ".",
        "Com " + name + ", o LB vê as requisições se acumulando no catalog-3 e manda para ele só " + sh +
        " do tráfego: a réplica lenta recebe o que aguenta, as outras absorvem o resto — p99 " + ms(m.p99) + "."), "ok");
    }

    function draw() {
      var m = metrics(sim, algo);
      C.clear(svg);
      var lb = { x: 8, y: 82, w: 74, h: 46 };
      svg.appendChild(s("rect", { x: lb.x, y: lb.y, width: lb.w, height: lb.h, rx: 6, class: "c-box on" }));
      svg.appendChild(s("text", { x: lb.x + lb.w / 2, y: lb.y + 20, "text-anchor": "middle", class: "c-label" }, "LB"));
      svg.appendChild(s("text", { x: lb.x + lb.w / 2, y: lb.y + 35, "text-anchor": "middle", class: "c-small" }, algo === "lc" ? t("least conn.", "menos con.") : algo === "p2c" ? "P2C" : NAMES[algo]));
      var total = lastRouted.reduce(function (a, b) { return a + b; }, 0) || 1;
      for (var i = 0; i < N; i++) {
        var y = 10 + i * 50, bx = 262, by = y, q = m.queues[i], wait = Math.max(0, q - 1);
        var slow = i === SLOW && sim.slow;
        var tone = wait > 10 ? "bad" : wait > 3 ? "warn" : q ? "on" : "";
        var x0 = lb.x + lb.w, y0 = lb.y + lb.h / 2, x1 = 150, y1 = by + 18;
        var f = lastRouted[i] / total;
        svg.appendChild(s("path", { d: "M" + x0 + "," + y0 + " C" + (x0 + 40) + "," + y0 + " " + (x1 - 40) + "," + y1 + " " + x1 + "," + y1,
          class: "c-wire" + (f > 0 ? " on" : ""), "stroke-width": (1 + 8 * f).toFixed(1) }));
        svg.appendChild(s("text", { x: x1 - 4, y: y1 - 5, "text-anchor": "end", class: "c-small" }, lastRouted[i] ? "→ " + lastRouted[i] : ""));
        /* the queue: one square per waiting request, newest on the left */
        svg.appendChild(s("line", { x1: 150, x2: bx, y1: y1, y2: y1, class: "c-wire" }));
        var shown = Math.min(wait, 11);
        for (var k = 0; k < shown; k++) {
          svg.appendChild(s("rect", { x: bx - 10 - k * 9.6, y: y1 - 4, width: 8, height: 8, rx: 1.5,
            class: "csim-lb-q" + (wait > 10 ? " bad" : wait > 3 ? " warn" : "") }));
        }
        if (wait > shown) svg.appendChild(s("text", { x: bx - 4, y: y1 - 8, "text-anchor": "end", class: "c-small c-bad" }, "+" + (wait - shown) + t(" more", " a mais")));
        svg.appendChild(s("rect", { x: bx, y: by, width: 92, height: 36, rx: 5, class: "c-box " + (slow ? "warn" : tone) }));
        svg.appendChild(s("text", { x: bx + 46, y: by + 15, "text-anchor": "middle", class: "c-label" }, "catalog-" + (i + 1)));
        svg.appendChild(s("text", { x: bx + 46, y: by + 29, "text-anchor": "middle", class: "c-small" },
          (slow ? t("slow ×", "lento ×") + o.factor + " · " : "") + t("queue ", "fila ") + wait));
      }
      st.set("p50", ms(m.p50), m.p50 > 200 ? "bad" : m.p50 > 60 ? "warn" : "ok");
      st.set("p99", ms(m.p99), m.p99 > 1000 ? "bad" : m.p99 > 250 ? "warn" : "ok");
      st.set("q", String(Math.max(0, m.maxQueue - 1)), m.maxQueue > 11 ? "bad" : m.maxQueue > 4 ? "warn" : "ok");
      st.set("share", sim.now ? pc(m.share[SLOW]) : "–", sim.slow ? (m.share[SLOW] > 0.15 ? "bad" : "ok") : "");
      narrate(m);
    }

    var bar = C.player({ onTick: tick, onReset: reset, interval: 300,
      label: function (n) { return "t = " + (n * TICK / 1000).toFixed(1).replace(".", C.PT ? "," : ".") + " s"; } });
    bar.total(STEPS);

    C.add(root, [
      el("p", { class: "csim-title", text: t("Which algorithm routes around a slow replica?", "Qual algoritmo desvia de uma réplica lenta?") }),
      el("p", { class: "csim-sub", text: t("The same requests are routed by the four algorithms at once; the stage shows the one you pick. Squares are requests waiting in each replica's queue.",
        "As mesmas requisições são roteadas pelos quatro algoritmos ao mesmo tempo; o palco mostra o que você escolher. Os quadrados são requisições esperando na fila de cada réplica.") }),
      el("div", { class: "csim-row" }, [pick, sw]),
      el("div", { class: "csim-cols" }, [el("div", { class: "csim-stage" }, svg), el("div", {}, [st, chart])]),
      note,
      bar
    ]);
    reset();
    return {};
  });
})();
