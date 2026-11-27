/*
 * Lamport and vector clocks (2027.1, distributed — time & clocks):
 *
 *   <div class="csim" data-sim="clocks"></div>
 *
 * Three services (order, payment, inventory) as timelines. The student adds local events, sends
 * messages and delivers them; every event shows its Lamport timestamp and its vector clock.
 * Selecting two events tells whether one happened-before the other or they are concurrent,
 * according to the vector clocks, and what the Lamport numbers alone would suggest.
 */
(function () {
  "use strict";

  var PROCS = ["order", "payment", "inventory"];
  var INIT = ["o", "p", "i"];
  var MAX_EVENTS = 16;

  function create() {
    return { events: [], msgs: [], lam: [0, 0, 0], vc: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], count: [0, 0, 0] };
  }
  function addEvent(st, p, kind, extra) {
    st.count[p]++;
    var ev = { id: INIT[p] + st.count[p], p: p, kind: kind, seq: st.events.length, lamport: st.lam[p], vc: st.vc[p].slice() };
    Object.keys(extra || {}).forEach(function (k) { ev[k] = extra[k]; });
    st.events.push(ev);
    return ev;
  }
  /* rule 1: increment before each local event */
  function local(st, p, label) {
    st.lam[p]++; st.vc[p][p]++;
    return addEvent(st, p, "local", { label: label || "" });
  }
  /* rule 2: a send is an event; the message carries the clocks */
  function send(st, from, to, label) {
    st.lam[from]++; st.vc[from][from]++;
    var m = { id: "m" + (st.msgs.length + 1), from: from, to: to, lamport: st.lam[from], vc: st.vc[from].slice(), label: label || "", sendEv: null, recvEv: null };
    var ev = addEvent(st, from, "send", { msg: m.id, label: label || "" });
    m.sendEv = ev.id;
    st.msgs.push(m);
    return ev;
  }
  function pending(st, p) { return st.msgs.filter(function (m) { return m.to === p && !m.recvEv; }); }
  /* rule 3: on receipt, max(local, message) + 1; vectors take the element-wise max */
  function receive(st, p, msgId) {
    var m = msgId ? st.msgs.filter(function (x) { return x.id === msgId; })[0] : pending(st, p)[0];
    if (!m || m.recvEv || m.to !== p) return null;
    st.lam[p] = Math.max(st.lam[p], m.lamport) + 1;
    for (var k = 0; k < 3; k++) st.vc[p][k] = Math.max(st.vc[p][k], m.vc[k]);
    st.vc[p][p]++;
    var ev = addEvent(st, p, "recv", { msg: m.id, label: m.label });
    m.recvEv = ev.id;
    return ev;
  }
  /* "before": a → b; "after": b → a; "concurrent"; "same" */
  function compare(va, vb) {
    var le = true, ge = true;
    for (var k = 0; k < va.length; k++) { if (va[k] > vb[k]) le = false; if (va[k] < vb[k]) ge = false; }
    return le && ge ? "same" : le ? "before" : ge ? "after" : "concurrent";
  }
  function relation(a, b) { return compare(a.vc, b.vc); }
  function lamportOrder(a, b) { return a.lamport < b.lamport ? "<" : a.lamport > b.lamport ? ">" : "="; }
  function find(st, id) { return st.events.filter(function (e) { return e.id === id; })[0]; }

  /* the starting scenario: order pays, inventory does its own thing meanwhile */
  function preset() {
    var st = create();
    local(st, 0, "create order 981");
    local(st, 2, "hold A-12 expires");
    send(st, 0, 1, "OrderPlaced");
    local(st, 2, "release seat A-12");
    receive(st, 1);
    send(st, 1, 2, "PaymentConfirmed");
    receive(st, 2);
    return st;
  }

  var API = { PROCS: PROCS, create: create, local: local, send: send, receive: receive, pending: pending,
    compare: compare, relation: relation, lamportOrder: lamportOrder, preset: preset, find: find, MAX_EVENTS: MAX_EVENTS };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var W = 640, X0 = 112, X1 = 620, YS = [44, 116, 188];
  var NAMES_PT = ["order", "payment", "inventory"];

  C.style("clocks", [
    ".md-typeset .csim-ck-line { stroke: var(--cat); stroke-width: 2; opacity: .55; }",
    ".md-typeset .csim-ck-name { fill: var(--cat); font-weight: 700; font-size: 12px; }",
    ".md-typeset .csim-ck-ev { cursor: pointer; transition: opacity .25s; }",
    ".md-typeset .csim-ck-ev .csim-ck-dot { fill: var(--cat); stroke: var(--c-bg); stroke-width: 2; }",
    ".md-typeset .csim-ck-ev.recv .csim-ck-dot, .md-typeset .csim-ck-ev.send .csim-ck-dot { fill: var(--c-bg); stroke: var(--cat); stroke-width: 2.6; }",
    ".md-typeset .csim-ck-ev:hover .csim-ck-dot, .md-typeset .csim-ck-ev:focus .csim-ck-dot { stroke: var(--c-accent); }",
    ".md-typeset .csim-ck-ev:focus { outline: none; }",
    ".md-typeset .csim-ck-ev.past .csim-ck-halo { stroke: var(--c-ok); }",
    ".md-typeset .csim-ck-ev.future .csim-ck-halo { stroke: var(--c-ink); }",
    ".md-typeset .csim-ck-ev.sel .csim-ck-halo { stroke: var(--c-accent); stroke-width: 3; stroke-dasharray: none; }",
    ".md-typeset .csim-ck-halo { fill: none; stroke: none; stroke-width: 2; stroke-dasharray: 3 2; }",
    ".md-typeset .csim-ck-ev.conc { opacity: .4; }",
    ".md-typeset .csim-ck-ev.rest { opacity: .55; }",
    ".md-typeset .csim-ck-msg { stroke: var(--c-fg2); stroke-width: 1.3; fill: none; }",
    ".md-typeset .csim-ck-head { fill: var(--c-fg2); }",
    ".md-typeset .csim-ck-msg.fly { stroke: var(--c-accent); stroke-dasharray: 5 4; }",
    ".md-typeset .csim-ck-head.fly { fill: var(--c-accent); }",
    ".md-typeset .csim-ck-ctl { display: grid; grid-template-columns: auto 1fr; gap: .3rem .6rem; align-items: center; margin: .4rem 0; }",
    ".md-typeset .csim-ck-ctl > b { color: var(--cat); }",
    ".md-typeset .csim-ck-ctl > span { display: flex; flex-wrap: wrap; gap: .3rem; }",
    ".md-typeset .csim-ck-legend { display: flex; flex-wrap: wrap; gap: .2rem .9rem; color: var(--c-fg2); font-size: .6rem; }",
    ".md-typeset .csim-ck-legend i { display: inline-block; width: .55rem; height: .55rem; border-radius: 50%; margin-right: .25rem; vertical-align: -.05rem; border: .12rem dashed var(--tone); }"
  ].join("\n"));

  C.register("clocks", function (root) {
    var st, sel;
    var svg = s("svg", { viewBox: "0 0 " + W + " 222", role: "img", "aria-label": t("Three timelines with their clocks", "Três linhas do tempo com seus relógios") });
    var note = el("p", { class: "csim-note" });
    var stt = C.stats([
      { key: "pair", label: t("selected events", "eventos selecionados") },
      { key: "lam", label: t("Lamport numbers say", "os números de Lamport dizem") },
      { key: "vc", label: t("vector clocks say", "os relógios vetoriais dizem") },
      { key: "n", label: t("events / messages", "eventos / mensagens") }
    ]);
    var ctl = el("div", { class: "csim-ck-ctl" });

    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    function vcs(v) { return "[" + v.join(",") + "]"; }
    function name(p) { return C.PT ? NAMES_PT[p] : PROCS[p]; }

    function act(fn) {
      if (st.events.length >= MAX_EVENTS) { say(t("The timeline is full: restart or clear it.", "A linha do tempo está cheia: recomece ou limpe."), "warn"); return; }
      var ev = fn();
      if (!ev) return;
      sel = [ev.id];
      describeNew(ev);
      draw();
    }

    function describeNew(ev) {
      if (ev.kind === "local") say(t(ev.id + " is a local event of " + name(ev.p) + ": its counters go up by one (L=" + ev.lamport + ", V=" + vcs(ev.vc) + "). Green rings mark what happened before it; dimmed events are concurrent with it.",
        ev.id + " é um evento local de " + name(ev.p) + ": os contadores sobem um (L=" + ev.lamport + ", V=" + vcs(ev.vc) + "). Os anéis verdes marcam o que aconteceu antes; os eventos apagados são concorrentes a ele."), "");
      else if (ev.kind === "send") say(t(ev.id + " sends " + ev.msg + " to " + name(st.msgs[+ev.msg.slice(1) - 1].to) + ", carrying L=" + ev.lamport + " and V=" + vcs(ev.vc) + ". Deliver it with that service's receive button.",
        ev.id + " envia " + ev.msg + " para " + name(st.msgs[+ev.msg.slice(1) - 1].to) + ", levando L=" + ev.lamport + " e V=" + vcs(ev.vc) + ". Entregue-a com o botão de receber desse serviço."), "");
      else {
        var m = st.msgs[+ev.msg.slice(1) - 1];
        say(t(ev.id + " receives " + m.id + ": L = max(local, " + m.lamport + ") + 1 = " + ev.lamport + "; V = element-wise max with " + vcs(m.vc) + ", then +1 on its own entry = " + vcs(ev.vc) + ". Everything before " + m.sendEv + " is now in its past.",
          ev.id + " recebe " + m.id + ": L = max(local, " + m.lamport + ") + 1 = " + ev.lamport + "; V = máximo elemento a elemento com " + vcs(m.vc) + ", depois +1 na própria posição = " + vcs(ev.vc) + ". Tudo antes de " + m.sendEv + " agora está no seu passado."), "ok");
      }
    }

    function pick(id) {
      if (!sel.length || sel.length === 2) sel = [id];
      else if (sel[0] === id) sel = [];
      else sel = [sel[0], id];
      if (sel.length === 2) explainPair();
      else if (sel.length === 1) say(t("Now select a second event to compare with " + sel[0] + ". Green rings: its past; blue rings: its future; dimmed: concurrent.",
        "Agora selecione um segundo evento para comparar com " + sel[0] + ". Anéis verdes: o passado; azuis: o futuro; apagados: concorrentes."), "");
      draw();
    }

    function explainPair() {
      var a = find(st, sel[0]), b = find(st, sel[1]);
      var r = relation(a, b), lo = lamportOrder(a, b);
      var A = a.id + " " + vcs(a.vc), B = b.id + " " + vcs(b.vc);
      if (r === "concurrent") {
        say(t(lo === "=" ? "Same Lamport number (" + a.lamport + "), and the vectors " + A + " and " + B + " are incomparable: concurrent. A tie broken by process id would order them, but no message links them."
          : "L(" + a.id + ") = " + a.lamport + " " + lo + " L(" + b.id + ") = " + b.lamport + " looks like an order, but the vectors " + A + " and " + B + " are incomparable (each is larger somewhere): the events are concurrent. Lamport numbers alone cannot tell this apart from happened-before.",
          lo === "=" ? "Mesmo número de Lamport (" + a.lamport + "), e os vetores " + A + " e " + B + " são incomparáveis: concorrentes. Um desempate pelo id do processo os ordenaria, mas nenhuma mensagem os liga."
          : "L(" + a.id + ") = " + a.lamport + " " + lo + " L(" + b.id + ") = " + b.lamport + " parece uma ordem, mas os vetores " + A + " e " + B + " são incomparáveis (cada um é maior em alguma posição): os eventos são concorrentes. Os números de Lamport sozinhos não distinguem isso de aconteceu-antes."), "warn");
      } else {
        var first = r === "before" ? a : b, second = r === "before" ? b : a;
        say(t(first.id + " → " + second.id + ": " + vcs(first.vc) + " ≤ " + vcs(second.vc) + " in every position, so a chain of events and messages links them. Here the Lamport numbers agree (" + first.lamport + " < " + second.lamport + "), as they always must for happened-before.",
          first.id + " → " + second.id + ": " + vcs(first.vc) + " ≤ " + vcs(second.vc) + " em todas as posições, então uma cadeia de eventos e mensagens os liga. Aqui os números de Lamport concordam (" + first.lamport + " < " + second.lamport + "), como sempre acontece com aconteceu-antes."), "ok");
      }
    }

    function stats() {
      stt.set("n", st.events.length + " / " + st.msgs.length, st.events.length >= MAX_EVENTS ? "warn" : "");
      if (sel.length === 2) {
        var a = find(st, sel[0]), b = find(st, sel[1]), r = relation(a, b), lo = lamportOrder(a, b);
        stt.set("pair", a.id + " · " + b.id, "");
        stt.set("lam", "L " + a.lamport + " " + lo + " " + b.lamport, lo === "=" ? "" : r === "concurrent" ? "warn" : "ok");
        stt.set("vc", r === "concurrent" ? t("concurrent ∥", "concorrentes ∥") : r === "before" ? a.id + " → " + b.id : r === "after" ? b.id + " → " + a.id : "=",
          r === "concurrent" ? "bad" : "ok");
      } else {
        stt.set("pair", sel.length ? sel[0] + " · ?" : "–", "");
        stt.set("lam", "–", ""); stt.set("vc", "–", "");
      }
    }

    function xOf(seq) {
      var n = Math.max(st.events.length, 8);
      return X0 + 14 + seq * Math.min(46, (X1 - X0 - 28) / (n - 1));
    }

    function arrow(x1, y1, x2, y2, cls) {
      var a = Math.atan2(y2 - y1, x2 - x1), r = 9, hx = x2 - r * Math.cos(a), hy = y2 - r * Math.sin(a);
      svg.appendChild(s("line", { x1: x1, y1: y1, x2: hx, y2: hy, class: "csim-ck-msg " + cls }));
      var p = function (da, d) { return (hx - d * Math.cos(a + da)).toFixed(1) + "," + (hy - d * Math.sin(a + da)).toFixed(1); };
      svg.appendChild(s("polygon", { points: hx.toFixed(1) + "," + hy.toFixed(1) + " " + p(0.4, 7) + " " + p(-0.4, 7), class: "csim-ck-head " + cls }));
    }

    function draw() {
      C.clear(svg);
      YS.forEach(function (y, p) {
        svg.appendChild(s("text", { x: 8, y: y + 4, class: "csim-ck-name cat-" + p }, name(p)));
        svg.appendChild(s("line", { x1: X0, x2: X1, y1: y, y2: y, class: "csim-ck-line cat-" + p }));
      });
      /* messages: delivered as arrows, in flight as dashed arrows to the receiver's line */
      st.msgs.forEach(function (m) {
        var se = find(st, m.sendEv);
        var x1 = xOf(se.seq), y1 = YS[m.from];
        if (m.recvEv) { var re = find(st, m.recvEv); arrow(x1, y1, xOf(re.seq), YS[m.to], ""); }
        else {
          arrow(x1, y1, Math.min(X1, xOf(st.events.length) + 6), YS[m.to], "fly");
          svg.appendChild(s("text", { x: Math.min(X1, xOf(st.events.length) + 6), y: YS[m.to] + (m.to > m.from ? -12 : 20), "text-anchor": "middle", class: "c-small" }, m.id + t(" in flight", " no caminho")));
        }
      });
      var anchor = sel.length ? find(st, sel[0]) : null;
      var crowded = st.events.length > 11;
      st.events.forEach(function (ev) {
        var x = xOf(ev.seq), y = YS[ev.p], cls = "csim-ck-ev cat-" + ev.p + " " + ev.kind;
        if (sel.indexOf(ev.id) >= 0) cls += " sel";
        else if (anchor && sel.length === 1) {
          var r = relation(ev, anchor);
          cls += r === "before" ? " past" : r === "after" ? " future" : " conc";
        } else if (sel.length === 2) cls += " rest";
        var g = s("g", { class: cls, tabindex: 0, role: "button", onclick: function () { pick(ev.id); },
          onkeydown: function (e) { if (e.key === "Enter") { e.stopPropagation(); pick(ev.id); } } });
        g.appendChild(s("circle", { cx: x, cy: y, r: 11, class: "csim-ck-halo" }));
        g.appendChild(s("circle", { cx: x, cy: y, r: 6, class: "csim-ck-dot" }));
        g.appendChild(s("text", { x: x, y: y - 14, "text-anchor": "middle", class: "c-small" }, ev.id + " · L" + ev.lamport));
        g.appendChild(s("text", { x: x, y: y + (crowded && ev.seq % 2 ? 33 : 22), "text-anchor": "middle", class: "c-mono" }, vcs(ev.vc)));
        g.appendChild(s("title", {}, ev.id + (ev.label ? " — " + ev.label : "") + "\nLamport " + ev.lamport + ", vector " + vcs(ev.vc)));
        svg.appendChild(g);
      });
      stats();
      buildControls();
    }

    function buildControls() {
      C.clear(ctl);
      var full = st.events.length >= MAX_EVENTS;
      PROCS.forEach(function (_, p) {
        var btns = [C.button(t("+ local event", "+ evento local"), function () { act(function () { return local(st, p, ""); }); })];
        PROCS.forEach(function (_, q) {
          if (q !== p) btns.push(C.button(t("send → ", "enviar → ") + name(q), function () { act(function () { return send(st, p, q, ""); }); }));
        });
        var pend = pending(st, p);
        var rb = C.button(t("receive", "receber") + (pend.length ? " " + pend[0].id + (pend.length > 1 ? " (+" + (pend.length - 1) + ")" : "") : ""),
          function () { act(function () { return receive(st, p); }); }, { tone: pend.length ? "ok" : "" });
        rb.disabled = !pend.length || full;
        btns.push(rb);
        btns.forEach(function (b) { if (b !== rb) b.disabled = full; });
        ctl.appendChild(el("b", { class: "cat-" + p, text: name(p) }));
        ctl.appendChild(el("span", {}, btns));
      });
    }

    function start(empty) {
      st = empty ? create() : preset();
      sel = empty ? [] : ["i2", "p1"];
      if (empty) say(t("Empty timelines: add events and messages, then click two events to compare them.",
        "Linhas vazias: adicione eventos e mensagens, depois clique em dois eventos para compará-los."), "");
      else explainPair();
      draw();
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("Lamport vs vector clocks: did it happen before, or at the same time?", "Lamport vs relógios vetoriais: aconteceu antes, ou ao mesmo tempo?") }),
      el("p", { class: "csim-sub", text: t("Each event shows its id, its Lamport number (L) and its vector [order, payment, inventory]. Click two events to compare them; hollow dots are sends and receipts.",
        "Cada evento mostra seu id, seu número de Lamport (L) e seu vetor [order, payment, inventory]. Clique em dois eventos para compará-los; pontos vazados são envios e recebimentos.") }),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-ck-legend" }, [
        el("span", { class: "tone-ok" }, [el("i"), t("happened before the selected event", "aconteceu antes do evento selecionado")]),
        el("span", { class: "tone-ink" }, [el("i"), t("happened after it", "aconteceu depois")]),
        el("span", {}, t("dimmed: concurrent", "apagado: concorrente"))
      ]),
      ctl,
      el("div", { class: "csim-row" }, [
        C.button(t("restart the scenario", "recomeçar o cenário"), function () { start(false); }),
        C.button(t("clear", "limpar"), function () { start(true); })
      ]),
      stt,
      note
    ]);
    start(false);
    return {};
  });
})();
