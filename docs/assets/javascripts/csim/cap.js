/*
 * CAP and PACELC (2027.1, distributed — CAP & PACELC):
 *
 *   <div class="csim" data-sim="cap" data-mode="CP" data-rtt="180"></div>
 *
 * Two replicas of event 42's seat count, in São Paulo (the event's home region, where the CP
 * leader lives) and Lisbon, one fan on each side holding seats and reading the count. A switch
 * cuts the transatlantic link. CP (PC/EC): writes replicate synchronously, so every write pays
 * the round trip; during a partition the side without the leader refuses. AP (PA/EL): each side
 * writes locally and replicates asynchronously, so writes are fast but reads can be stale, and
 * after a partition last-write-wins keeps one side's value and silently drops confirmed holds.
 */
(function () {
  "use strict";

  var DT = 15;   /* ms of simulated time per tick */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function create(o) {
    o = o || {};
    return {
      now: 0, mode: o.mode === "AP" ? "AP" : "CP", rtt: o.rtt || 180, local: o.local || 4, seats0: o.seats || 100,
      timeout: o.timeout || 1000, partitioned: false, rnd: mulberry32(o.seed || 7),
      rep: { sp: { holds: [], ts: 0 }, lis: { holds: [], ts: 0 } },
      msgs: [], dropped: [], pending: {}, nextId: 1,
      confirmed: [], lost: [], last: { sp: null, lis: null }, said: {},
      stats: { wOk: 0, wErr: 0, rOk: 0, rStale: 0, rErr: 0, wLat: 0 }, events: []
    };
  }
  function other(r) { return r === "sp" ? "lis" : "sp"; }
  function seats(st, r) { return st.seats0 - st.rep[r].holds.length; }
  function emit(st, tone, en, pt) { st.events.push({ tone: tone, en: en, pt: pt, at: st.now }); }
  /* say it once (until the next partition switch) */
  function once(st, key) { if (st.said[key]) return false; st.said[key] = true; return true; }
  function send(st, kind, from, data) {
    var m = { kind: kind, from: from, to: other(from), sent: st.now, at: st.now + st.rtt / 2, data: data };
    st.msgs.push(m);
    return m;
  }
  /* LWW timestamp: the wall clock (perfect here), Lisbon wins exact ties */
  function stamp(st, r) { return st.now + 1 + (r === "lis" ? 0.5 : 0); }
  function stale(st, r) { return st.rep[r].ts < st.rep[other(r)].ts; }

  function reply(st, req, ok, text, tone) {
    var lat = st.now - req.t0 + st.local;
    delete st.pending[req.id];
    if (req.op === "hold") {
      if (ok) { st.stats.wOk++; st.stats.wLat += lat; st.confirmed.push(req.hold); }
      else st.stats.wErr++;
    } else if (!ok) st.stats.rErr++;
    st.last[req.client] = { text: text, tone: tone, lat: lat, at: st.now };
    return lat;
  }

  /* LWW: the newer timestamp replaces the whole value */
  function applyLww(st, r, holds, ts) {
    if (ts <= st.rep[r].ts) return false;
    st.rep[r] = { holds: holds.slice(), ts: ts };
    return true;
  }
  function checkLost(st) {
    var all = {};
    ["sp", "lis"].forEach(function (r) { st.rep[r].holds.forEach(function (h) { all[h] = true; }); });
    var fresh = st.confirmed.filter(function (h) { return !all[h] && st.lost.indexOf(h) < 0; });
    if (fresh.length) {
      st.lost = st.lost.concat(fresh);
      emit(st, "bad", "Last-write-wins kept the newer value and dropped " + fresh.length + " confirmed hold(s) (" + fresh.join(", ") + "): those fans were told 'held', yet the count no longer reserves their seats — they can be sold again.",
        "O last-write-wins ficou com o valor mais novo e descartou " + fresh.length + " reserva(s) confirmada(s) (" + fresh.join(", ") + "): esses fãs ouviram 'reservado', mas a contagem não guarda mais os assentos — eles podem ser vendidos de novo.");
    }
  }

  /* a fan asks its region: op "hold" (one seat less) or "read" */
  function request(st, client, op) {
    var req = { id: st.nextId++, client: client, op: op, t0: st.now };
    if (op === "hold") req.hold = (client === "sp" ? "S" : "L") + req.id;
    var me = st.rep[client];
    if (op === "hold" && seats(st, client) <= 0) { st.last[client] = { text: "sold out", tone: "warn", lat: st.local, at: st.now }; return req; }
    if (st.mode === "CP") {
      if (st.partitioned && client === "lis") {
        reply(st, req, false, "503", "bad");
        if (once(st, "refuse")) emit(st, "bad", "Lisbon refuses: it cannot reach the leader in São Paulo, so it cannot know whether its copy is current. Unavailable, but never wrong.",
          "Lisboa recusa: não alcança o líder em São Paulo, então não sabe se sua cópia está atual. Indisponível, mas nunca errada.");
        return req;
      }
      if (op === "read") { reply(st, req, true, seats(st, client) + "", "ok"); st.stats.rOk++; return req; }
      st.pending[req.id] = req;
      if (client === "sp") {
        me.holds.push(req.hold); me.ts = stamp(st, "sp");
        if (st.partitioned) reply(st, req, true, "OK", "ok");
        else send(st, "repl", "sp", { holds: me.holds.slice(), ts: me.ts, req: req.id });
      } else send(st, "fwd", "lis", { req: req.id, hold: req.hold });
      return req;
    }
    /* AP: answer from the local copy, replicate later */
    if (op === "read") {
      var isStale = stale(st, client);
      st.stats.rOk++;
      if (isStale) st.stats.rStale++;
      reply(st, req, true, seats(st, client) + (isStale ? "?" : ""), isStale ? "warn" : "ok");
      if (isStale && once(st, "stale")) emit(st, "warn", "Stale read in " + (client === "sp" ? "São Paulo" : "Lisbon") + ": " + seats(st, client) + " seats, while the other region already has a newer value.",
        "Leitura velha em " + (client === "sp" ? "São Paulo" : "Lisboa") + ": " + seats(st, client) + " assentos, enquanto a outra região já tem um valor mais novo.");
      return req;
    }
    me.holds.push(req.hold); me.ts = stamp(st, client);
    reply(st, req, true, "OK", "ok");
    send(st, "repl", client, { holds: me.holds.slice(), ts: me.ts });
    if (!st.partitioned && once(st, "async")) emit(st, "", "Asynchronous replication: the hold was confirmed in " + st.local + " ms, from the local copy only; the other region hears about it " + st.rtt / 2 + " ms later (EL). A read there in between is stale.",
      "Replicação assíncrona: a reserva foi confirmada em " + st.local + " ms, só com a cópia local; a outra região fica sabendo " + st.rtt / 2 + " ms depois (EL). Uma leitura lá nesse meio-tempo é velha.");
    return req;
  }

  function deliver(st, m) {
    var d = m.data, req = d.req ? st.pending[d.req] : null;
    if (m.kind === "fwd") {                     /* CP: the leader appends Lisbon's hold */
      var L = st.rep.sp;
      L.holds.push(d.hold); L.ts = stamp(st, "sp");
      send(st, "repl", "sp", { holds: L.holds.slice(), ts: L.ts, req: d.req, origin: "lis" });
    } else if (m.kind === "repl" && st.mode === "CP") {
      st.rep.lis = { holds: d.holds.slice(), ts: d.ts };
      if (d.origin === "lis") {
        if (req) {
          var ll = reply(st, req, true, "OK", "ok");
          if (once(st, "sync")) emit(st, "", "Lisbon forwarded the hold to the leader and answered once its own copy had it: " + ll + " ms, one ocean round trip (EC).",
            "Lisboa encaminhou a reserva ao líder e respondeu quando a própria cópia a recebeu: " + ll + " ms, uma ida e volta oceânica (EC).");
        }
      }
      else send(st, "ack", "lis", { req: d.req });
    } else if (m.kind === "ack") {
      if (req) {
        var lat = reply(st, req, true, "OK", "ok");
        if (once(st, "sync")) emit(st, "", "Synchronous replication: São Paulo answered only after Lisbon stored the hold — " + lat + " ms, one ocean round trip on every write (EC).",
          "Replicação síncrona: São Paulo só respondeu depois que Lisboa gravou a reserva — " + lat + " ms, uma ida e volta oceânica em cada escrita (EC).");
      }
    } else {                                    /* AP replication or anti-entropy after a heal */
      applyLww(st, m.to, d.holds, d.ts);
      checkLost(st);
    }
  }

  /* advance the clock by one tick; optional random traffic from both fans */
  function tick(st, traffic) {
    st.now += DT;
    var due = st.msgs.filter(function (m) { return m.at <= st.now; }).sort(function (a, b) { return a.at - b.at; });
    st.msgs = st.msgs.filter(function (m) { return m.at > st.now; });
    due.forEach(function (m) {
      if (st.partitioned) { st.dropped.push({ m: m, at: st.now }); return; }
      deliver(st, m);
    });
    st.dropped = st.dropped.filter(function (x) { return st.now - x.at < 300; });
    Object.keys(st.pending).forEach(function (id) {
      var req = st.pending[id];
      if (st.now - req.t0 >= st.timeout) {
        reply(st, req, false, "504", "bad");
        emit(st, "bad", "Timeout: the request waited " + st.timeout + " ms for the other region.", "Timeout: a requisição esperou " + st.timeout + " ms pela outra região.");
      }
    });
    if (traffic) ["sp", "lis"].forEach(function (c) {
      var r = st.rnd();
      if (r < 0.012) request(st, c, "hold");
      else if (r < 0.04) request(st, c, "read");
    });
  }

  function setPartition(st, on) {
    if (st.partitioned === on) return;
    st.partitioned = on;
    st.said = {};
    if (on) {
      if (st.mode === "CP") Object.keys(st.pending).forEach(function (id) {
        var req = st.pending[id];
        if (req.client === "sp") reply(st, req, true, "OK", "ok"); else reply(st, req, false, "503", "bad");
      });
      emit(st, "warn", "The link is down. " + (st.mode === "CP" ? "CP: São Paulo keeps the leadership and serves alone; Lisbon must refuse." : "AP: both regions keep accepting holds on their own copy."),
        "O link caiu. " + (st.mode === "CP" ? "CP: São Paulo mantém a liderança e atende sozinho; Lisboa precisa recusar." : "AP: as duas regiões continuam aceitando reservas na própria cópia."));
    } else {
      /* anti-entropy: each side ships its value; CP: Lisbon just catches up with the leader */
      if (st.mode === "CP") send(st, "sync", "sp", { holds: st.rep.sp.holds.slice(), ts: st.rep.sp.ts });
      else ["sp", "lis"].forEach(function (r) { send(st, "sync", r, { holds: st.rep[r].holds.slice(), ts: st.rep[r].ts }); });
      emit(st, "", "The link is back: the regions exchange their values. " + (st.mode === "CP" ? "Lisbon only catches up — nothing to reconcile." : "Two different values: last-write-wins will pick one."),
        "O link voltou: as regiões trocam seus valores. " + (st.mode === "CP" ? "Lisboa só se atualiza — nada a reconciliar." : "Dois valores diferentes: o last-write-wins vai escolher um."));
    }
  }

  function avgWrite(st) { return st.stats.wOk ? st.stats.wLat / st.stats.wOk : 0; }

  var API = { create: create, request: request, tick: tick, setPartition: setPartition, seats: seats, stale: stale, avgWrite: avgWrite, DT: DT };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var BOX = { sp: [24, 70], lis: [376, 70] }, BW = 200, BH = 120, LY = 130;

  C.style("cap", [
    ".md-typeset .csim-cap-region { fill: var(--c-panel); stroke: var(--c-line); stroke-width: 1; }",
    ".md-typeset .csim-cap-big { font-size: 26px; font-weight: 700; fill: var(--c-ink); font-variant-numeric: tabular-nums; }",
    ".md-typeset .csim-cap-big.stale { fill: var(--c-warn); }",
    ".md-typeset .csim-cap-big.down { fill: var(--c-fg3); }",
    ".md-typeset .csim-cap-fan { fill: var(--c-bg); stroke: var(--c-fg2); stroke-width: 1.4; }",
    ".md-typeset .csim-cap-bubble { stroke-width: 1.2; }",
    ".md-typeset .csim-cap-x { stroke: var(--c-bad); stroke-width: 2.4; }",
    ".md-typeset .csim-cap-ctl { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .4rem; margin: .3rem 0; }",
    ".md-typeset .csim-cap-ctl > span { display: flex; flex-wrap: wrap; gap: .3rem; align-items: center; }"
  ].join("\n"));

  C.register("cap", function (root) {
    var o = C.opts(root, { mode: "CP", rtt: 180 });
    var st, traffic = true, seen = 0;
    var svg = s("svg", { viewBox: "0 0 600 250", role: "img", "aria-label": t("Two regions and a transatlantic link", "Duas regiões e um link transatlântico") });
    var note = el("p", { class: "csim-note" });
    var log = C.log(6);
    var stt = C.stats([
      { key: "lat", label: t("average write latency", "latência média de escrita") },
      { key: "err", label: t("refused requests", "requisições recusadas") },
      { key: "stale", label: t("stale reads", "leituras velhas") },
      { key: "lost", label: t("confirmed holds lost", "reservas confirmadas perdidas") }
    ]);
    var mode = C.choice({
      label: t("Mode", "Modo"), value: o.mode === "AP" ? "AP" : "CP",
      options: [{ value: "CP", label: "CP · PC/EC", title: t("synchronous replication, one leader", "replicação síncrona, um líder") },
        { value: "AP", label: "AP · PA/EL", title: t("asynchronous replication, both sides write", "replicação assíncrona, os dois lados escrevem") }],
      onChange: function () { start(); }
    });
    var part = C.toggle({ label: t("partition the link", "particionar o link"), onChange: function (v) { setPartition(st, v); flush(); draw(); if (!bar.running()) bar.play(); } });
    var auto = C.toggle({ label: t("random traffic", "tráfego aleatório"), checked: true, onChange: function (v) { traffic = v; } });
    var bar = C.player({ interval: 220, onTick: function () { tick(st, traffic); flush(); draw(); },
      onReset: function () { start(); }, label: function () { return "t = " + (st ? (st.now / 1000).toFixed(2).replace(".", C.PT ? "," : ".") : "0") + " s"; } });

    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    function flush() {
      for (; seen < st.events.length; seen++) {
        var e = st.events[seen];
        log.add(t(e.en, e.pt), e.tone);
        say(t(e.en, e.pt), e.tone);
      }
    }
    function fan(client, op) {
      request(st, client, op);
      flush(); draw();
      if (!bar.running()) bar.play();
    }

    function start() {
      st = create({ mode: mode.get(), rtt: o.rtt, seed: 7 });
      seen = 0; part.set(false); log.clear();
      say(mode.get() === "CP"
        ? t("CP: São Paulo (the event's home region) leads and replicates every hold synchronously to Lisbon. Press play or hold a seat, then cut the link.",
          "CP: São Paulo (a região de origem do evento) lidera e replica cada reserva de forma síncrona para Lisboa. Aperte play ou reserve um assento, depois corte o link.")
        : t("AP: each region accepts holds on its own copy and replicates in the background. Press play or hold a seat, then cut the link.",
          "AP: cada região aceita reservas na própria cópia e replica em segundo plano. Aperte play ou reserve um assento, depois corte o link."), "");
      draw();
      if (bar) bar.refresh();
    }

    function region(r, x, y) {
      var down = st.mode === "CP" && st.partitioned && r === "lis";
      var isStale = st.mode === "AP" && stale(st, r);
      svg.appendChild(s("rect", { x: x, y: y, width: BW, height: BH, rx: 10, class: "csim-cap-region" }));
      svg.appendChild(s("text", { x: x + 10, y: y + 18, class: "c-label" }, r === "sp" ? "São Paulo · sa-east" : t("Lisbon · eu-west", "Lisboa · eu-west")));
      var role = st.mode === "CP" ? (r === "sp" ? t("leader", "líder") : down ? t("cut off: refusing", "isolada: recusando") : t("follower (sync)", "seguidora (síncrona)"))
        : t("accepts writes", "aceita escritas");
      svg.appendChild(s("text", { x: x + BW - 10, y: y + 18, "text-anchor": "end", class: "c-small" }, role));
      svg.appendChild(s("rect", { x: x + 40, y: y + 28, width: BW - 80, height: 62, rx: 8, class: "c-box " + (down ? "down" : isStale ? "warn" : "on") }));
      svg.appendChild(s("text", { x: x + BW / 2, y: y + 62, "text-anchor": "middle", class: "csim-cap-big" + (down ? " down" : isStale ? " stale" : "") }, seats(st, r)));
      svg.appendChild(s("text", { x: x + BW / 2, y: y + 80, "text-anchor": "middle", class: "c-small" }, t("seats left · event 42", "assentos livres · evento 42")));
      var hs = st.rep[r].holds, shown = hs.slice(-6).join(" ");
      svg.appendChild(s("text", { x: x + BW / 2, y: y + 108, "text-anchor": "middle", class: "c-mono" }, hs.length ? (hs.length > 6 ? "… " : "") + shown : t("no holds yet", "sem reservas")));
      /* the fan above */
      var fx = x + BW / 2, last = st.last[r];
      svg.appendChild(s("circle", { cx: fx, cy: 26, r: 10, class: "csim-cap-fan" }));
      svg.appendChild(s("line", { x1: fx, y1: 36, x2: fx, y2: y, class: "c-wire" + (last && st.now - last.at < 400 ? " on" : "") }));
      svg.appendChild(s("text", { x: fx - 16, y: 30, "text-anchor": "end", class: "c-small" }, r === "sp" ? t("fan in São Paulo", "fã em São Paulo") : t("fan in Lisbon", "fã em Lisboa")));
      if (last && st.now - last.at < 900) {
        svg.appendChild(s("text", { x: fx + 16, y: 24, class: "c-label c-" + last.tone }, last.text === "sold out" ? t("sold out", "esgotado") : /\?$/.test(last.text) ? last.text.slice(0, -1) + t(" (stale)", " (velho)") : last.text));
        svg.appendChild(s("text", { x: fx + 16, y: 37, class: "c-small" }, last.lat + " ms"));
      }
    }

    function draw() {
      C.clear(svg);
      var x1 = BOX.sp[0] + BW, x2 = BOX.lis[0];
      svg.appendChild(s("line", { x1: x1, y1: LY, x2: x2, y2: LY, class: "c-wire " + (st.partitioned ? "cut" : "on") }));
      svg.appendChild(s("text", { x: (x1 + x2) / 2, y: LY - 10, "text-anchor": "middle", class: "c-small" }, st.partitioned ? t("partition", "partição") : "RTT " + st.rtt + " ms"));
      if (st.partitioned) {
        var mx = (x1 + x2) / 2;
        svg.appendChild(s("line", { x1: mx - 7, y1: LY - 7 + 16, x2: mx + 7, y2: LY + 7 + 16, class: "csim-cap-x" }));
        svg.appendChild(s("line", { x1: mx - 7, y1: LY + 7 + 16, x2: mx + 7, y2: LY - 7 + 16, class: "csim-cap-x" }));
      }
      region("sp", BOX.sp[0], BOX.sp[1]);
      region("lis", BOX.lis[0], BOX.lis[1]);
      st.msgs.forEach(function (m) {
        var f = Math.min(1, (st.now - m.sent) / (m.at - m.sent));
        var a = m.from === "sp" ? x1 : x2, b = m.from === "sp" ? x2 : x1;
        var c = s("circle", { cx: a + (b - a) * f, cy: LY + (m.from === "sp" ? -4 : 4), r: m.kind === "sync" ? 6 : 4.5,
          class: "c-dot " + (m.kind === "ack" ? "ok" : m.kind === "sync" ? "ink" : "") });
        c.appendChild(s("title", {}, m.kind));
        svg.appendChild(c);
      });
      st.dropped.forEach(function (d) {
        var a = d.m.from === "sp" ? x1 : x2, b = d.m.from === "sp" ? x2 : x1;
        svg.appendChild(s("circle", { cx: (a + b) / 2 + (d.m.from === "sp" ? -10 : 10), cy: LY, r: 4, class: "c-dot bad" }));
      });
      svg.appendChild(s("text", { x: 300, y: 240, "text-anchor": "middle", class: "c-small" },
        st.mode === "CP" ? t("CP: every write waits for both copies", "CP: toda escrita espera as duas cópias") : t("AP: answer first, replicate later", "AP: responde antes, replica depois")));
      var avg = avgWrite(st), x = st.stats;
      stt.set("lat", x.wOk ? Math.round(avg) + " ms" : "–", !x.wOk ? "" : avg < 50 ? "ok" : avg < 300 ? "warn" : "bad");
      stt.set("err", String(x.wErr + x.rErr), x.wErr + x.rErr ? "bad" : "ok");
      stt.set("stale", x.rOk ? x.rStale + " / " + x.rOk : "0", x.rStale ? "warn" : "ok");
      stt.set("lost", String(st.lost.length), st.lost.length ? "bad" : "ok");
      bar.refresh();
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("CAP and PACELC: refuse, answer stale, or wait?", "CAP e PACELC: recusar, responder velho ou esperar?") }),
      el("p", { class: "csim-sub", text: t("Event 42's seat count is replicated in two regions. Each hold takes one seat (S… from São Paulo, L… from Lisbon). Dots on the link are replication messages.",
        "A contagem de assentos do evento 42 é replicada em duas regiões. Cada reserva tira um assento (S… de São Paulo, L… de Lisboa). Os pontos no link são mensagens de replicação.") }),
      el("div", { class: "csim-row" }, [mode, part, auto]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-cap-ctl" }, [
        el("span", {}, [C.button(t("hold a seat", "reservar assento"), function () { fan("sp", "hold"); }), C.button(t("read", "ler"), function () { fan("sp", "read"); })]),
        el("span", {}, [C.button(t("hold a seat", "reservar assento"), function () { fan("lis", "hold"); }), C.button(t("read", "ler"), function () { fan("lis", "read"); })])
      ]),
      stt,
      note,
      log,
      bar
    ]);
    start();
    return { destroy: function () { bar.pause(); } };
  });
})();
