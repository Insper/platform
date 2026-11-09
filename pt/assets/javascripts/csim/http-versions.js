/*
 * Thirty API calls over four HTTP stacks (2027.1, Traffic & edge — protocols):
 *
 *   <div class="csim" data-sim="http-versions" data-rtt="150" data-loss="0" data-lane="h2"></div>
 *
 * The event screen of the BoxOffice app makes 30 small API calls at once (the page's "Think first").
 * The same 30 calls, the same round-trip time and the same lost packets go through four stacks:
 *   - h1new: HTTP/1.1 with a new TCP + TLS 1.2 connection per call, 6 at a time (4 RTT per call);
 *   - h1ka:  HTTP/1.1 over 6 kept-alive connections with TLS 1.3 (2 RTT once, then 1 request at a
 *            time per connection);
 *   - h2:    HTTP/2, one TCP + TLS 1.3 connection, the 30 requests multiplexed;
 *   - h3:    HTTP/3 over QUIC, TLS 1.3 built in (1 RTT to set up), the 30 requests multiplexed.
 * Each response is PKTS packets; a multiplexed server interleaves the responses packet by packet. A
 * packet is lost with probability `loss` (seeded per call and packet, so every stack loses the same
 * ones) and arrives one round trip late, after the retransmission. TCP hands bytes to the application
 * in order, per connection: every packet behind a lost one waits (head-of-line blocking), whichever
 * response it belongs to. QUIC orders bytes per stream: only the stream that lost a packet waits.
 * Simplified: handshake packets and requests are never lost, no congestion control, no server time,
 * a fixed serialization time per packet.
 */
(function () {
  "use strict";

  var CALLS = 30, PARALLEL = 6, PKTS = 3, SER = 0.0001;   /* 30 calls, 6 connections per host, 3 packets per response, 0.1 ms per packet */
  var LANES = ["h1new", "h1ka", "h2", "h3"];
  var SETUP = { h1new: 3, h1ka: 2, h2: 2, h3: 1 };          /* round trips before the first request: TCP + TLS 1.2 = 3, TCP + TLS 1.3 = 2, QUIC = 1 */

  /* a lost packet? the same answer for every stack: hash of (seed, call, packet) */
  function lost(seed, call, k, loss) {
    if (!loss) return false;
    var x = (seed * 374761393 + call * 668265263 + k * 2246822519) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    return x / 4294967296 < loss;
  }

  /*
   * One stack: returns per call {start, ready, first, done, own, blocked, lostPkts} (seconds) and the
   * time the screen is complete. `start` = the call is issued, `ready` = its request leaves (connection
   * set up), `first` = first byte back, `own` = when it would end if only its own packets mattered.
   */
  function simulate(lane, o) {
    var rtt = o.rtt / 1000, loss = (o.loss || 0) / 100, seed = o.seed || 1;
    var calls = [];
    for (var i = 0; i < CALLS; i++) calls.push({ i: i, start: 0, lostPkts: 0 });

    /* deliver the packets of one connection; seq = [{call, k, sent}] in send order */
    function deliver(seq, perStream) {
      var lastConn = 0, lastStream = {};
      seq.forEach(function (p) {
        var c = calls[p.call], arrive = p.sent + rtt / 2, isLost = lost(seed, p.call, p.k, loss);
        if (isLost) { arrive += rtt; c.lostPkts++; }
        var prev = perStream ? (lastStream[p.call] || 0) : lastConn;
        var got = Math.max(arrive, prev);
        if (perStream) lastStream[p.call] = got; else lastConn = got;
        if (p.k === 0) c.first = arrive;
        c.ownLast = Math.max(c.ownLast || 0, arrive);
        c.done = Math.max(c.done || 0, got);
      });
    }
    function respond(callIdx, at) { var seq = []; for (var k = 0; k < PKTS; k++) seq.push({ call: callIdx, k: k, sent: at + k * SER }); return seq; }

    if (lane === "h1new") {
      var slots = [];
      for (var s = 0; s < PARALLEL; s++) slots.push(0);
      calls.forEach(function (c) {
        var j = 0;
        for (var s = 1; s < PARALLEL; s++) if (slots[s] < slots[j]) j = s;
        c.start = slots[j];
        c.ready = c.start + SETUP.h1new * rtt;
        deliver(respond(c.i, c.ready + rtt / 2), false);
        slots[j] = c.done;
      });
    } else if (lane === "h1ka") {
      var free = [];
      for (var s = 0; s < PARALLEL; s++) free.push(SETUP.h1ka * rtt);
      calls.forEach(function (c) {
        var j = c.i % PARALLEL;
        c.ready = free[j];
        deliver(respond(c.i, c.ready + rtt / 2), false);
        free[j] = c.done;
      });
    } else {
      var ready = SETUP[lane] * rtt, seq = [], n = 0;
      calls.forEach(function (c) { c.ready = ready; });
      for (var k = 0; k < PKTS; k++) for (var i = 0; i < CALLS; i++) seq.push({ call: i, k: k, sent: ready + rtt / 2 + (n++) * SER });
      deliver(seq, lane === "h3");
    }
    var end = 0, blocked = 0, dones = calls.map(function (c) { return c.done; }).sort(function (a, b) { return a - b; });
    calls.forEach(function (c) {
      c.own = c.ownLast;
      c.blocked = c.done > c.own + 1e-9;
      if (c.blocked) blocked++;
      end = Math.max(end, c.done);
    });
    return { lane: lane, calls: calls, end: end, half: dones[CALLS / 2 - 1], blocked: blocked, lost: calls.reduce(function (s, c) { return s + c.lostPkts; }, 0) };
  }
  function all(o) { var out = {}; LANES.forEach(function (l) { out[l] = simulate(l, o); }); return out; }

  var API = { CALLS: CALLS, PARALLEL: PARALLEL, PKTS: PKTS, LANES: LANES, SETUP: SETUP, lost: lost, simulate: simulate, all: all };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  var NAMES = {
    h1new: [t("HTTP/1.1 · new connection per call", "HTTP/1.1 · conexão nova por chamada"), "TCP + TLS 1.2 · 6"],
    h1ka: [t("HTTP/1.1 · 6 kept-alive connections", "HTTP/1.1 · 6 conexões reaproveitadas"), "TCP + TLS 1.3 · keep-alive"],
    h2: [t("HTTP/2 · 1 connection", "HTTP/2 · 1 conexão"), "TCP + TLS 1.3"],
    h3: [t("HTTP/3 · QUIC", "HTTP/3 · QUIC"), "UDP + TLS 1.3"]
  };
  function ms(x) { var v = Math.round(x * 1000); return v >= 1000 ? (PT ? (v / 1000).toFixed(2).replace(".", ",") : (v / 1000).toFixed(2)) + " s" : v + " ms"; }

  C.style("http-versions", [
    ".md-typeset .csim .csim-hv-wait { fill: var(--c-line); }",
    ".md-typeset .csim .csim-hv-req { fill: var(--c-tint2); }",
    ".md-typeset .csim .csim-hv-rx { fill: var(--c-ink); }",
    ".md-typeset .csim .csim-hv-hol { fill: var(--c-bad); opacity: .55; }",
    ".md-typeset .csim .csim-hv-cursor { stroke: var(--c-accent); stroke-width: 1.5; }",
    ".md-typeset .csim .csim-hv-axis line { stroke: var(--c-line); }",
    ".md-typeset .csim-hv-legend { display: flex; flex-wrap: wrap; gap: .2rem .9rem; color: var(--c-fg2); font-size: .6rem; margin: .1rem 0 .3rem; }",
    ".md-typeset .csim-hv-legend i { display: inline-block; width: .8rem; height: .5rem; margin-right: .3rem; vertical-align: middle; border-radius: .1rem; }",
    ".md-typeset .csim-hv-legend .w i { background: var(--c-line); } .md-typeset .csim-hv-legend .q i { background: var(--c-tint2); }",
    ".md-typeset .csim-hv-legend .r i { background: var(--c-ink); } .md-typeset .csim-hv-legend .h i { background: var(--c-bad); opacity: .55; }",
    ".md-typeset .csim-hv-legend .l i { background: var(--c-bad); border-radius: 50%; width: .5rem; }"
  ].join("\n"));

  C.register("http-versions", function (root) {
    var o = C.opts(root, { rtt: 150, loss: 0, lane: "h2", seed: 3 });
    var lane = LANES.indexOf(o.lane) >= 0 ? o.lane : "h2", seed = o.seed, res, cursor = 0, STEPS = 40;

    var W = 620, ROW = 6.4, TOP = 16, LEFT = 30, H = TOP + CALLS * ROW + 22;
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": t("Waterfall of the 30 calls", "Cascata das 30 chamadas") });
    var tiles = C.stats(LANES.map(function (l) { return { key: l, label: NAMES[l][0] }; }));
    var note = el("p", { class: "csim-note" });
    var rtt = C.slider({ label: t("round trip (RTT)", "ida e volta (RTT)"), min: 10, max: 200, step: 10, value: o.rtt, fmt: function (v) { return v + " ms"; }, onInput: recompute });
    var loss = C.slider({ label: t("packet loss", "perda de pacotes"), min: 0, max: 10, step: 1, value: o.loss, fmt: function (v) { return v + "%"; }, onInput: recompute });
    var cLane = C.choice({ label: t("waterfall of", "cascata de"), value: lane, options: LANES.map(function (l) { return { value: l, label: { h1new: "1.1 new", h1ka: "1.1 keep-alive", h2: "HTTP/2", h3: "HTTP/3" }[l] }; }),
      onChange: function (v) { lane = v; draw(); } });
    var reseed = C.button(t("other lost packets", "outros pacotes perdidos"), function () { seed++; recompute(); });
    var player = C.player({ interval: 120, onTick: function (k) { cursor = k / STEPS; draw(); }, onReset: function () { cursor = 0; draw(); } });
    player.total(STEPS);

    function recompute() {
      res = all({ rtt: rtt.get(), loss: loss.get(), seed: seed });
      var best = LANES.reduce(function (b, l) { return res[l].end < res[b].end ? l : b; }, "h3");
      LANES.forEach(function (l) {
        var r = res[l], hol = r.blocked ? " · " + r.blocked + t(" blocked", " bloqueadas") : "";
        tiles.set(l, ms(r.end) + hol, l === best ? "ok" : r.end > 2 * res[best].end ? "bad" : "warn");
      });
      cursor = 1; player.jump(STEPS);
      draw();
    }

    function draw() {
      C.clear(svg);
      var r = res[lane], tmax = r.end * 1.06, scale = (W - LEFT - 8) / tmax;
      var now = cursor * r.end;
      var x = function (v) { return LEFT + v * scale; };
      /* axis */
      var axis = s("g", { class: "csim-hv-axis" }), stepT = niceStep(tmax);
      for (var v = 0; v <= tmax; v += stepT) {
        axis.appendChild(s("line", { x1: x(v), x2: x(v), y1: TOP - 4, y2: TOP + CALLS * ROW }));
        axis.appendChild(s("text", { x: x(v), y: TOP + CALLS * ROW + 12, class: "c-small", "text-anchor": "middle" }, ms(v)));
      }
      svg.appendChild(axis);
      svg.appendChild(s("text", { x: LEFT, y: 10, class: "c-small" }, NAMES[lane][0] + " · " + NAMES[lane][1] + " — " + t("screen complete at ", "tela completa em ") + ms(r.end)));
      r.calls.forEach(function (c, i) {
        var y = TOP + i * ROW, h = ROW - 1.4;
        function seg(a, b, cls, min) { if (b >= a && a < now) svg.appendChild(s("rect", { x: x(a), y: y, width: Math.max(min || 0.6, (Math.min(b, now) - a) * scale), height: h, class: cls })); }
        seg(c.start, c.ready, "csim-hv-wait");
        seg(c.ready, c.first, "csim-hv-req");
        seg(c.first, Math.min(c.done, c.own), "csim-hv-rx", 2.5);
        if (c.blocked) seg(c.own, c.done, "csim-hv-hol");
        if (c.lostPkts && c.first < now) svg.appendChild(s("circle", { cx: x(c.first) - 3, cy: y + h / 2, r: 2, class: "c-fill-bad" }));
        if (i % 5 === 0) svg.appendChild(s("text", { x: LEFT - 4, y: y + h, class: "c-small", "text-anchor": "end" }, String(i + 1)));
      });
      svg.appendChild(s("line", { x1: x(now), x2: x(now), y1: TOP - 6, y2: TOP + CALLS * ROW, class: "csim-hv-cursor" }));
      var lostN = r.lost, half = " " + t("Half of the calls were back at ", "Metade das chamadas voltou em ") + ms(r.half) + ".";
      note.textContent = (lostN
        ? (lane === "h3"
          ? t(lostN + " packet(s) lost: QUIC orders bytes per stream, so only the calls that lost a packet wait for the retransmission (" + r.blocked + " blocked by others).",
              lostN + " pacote(s) perdido(s): o QUIC ordena os bytes por stream, então só as chamadas que perderam um pacote esperam a retransmissão (" + r.blocked + " bloqueadas por outras).")
          : t(lostN + " packet(s) lost: TCP delivers in order, so " + r.blocked + " call(s) wait (red) for a packet that belongs to another call — head-of-line blocking.",
              lostN + " pacote(s) perdido(s): o TCP entrega em ordem, então " + r.blocked + " chamada(s) esperam (vermelho) por um pacote de outra chamada — bloqueio de cabeça de fila (HOL)."))
        : t("No loss: the difference is only round trips — connection setup (grey) and requests waiting for a free connection.",
            "Sem perda: a diferença são só idas e voltas — abrir conexões (cinza) e requisições esperando uma conexão livre.")) + half;
      note.className = "csim-note" + (r.blocked ? " csim-warn" : "");
    }
    function niceStep(m) { var raw = m / 6, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The event screen's 30 API calls over HTTP/1.1, HTTP/2 and HTTP/3", "As 30 chamadas de API da tela do evento sobre HTTP/1.1, HTTP/2 e HTTP/3") }),
      el("p", { class: "csim-sub", text: t("Same calls, same round trip, same lost packets in the four stacks. The tiles say when each stack completes the screen; the waterfall shows one of them, call by call.",
        "Mesmas chamadas, mesma ida e volta, mesmos pacotes perdidos nas quatro pilhas. Os blocos dizem quando cada pilha completa a tela; a cascata mostra uma delas, chamada por chamada.") }),
      el("div", { class: "csim-row" }, [rtt, loss, reseed]),
      tiles,
      el("div", { class: "csim-row" }, [cLane]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-hv-legend" }, [
        el("span", { class: "w" }, [el("i"), t("opening the connection / waiting for one", "abrindo a conexão / esperando uma")]),
        el("span", { class: "q" }, [el("i"), t("request → first byte", "requisição → primeiro byte")]),
        el("span", { class: "r" }, [el("i"), t("receiving", "recebendo")]),
        el("span", { class: "h" }, [el("i"), t("blocked behind another call's lost packet", "bloqueada atrás do pacote perdido de outra chamada")]),
        el("span", { class: "l" }, [el("i"), t("lost one of its own packets", "perdeu um pacote próprio")])
      ]),
      note,
      player
    ]);
    recompute();
    return {};
  });
})();
