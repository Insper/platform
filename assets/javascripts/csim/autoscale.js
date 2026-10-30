/*
 * Horizontal Pod Autoscaler (2027.1, Cloud native — Kubernetes, autoscaling):
 *
 *   <div class="csim" data-sim="autoscale" data-traffic="flash"></div>
 *
 * 30 minutes of traffic on `catalog` (a daily ramp, compressed, or the 10:00 on-sale spike). At every
 * HPA sync the model computes desired = ⌈ready × CPU / target⌉ and applies lab 10's behavior (LAB:
 * the scale-up and scale-down policies and the stabilization window of catalog-hpa.yaml). A new pod
 * serves only after its start-up time. Each pod may burst from its CPU request to its CPU limit
 * (catalog.yaml), so it saturates at limit ÷ request of its request: traffic above the ready pods'
 * limit is dropped or slow. data-target/min/max/startup/stabilization override the defaults.
 */
(function () {
  "use strict";

  var DT = 5, SYNC = 15, T = 1800;     /* step and run length (s); SYNC is Kubernetes' default HPA sync period */
  /* lab 10: k8s/base/catalog-hpa.yaml (target, replicas, behavior) and catalog.yaml (CPU request and limit, millicores) */
  var LAB = { target: 60, min: 2, max: 8, stabilization: 120, upPercent: 100, upPods: 2, upPeriod: 15,
    downPods: 1, downPeriod: 30, request: 250, limit: 1000 };
  /* not from the lab: a JVM's start-up (the class page's box) and the CPU one request costs (m·s) */
  var MODEL = { startup: 40, cpuPerReq: 5 };

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function lerp(a, b, f) { return a + (b - a) * Math.max(0, Math.min(1, f)); }

  /* requests per second at time s (0 = 09:55), ±4% noise */
  function traffic(name, seed) {
    var r = rng(seed || 3), out = [];
    for (var s = 0; s <= T; s += DT) {
      var m = s / 60, v;
      if (name === "daily") {
        v = m < 12 ? lerp(30, 220, m / 12)
          : m < 15 ? 220
          : m < 15.5 ? lerp(220, 90, (m - 15) * 2)   /* a short dip … */
          : m < 18 ? 90
          : m < 18.5 ? lerp(90, 220, (m - 18) * 2)   /* … and back */
          : m < 23 ? 220 : lerp(220, 50, (m - 23) / 7);
      } else {
        v = s < 300 ? 30
          : s < 310 ? lerp(30, 600, (s - 300) / 10)  /* the on-sale opens at 10:00 */
          : m < 13 ? 600 : m < 20 ? lerp(600, 120, (m - 13) / 7) : 120;
      }
      out.push(Math.round(v * (0.96 + 0.08 * r())));
    }
    return out;
  }

  /* the whole run, sampled every 5 s */
  function simulate(load, o) {
    var p = {};
    [LAB, MODEL].forEach(function (src) { Object.keys(src).forEach(function (k) { p[k] = o[k] !== undefined ? o[k] : src[k]; }); });
    var cap = p.limit / p.cpuPerReq;               /* req/s one pod serves at its limit */
    var pods = [], recs = [], out = [];
    var countAt = function (when) { var i = Math.floor(when / DT); return i < 0 ? p.min : out[Math.min(i, out.length - 1)].pods; };
    for (var i = 0; i < p.min; i++) pods.push(-Infinity);   /* ready since forever */
    var dropped = 0, total = 0, podSec = 0, overSec = 0, firstOver = null, recovered = null, wanted = p.min;
    for (var k = 0; k < load.length; k++) {
      var t = k * DT;
      var ready = pods.filter(function (r) { return r <= t; }).length;
      var capacity = ready * cap, served = Math.min(load[k], capacity), lost = load[k] - served;
      var cpu = ready ? Math.min(maxCpu(p), 100 * load[k] * p.cpuPerReq / ready / p.request) : 0;
      dropped += lost * DT; total += load[k] * DT; podSec += pods.length * DT;
      if (lost > 0) { overSec += DT; if (firstOver === null) firstOver = t; recovered = null; }
      else if (firstOver !== null && recovered === null) recovered = t;
      if (t % SYNC === 0 && t > 0) {
        var ratio = cpu / p.target;
        var raw = Math.abs(ratio - 1) <= 0.1 ? pods.length : Math.ceil(ready * ratio);
        raw = Math.max(p.min, Math.min(p.max, raw));
        recs.push({ t: t, v: raw });
        recs = recs.filter(function (x) { return x.t > t - p.stabilization - 1e-9; });
        var n = pods.length;
        if (raw > n) {                                              /* selectPolicy: Max of the two up policies */
          var base = countAt(t - p.upPeriod);
          var upTo = Math.max(Math.ceil(base * (1 + p.upPercent / 100)), base + p.upPods);
          var add = Math.max(0, Math.min(raw, upTo) - n);
          for (var a = 0; a < add; a++) pods.push(t + p.startup);
        } else if (raw < n) {
          var down = Math.max.apply(null, recs.map(function (x) { return x.v; }));  /* highest in the window */
          var floor = Math.max(down, countAt(t - p.downPeriod) - p.downPods, p.min);
          pods.sort(function (x, y) { return x - y; });
          while (pods.length > floor) pods.pop();                   /* the newest pods go first */
        }
        wanted = pods.length;
      }
      out.push({ t: t, load: load[k], ready: ready, pods: pods.length, wanted: wanted, capacity: capacity, lost: lost, cpu: cpu });
    }
    return { series: out, dropped: dropped, total: total, replicaMinutes: podSec / 60, overSec: overSec, firstOver: firstOver, cap: cap, p: p };
  }

  /* CPU of a saturated pod, in % of its request (the limit) */
  function maxCpu(p) { return 100 * p.limit / p.request; }

  /* totals up to time `until` (s) */
  function upTo(run, until) {
    var d = 0, tot = 0, podSec = 0, over = 0;
    run.series.forEach(function (x) { if (x.t > until) return; d += x.lost * DT; tot += x.load * DT; podSec += x.pods * DT; if (x.lost > 0) over += DT; });
    return { dropped: d, total: tot, replicaMinutes: podSec / 60, overSec: over };
  }

  var API = { traffic: traffic, simulate: simulate, upTo: upTo, maxCpu: maxCpu, LAB: LAB, MODEL: MODEL, T: T, DT: DT };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var X0 = 36, X1 = 394, TICK = 15;
  function cores(m) { return m % 1000 ? m + "m" : m / 1000 + " CPU"; }
  function x(sec) { return X0 + (X1 - X0) * sec / T; }
  function clock(sec) { var m = 55 + Math.floor(sec / 60), h = 9 + Math.floor(m / 60); m %= 60; return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m; }
  function num(v) { return Math.round(v).toLocaleString(C.PT ? "pt-BR" : "en"); }
  function dec(v, d) { return v.toFixed(d).replace(".", C.PT ? "," : "."); }

  C.style("autoscale", [
    ".md-typeset .csim-as-load { fill: color-mix(in srgb, var(--c-ink) 18%, var(--c-bg)); stroke: var(--c-ink); stroke-width: 1.4; }",
    ".md-typeset .csim-as-future { fill: none; stroke: var(--c-fg3); stroke-width: 1; stroke-dasharray: 3 3; }",
    ".md-typeset .csim-as-cap { fill: none; stroke: var(--c-ok); stroke-width: 1.8; }",
    ".md-typeset .csim-as-lost { fill: color-mix(in srgb, var(--c-bad) 45%, var(--c-bg)); stroke: none; }",
    ".md-typeset .csim-as-want { fill: none; stroke: var(--c-accent); stroke-width: 1.4; stroke-dasharray: 4 3; }",
    ".md-typeset .csim-as-ready { fill: none; stroke: var(--c-ink); stroke-width: 2; }",
    ".md-typeset .csim-as-cpu { fill: none; stroke: var(--c-warn); stroke-width: 1.6; }",
    ".md-typeset .csim-as-target { stroke: var(--c-fg2); stroke-width: 1; stroke-dasharray: 4 3; }",
    ".md-typeset .csim-as-axis { stroke: var(--c-line); stroke-width: 1; }",
    ".md-typeset .csim-as-cur { stroke: var(--c-accent); stroke-width: 1.4; }"
  ].join("\n"));

  C.register("autoscale", function (root) {
    var o = C.opts(root, { traffic: "flash", target: LAB.target, min: LAB.min, max: LAB.max, startup: MODEL.startup, stabilization: LAB.stabilization });
    var pat = o.traffic === "daily" ? "daily" : "flash", now = 0, load, run;

    var svg = s("svg", { viewBox: "0 0 400 252", role: "img", "aria-label": t("Load, pods and CPU over time", "Carga, pods e CPU no tempo") });
    var note = el("p", { class: "csim-note" });
    var st = C.stats([
      { key: "lost", label: t("requests dropped or slow", "requisições perdidas ou lentas") },
      { key: "pods", label: t("pods ready / wanted", "pods prontos / desejados") },
      { key: "cpu", label: t("CPU (of request)", "CPU (do request)") },
      { key: "cost", label: t("replica-minutes (cost)", "réplica-minutos (custo)") }
    ]);
    function sl(label, min, max, step, value, fmt) {
      return C.slider({ label: label, min: min, max: max, step: step, value: value, fmt: fmt, onInput: rebuild });
    }
    var traf = C.choice({ label: t("Traffic", "Tráfego"), value: pat,
      options: [{ value: "daily", label: t("daily ramp", "rampa diária") }, { value: "flash", label: t("on-sale at 10:00", "abertura às 10:00") }],
      onChange: function (v) { pat = v; load = traffic(pat, 3); rebuild(); } });
    var sTarget = sl(t("Target CPU", "CPU alvo"), 20, 90, 5, o.target, function (v) { return v + "%"; });
    var sMin = sl(t("Min pods", "Mín. pods"), 1, 16, 1, o.min, String);
    var sMax = sl(t("Max pods", "Máx. pods"), 2, 16, 1, o.max, String);
    var sStart = sl(t("Pod start-up", "Início do pod"), 5, 180, 5, o.startup, function (v) { return v + " s"; });
    var sStab = sl(t("Scale-down window", "Janela de redução"), 0, 300, 15, o.stabilization, function (v) { return v + " s"; });

    function params() {
      var mn = sMin.get(), mx = Math.max(mn, sMax.get());
      return { target: sTarget.get(), min: mn, max: mx, startup: sStart.get(), stabilization: sStab.get() };
    }
    function rebuild() { run = simulate(load, params()); draw(); }
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    function path(sel, ymap, upto) {
      return run.series.filter(function (q) { return q.t <= upto; }).map(function (q, i) {
        return (i ? "L" : "M") + x(q.t).toFixed(1) + "," + ymap(sel(q)).toFixed(1);
      }).join(" ");
    }
    function steps(sel, ymap, upto) {
      var d = "", prev = null;
      run.series.forEach(function (q) {
        if (q.t > upto) return;
        var y = ymap(sel(q)).toFixed(1);
        d += prev === null ? "M" + x(q.t).toFixed(1) + "," + y : "H" + x(q.t).toFixed(1) + "V" + y;
        prev = y;
      });
      return d;
    }

    function narrate(cur, tot) {
      var p = run.p;
      if (now === 0) return say(pat === "flash"
        ? t("At 10:00 the on-sale opens: traffic jumps from 30 to 600 requests/s in 10 s. " + p.min + " pods serve up to " + num(p.min * run.cap) + "/s. Press play.",
          "Às 10:00 abrem as vendas: o tráfego salta de 30 para 600 requisições/s em 10 s. " + p.min + " pods atendem até " + num(p.min * run.cap) + "/s. Aperte play.")
        : t("A daily ramp, compressed into 30 min: from 30 to 220 requests/s, a short dip, then down. Press play.",
          "Uma rampa diária, comprimida em 30 min: de 30 para 220 requisições/s, uma queda curta, depois desce. Aperte play."), "");
      if (cur.lost > 0) return say(t("Over capacity: " + num(cur.load) + " req/s arrive, " + cur.ready + " ready pods serve " + num(cur.capacity) + ". The HPA already wants " + cur.pods +
        " pods, but new pods need " + p.startup + " s to start — the lag. " + num(tot.dropped) + " requests dropped or slow so far.",
        "Acima da capacidade: chegam " + num(cur.load) + " req/s, " + cur.ready + " pods prontos atendem " + num(cur.capacity) + ". O HPA já quer " + cur.pods +
        " pods, mas pods novos levam " + p.startup + " s para subir — o atraso. " + num(tot.dropped) + " requisições perdidas ou lentas até agora."), "bad");
      if (cur.pods >= p.max && cur.cpu > p.target * 1.1) return say(t("Max replicas reached: CPU stays at " + Math.round(cur.cpu) + "% of the request, above the " + p.target + "% target. maxReplicas is a cost cap — and the pods are running on their burst up to the " + cores(p.limit) + " limit.",
        "Máximo de réplicas atingido: a CPU fica em " + Math.round(cur.cpu) + "% do request, acima do alvo de " + p.target + "%. O maxReplicas é um teto de custo — e os pods estão vivendo do burst até o limite de " + cores(p.limit) + "."), "warn");
      if (cur.pods < cur.ready || cur.pods > cur.ready) return say(t("Scaling: " + cur.ready + " pods ready, " + cur.pods + " wanted.", "Escalando: " + cur.ready + " pods prontos, " + cur.pods + " desejados."), "warn");
      return say(t(cur.ready + " pods at " + Math.round(cur.cpu) + "% CPU (target " + p.target + "%). " + num(tot.dropped) + " requests dropped or slow, " + dec(tot.replicaMinutes, 0) + " replica-minutes so far.",
        cur.ready + " pods a " + Math.round(cur.cpu) + "% de CPU (alvo " + p.target + "%). " + num(tot.dropped) + " requisições perdidas ou lentas, " + dec(tot.replicaMinutes, 0) + " réplica-minutos até agora."), tot.dropped ? "warn" : "ok");
    }

    function draw() {
      C.clear(svg);
      var ser = run.series, p = run.p, peak = 0;
      ser.forEach(function (q) { peak = Math.max(peak, q.load); });
      var yMax = Math.ceil(peak * 1.25 / 100) * 100;
      var y1 = function (v) { return 100 - 84 * Math.min(1, v / yMax); };
      var y2 = function (v) { return 172 - 52 * Math.min(1, v / 16); };
      var top = maxCpu(p), y3 = function (v) { return 232 - 42 * Math.min(1, v / top); };
      /* axes and labels */
      [[16, 100, num(yMax) + " req/s"], [120, 172, "16 pods"], [190, 232, top + "%"]].forEach(function (a) {
        svg.appendChild(s("line", { x1: X0, x2: X1, y1: a[1], y2: a[1], class: "csim-as-axis" }));
        svg.appendChild(s("text", { x: X0 - 3, y: a[1] + 3, "text-anchor": "end", class: "c-small" }, "0"));
        svg.appendChild(s("text", { x: X0 - 3, y: a[0] + 3, "text-anchor": "end", class: "c-small" }, a[2].split(" ")[0]));
      });
      for (var m = 0; m <= 30; m += 5) svg.appendChild(s("text", { x: x(m * 60), y: 246, "text-anchor": "middle", class: "c-small" }, clock(m * 60)));
      /* 1: load vs capacity */
      svg.appendChild(s("path", { d: path(function (q) { return q.load; }, y1, T), class: "csim-as-future" }));
      if (now > 0) {
        var area = path(function (q) { return q.load; }, y1, now) + " L" + x(Math.min(now, T)).toFixed(1) + ",100 L" + X0 + ",100 Z";
        svg.appendChild(s("path", { d: area, class: "csim-as-load" }));
        ser.forEach(function (q) {
          if (q.t > now || q.lost <= 0) return;
          svg.appendChild(s("rect", { x: x(q.t), y: y1(q.load), width: Math.max(0.6, x(q.t + DT) - x(q.t)), height: y1(q.capacity) - y1(q.load), class: "csim-as-lost" }));
        });
        svg.appendChild(s("path", { d: steps(function (q) { return q.capacity; }, y1, now), class: "csim-as-cap" }));
      }
      svg.appendChild(s("text", { x: X0 + 4, y: 12, class: "c-small" }, t("load (req/s) · ", "carga (req/s) · ")));
      svg.appendChild(s("text", { x: X0 + 70, y: 12, class: "c-small c-ok" }, t("ready pods' capacity", "capacidade dos pods prontos")));
      svg.appendChild(s("text", { x: X1, y: 12, "text-anchor": "end", class: "c-small c-bad" }, t("dropped or slow", "perdidas ou lentas")));
      /* 2: pods */
      svg.appendChild(s("line", { x1: X0, x2: X1, y1: y2(p.max), y2: y2(p.max), class: "csim-as-target" }));
      svg.appendChild(s("text", { x: X1, y: y2(p.max) - 3, "text-anchor": "end", class: "c-small" }, "max " + p.max));
      if (now > 0) {
        svg.appendChild(s("path", { d: steps(function (q) { return q.pods; }, y2, now), class: "csim-as-want" }));
        svg.appendChild(s("path", { d: steps(function (q) { return q.ready; }, y2, now), class: "csim-as-ready" }));
      }
      svg.appendChild(s("text", { x: X0 + 4, y: 116, class: "c-small c-ink" }, t("pods ready", "pods prontos")));
      svg.appendChild(s("text", { x: X0 + 70, y: 116, class: "c-small" }, t("· wanted by the HPA (dashed)", "· desejados pelo HPA (tracejado)")));
      /* 3: CPU */
      svg.appendChild(s("line", { x1: X0, x2: X1, y1: y3(p.target), y2: y3(p.target), class: "csim-as-target" }));
      svg.appendChild(s("text", { x: X1, y: y3(p.target) - 3, "text-anchor": "end", class: "c-small" }, t("target ", "alvo ") + p.target + "%"));
      if (now > 0) svg.appendChild(s("path", { d: path(function (q) { return q.cpu; }, y3, now), class: "csim-as-cpu" }));
      svg.appendChild(s("text", { x: X0 + 4, y: 186, class: "c-small c-warn" }, t("CPU, % of the " + cores(p.request) + " request (limit " + cores(p.limit) + " = " + top + "%)", "CPU, % do request de " + cores(p.request) + " (limite " + cores(p.limit) + " = " + top + "%)")));
      svg.appendChild(s("line", { x1: x(now), x2: x(now), y1: 16, y2: 232, class: "csim-as-cur" }));

      var cur = ser[Math.min(ser.length - 1, Math.round(now / DT))], tot = upTo(run, now);
      st.set("lost", now ? num(tot.dropped) + " (" + dec(100 * tot.dropped / Math.max(1, tot.total), 1) + "%)" : "–", tot.dropped > 0.01 * tot.total ? "bad" : tot.dropped > 0 ? "warn" : now ? "ok" : "");
      st.set("pods", cur.ready + " / " + cur.pods, cur.ready < cur.pods ? "warn" : "");
      st.set("cpu", Math.round(cur.cpu) + "%", cur.cpu > 300 ? "bad" : cur.cpu > p.target * 1.1 ? "warn" : "ok");
      st.set("cost", now ? dec(tot.replicaMinutes, 0) : "–", "");
      narrate(cur, tot);
    }

    var bar = C.player({ interval: 150,
      onTick: function (k) { now = k * TICK; draw(); },
      onReset: function () { now = 0; draw(); },
      label: function (k) { return clock(k * TICK) + ":" + ((k * TICK) % 60 < 10 ? "0" : "") + (k * TICK) % 60; } });
    bar.total(T / TICK);

    C.add(root, [
      el("p", { class: "csim-title", text: t("Can the HPA keep up with the traffic?", "O HPA consegue acompanhar o tráfego?") }),
      el("p", { class: "csim-sub", text: t("catalog's HPA with lab 10's settings: every 15 s it recomputes the pods it wants; a pod serves only after it has started.",
        "O HPA do catalog com as configurações do lab 10: a cada 15 s ele recalcula os pods que quer; um pod só atende depois de subir.") }),
      el("div", { class: "csim-row" }, [traf, sTarget]),
      el("div", { class: "csim-row" }, [sMin, sMax]),
      el("div", { class: "csim-row" }, [sStart, sStab]),
      el("div", { class: "csim-stage" }, svg),
      st,
      note,
      bar
    ]);
    load = traffic(pat, 3);
    rebuild();
    return {};
  });
})();
