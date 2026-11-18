/*
 * What reliability costs: UDP vs TCP over a lossy link (appendix — network/transport):
 *
 *   <div class="csim" data-sim="tcp" data-loss="10" data-seed="4"></div>
 *
 * A sender sends 20 segments, one every 10 ms, over a link with 40 ms one-way delay that loses
 * each packet with probability `loss` % (seeded, the same first losses for both protocols).
 * UDP sends at once and the application gets whatever arrives, with gaps. TCP first spends one
 * round trip on the handshake, retransmits a segment when its timer (200 ms, doubled at every
 * retry) runs out, and hands the bytes to the application in order: a segment that arrived after
 * a lost one waits in the receive buffer (head-of-line blocking). Simplified: ACKs are never
 * lost, there is no congestion control and no fast retransmit.
 */
(function () {
  "use strict";

  var N = 20, GAP = 10, DELAY = 40, RTO = 200, MAX_TRIES = 12;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* the whole run of both protocols, in ms */
  function simulate(o) {
    o = o || {};
    var n = o.n || N, loss = (o.loss === undefined ? 10 : o.loss) / 100, seed = o.seed || 4;
    var gap = o.gap || GAP, delay = o.delay || DELAY, rto = o.rto || RTO;
    var first = mulberry32(seed), retry = mulberry32(seed ^ 0x9e3779b9);
    var lostFirst = [];
    for (var i = 0; i < n; i++) lostFirst.push(first() < loss);

    /* UDP: no handshake, no retransmission */
    var udp = { segs: [], delivered: 0, lost: 0, done: 0 };
    for (i = 0; i < n; i++) {
      var sent = i * gap, arrive = lostFirst[i] ? null : sent + delay;
      udp.segs.push({ sent: sent, arrive: arrive });
      if (arrive === null) udp.lost++; else { udp.delivered++; udp.done = Math.max(udp.done, arrive); }
    }

    /* TCP: SYN, SYN-ACK, then data goes out with the ACK */
    var start = 2 * delay;
    var tcp = { segs: [], delivered: n, retrans: 0, held: 0, heldMs: 0, done: 0, handshake: start, rto: rto };
    var prev = 0;
    for (i = 0; i < n; i++) {
      var at = start + i * gap, lost = lostFirst[i], tries = [{ at: at, lost: lost }];
      for (var k = 0; lost && k < MAX_TRIES; k++) {
        at += rto * Math.pow(2, k);          /* the timer runs out; it doubles at each retry */
        lost = k + 1 < MAX_TRIES ? retry() < loss : false;
        tries.push({ at: at, lost: lost });
      }
      var arr = at + delay, deliver = Math.max(arr, prev);
      prev = deliver;
      tcp.retrans += tries.length - 1;
      if (deliver > arr) { tcp.held++; tcp.heldMs += deliver - arr; }
      tcp.segs.push({ tries: tries, arrive: arr, deliver: deliver });
    }
    tcp.done = prev;
    return { n: n, loss: loss, delay: delay, gap: gap, udp: udp, tcp: tcp, lostFirst: lostFirst };
  }

  /* what each segment looks like at time `now`:
     idle (not sent) · flight · lost (gone; TCP waits for the timer) · held (arrived, waiting for an earlier one) · got */
  function stateAt(sim, now) {
    var udp = sim.udp.segs.map(function (sg) {
      if (now < sg.sent) return "idle";
      if (sg.arrive === null) return now >= sg.sent + sim.delay ? "lost" : "flight";
      return now >= sg.arrive ? "got" : "flight";
    });
    var retrans = 0;
    var tcp = sim.tcp.segs.map(function (sg) {
      var cur = null;
      sg.tries.forEach(function (tr, i) { if (tr.at <= now) { cur = tr; if (i) retrans++; } });
      if (!cur) return "idle";
      if (now >= sg.deliver) return "got";
      if (now >= sg.arrive) return "held";
      if (cur.lost && now >= cur.at + sim.delay) return "lost";
      return cur === sg.tries[0] ? "flight" : "resent";
    });
    var count = function (arr, v) { return arr.filter(function (x) { return x === v; }).length; };
    return { udp: udp, tcp: tcp, retrans: retrans,
      udpGot: count(udp, "got"), tcpGot: count(tcp, "got"), tcpHeld: count(tcp, "held"),
      handshaking: now < sim.tcp.handshake };
  }

  var API = { simulate: simulate, stateAt: stateAt, N: N, GAP: GAP, DELAY: DELAY, RTO: RTO };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var TICK = 10, CW = 23, X0 = 52;
  function ms(v) { return v.toLocaleString(C.PT ? "pt-BR" : "en-US") + " ms"; }

  C.style("tcp", [
    ".md-typeset .csim-tcp-cell { stroke-width: 1.2; transition: fill .2s, stroke .2s; }",
    ".md-typeset .csim-tcp-cell.idle { fill: var(--c-bg); stroke: var(--c-line); }",
    ".md-typeset .csim-tcp-cell.flight, .md-typeset .csim-tcp-cell.resent { fill: var(--c-tint); stroke: var(--c-ink); stroke-dasharray: 3 2; }",
    ".md-typeset .csim-tcp-cell.lost { fill: color-mix(in srgb, var(--c-bad) 18%, var(--c-bg)); stroke: var(--c-bad); stroke-dasharray: 3 2; }",
    ".md-typeset .csim-tcp-cell.held { fill: color-mix(in srgb, var(--c-warn) 45%, var(--c-bg)); stroke: var(--c-warn); }",
    ".md-typeset .csim-tcp-cell.got { fill: color-mix(in srgb, var(--c-ok) 55%, var(--c-bg)); stroke: var(--c-ok); }",
    ".md-typeset .csim-tcp-key { display: flex; flex-wrap: wrap; gap: .2rem .8rem; color: var(--c-fg2); font-size: .6rem; margin-top: .2rem; }",
    ".md-typeset .csim-tcp-key i { display: inline-block; width: .6rem; height: .6rem; margin-right: .25rem; vertical-align: middle; border: .05rem solid var(--c-line); }",
    ".md-typeset .csim-tcp-key i.flight { background: var(--c-tint); border: .05rem dashed var(--c-ink); }",
    ".md-typeset .csim-tcp-key i.lost { background: color-mix(in srgb, var(--c-bad) 18%, var(--c-bg)); border: .05rem dashed var(--c-bad); }",
    ".md-typeset .csim-tcp-key i.held { background: color-mix(in srgb, var(--c-warn) 45%, var(--c-bg)); border-color: var(--c-warn); }",
    ".md-typeset .csim-tcp-key i.got { background: color-mix(in srgb, var(--c-ok) 55%, var(--c-bg)); border-color: var(--c-ok); }",
    ".md-typeset .csim-tcp-side { display: flex; flex-wrap: wrap; gap: .8rem; }",
    ".md-typeset .csim-tcp-side > div { flex: 1 1 14rem; min-width: 0; }"
  ].join("\n"));

  C.register("tcp", function (root) {
    var o = C.opts(root, { loss: 10, seed: 4 });
    var sim, now = 0, seed = o.seed;

    var svg = s("svg", { viewBox: "0 0 " + (X0 + N * CW + 6) + " 120", role: "img",
      "aria-label": t("Segments received by the application, UDP and TCP", "Segmentos recebidos pela aplicação, UDP e TCP") });
    var note = el("p", { class: "csim-note" });
    var su = C.stats([
      { key: "got", label: t("delivered to the app", "entregues à aplicação") },
      { key: "lost", label: t("lost for good", "perdidos de vez") },
      { key: "done", label: t("last byte at", "último byte em") }
    ]);
    var sp = C.stats([
      { key: "got", label: t("delivered to the app", "entregues à aplicação") },
      { key: "re", label: t("retransmissions", "retransmissões") },
      { key: "held", label: t("held back behind a loss", "retidos atrás de uma perda") },
      { key: "done", label: t("last byte at", "último byte em") }
    ]);
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    var loss = C.slider({ label: t("Packet loss", "Perda de pacotes"), min: 0, max: 30, step: 1, value: o.loss,
      fmt: function (v) { return v + "%"; }, onInput: function () { rebuild(); } });
    var bSeed = C.button(t("other losses", "outras perdas"), function () { seed++; rebuild(); },
      { title: t("Same loss rate, different random losses", "Mesma taxa, outras perdas aleatórias") });

    function rebuild() {
      sim = simulate({ loss: loss.get(), seed: seed });
      player.reset();
    }

    var player = C.player({
      interval: 90,
      label: function () { return "t = " + ms(now); },
      onTick: function () {
        now += TICK;
        draw();
        if (now >= Math.max(sim.tcp.done, sim.udp.done, sim.udp.segs[N - 1].sent + sim.delay)) { finish(); return false; }
      },
      onReset: function () { now = 0; draw(); intro(); }
    });

    function intro() {
      var lost = sim.lostFirst.filter(Boolean).length;
      say(t("20 segments, 1 every 10 ms, 40 ms each way. With these losses, " + lost + " of the 20 first transmissions will not arrive. Press play.",
        "20 segmentos, 1 a cada 10 ms, 40 ms em cada sentido. Com estas perdas, " + lost + " das 20 primeiras transmissões não vão chegar. Aperte play."), "");
    }
    function finish() {
      var u = sim.udp, p = sim.tcp;
      say(t("UDP was done at " + ms(u.done) + " with " + u.delivered + "/20 segments (" + u.lost + " gaps the application must live with). TCP delivered all 20, in order, at " +
        ms(p.done) + ": " + p.retrans + " retransmission(s), " + p.held + " segment(s) that had arrived but waited for an earlier one.",
        "O UDP terminou em " + ms(u.done) + " com " + u.delivered + "/20 segmentos (" + u.lost + " lacunas com que a aplicação tem de conviver). O TCP entregou os 20, em ordem, em " +
        ms(p.done) + ": " + p.retrans + " retransmissão(ões), " + p.held + " segmento(s) que tinham chegado mas esperaram um anterior."), p.held ? "warn" : "ok");
    }

    function lane(y, states, label) {
      svg.appendChild(s("text", { x: 0, y: y + 15, class: "c-label" }, label));
      states.forEach(function (st, i) {
        var r = s("rect", { x: X0 + i * CW, y: y, width: CW - 4, height: 22, rx: 3, class: "csim-tcp-cell " + st });
        r.appendChild(s("title", {}, "#" + (i + 1) + " " + st));
        svg.appendChild(r);
        svg.appendChild(s("text", { x: X0 + i * CW + (CW - 4) / 2, y: y + 15, "text-anchor": "middle", class: "c-small" }, String(i + 1)));
      });
    }

    function draw() {
      var x = stateAt(sim, now);
      C.clear(svg);
      lane(10, x.udp, "UDP");
      svg.appendChild(s("text", { x: X0, y: 48, class: "c-small" },
        t("app has " + x.udpGot + "/20 · gaps are never filled", "app tem " + x.udpGot + "/20 · lacunas nunca são preenchidas")));
      lane(62, x.tcp, "TCP");
      svg.appendChild(s("text", { x: X0, y: 100, class: "c-small" }, x.handshaking
        ? t("handshake: SYN → SYN-ACK (no data yet)", "handshake: SYN → SYN-ACK (ainda sem dados)")
        : t("app has " + x.tcpGot + "/20 · " + x.tcpHeld + " waiting in the buffer · " + x.retrans + " resent",
          "app tem " + x.tcpGot + "/20 · " + x.tcpHeld + " esperando no buffer · " + x.retrans + " reenviados")));
      su.set("got", x.udpGot + "/20", x.udpGot === 20 ? "ok" : now >= sim.udp.done ? "warn" : "");
      su.set("lost", String(x.udp.filter(function (v) { return v === "lost"; }).length), x.udp.indexOf("lost") >= 0 ? "bad" : "");
      su.set("done", now >= sim.udp.done && sim.udp.done ? ms(sim.udp.done) : "–", "");
      sp.set("got", x.tcpGot + "/20", x.tcpGot === 20 ? "ok" : "");
      sp.set("re", String(x.retrans), x.retrans ? "warn" : "");
      sp.set("held", String(x.tcpHeld), x.tcpHeld ? "warn" : "");
      sp.set("done", now >= sim.tcp.done ? ms(sim.tcp.done) : "–", "");
      player.refresh();
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("What does reliability cost? UDP and TCP over the same lossy link", "Quanto custa a confiabilidade? UDP e TCP no mesmo enlace com perdas") }),
      el("p", { class: "csim-sub", text: t("Each box is a segment as the receiving application sees it. Same losses for both; TCP's timer is 200 ms and doubles at each retry.",
        "Cada caixa é um segmento como a aplicação receptora o vê. Mesmas perdas para os dois; o timer do TCP é de 200 ms e dobra a cada nova tentativa.") }),
      el("div", { class: "csim-row" }, [loss, bSeed]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-tcp-key" }, [
        el("span", {}, [el("i", { class: "flight" }), t("in flight", "a caminho")]),
        el("span", {}, [el("i", { class: "lost" }), t("lost", "perdido")]),
        el("span", {}, [el("i", { class: "held" }), t("arrived, waiting for an earlier segment", "chegou, esperando um segmento anterior")]),
        el("span", {}, [el("i", { class: "got" }), t("delivered to the app", "entregue à aplicação")])
      ]),
      el("div", { class: "csim-tcp-side" }, [
        el("div", {}, [el("div", { class: "csim-lbl", text: "UDP" }), su]),
        el("div", {}, [el("div", { class: "csim-lbl", text: "TCP" }), sp])
      ]),
      note,
      player
    ]);
    sim = simulate({ loss: o.loss, seed: seed });
    draw(); intro();
    return {};
  });
})();
