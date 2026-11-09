/*
 * Kafka partitions and consumer groups (2027.1, class 9 — Kafka):
 *
 *   <div class="csim" data-sim="kafka" data-key="order"></div>
 *
 * data-partitions and data-consumers default to LAB: lab 7's topic order-events and the notification
 * consumer's NOTIFY_CONCURRENCY (registered in scripts/csim/lab-values.mjs).
 *
 * The order service writes OrderPlaced and, a moment later, OrderConfirmed for each order into
 * the topic order-events; the key picks the partition (Kafka's murmur2 mod P). A consumer group
 * shares the partitions (range assignor: one partition, one consumer); each consumer reads its
 * partitions in offset order and commits after each record. Killing a consumer stops the group
 * for a rebalance, then its partitions move to the survivors. The stats count lag, idle
 * consumers and orders whose OrderConfirmed was read before their OrderPlaced.
 */
(function () {
  "use strict";

  /* values read from lab 7 (scripts/csim/lab-values.mjs checks them) */
  var LAB = { partitions: 6, consumers: 3 };
  var REBALANCE = 3;            /* ticks the whole group is paused (eager rebalance) */
  var HOT = 0.6;                /* share of the purchases that go to the stadium show ev-1 */

  /* Kafka's default partitioner: murmur2 (Java, seed 0x9747b28c) of the key's bytes, positive, mod P */
  function murmur2(str) {
    var m = 0x5bd1e995, len = str.length, h = (0x9747b28c ^ len) | 0, i = 0;
    for (var j = 0; j < len >> 2; j++, i += 4) {
      var k = str.charCodeAt(i) | (str.charCodeAt(i + 1) << 8) | (str.charCodeAt(i + 2) << 16) | (str.charCodeAt(i + 3) << 24);
      k = Math.imul(k, m); k ^= k >>> 24; k = Math.imul(k, m);
      h = Math.imul(h, m) ^ k;
    }
    var rem = len & 3;
    if (rem === 3) h ^= str.charCodeAt(i + 2) << 16;
    if (rem >= 2) h ^= str.charCodeAt(i + 1) << 8;
    if (rem >= 1) { h ^= str.charCodeAt(i); h = Math.imul(h, m); }
    h ^= h >>> 13; h = Math.imul(h, m); h ^= h >>> 15;
    return h >>> 0;
  }
  function partitionOf(key, n) { return (murmur2(key) & 0x7fffffff) % n; }

  /* seeded PRNG (mulberry32) kept in the state, so a run can be replayed */
  function rand(st, f) {
    f = f || "seed";
    var a = st[f] = (st[f] + 0x6D2B79F5) >>> 0;
    var x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }

  /* range assignor: consumers sorted by id; the first P mod C get one partition more */
  function assign(P, ids) {
    var out = {}, C = ids.length, per = C ? Math.floor(P / C) : 0, extra = C ? P % C : 0, p = 0;
    ids.slice().sort(function (a, b) { return a - b; }).forEach(function (id, i) {
      out[id] = [];
      for (var k = 0; k < per + (i < extra ? 1 : 0); k++) out[id].push(p++);
    });
    return out;
  }

  function create(o) {
    var st = { t: 0, P: o.partitions || LAB.partitions, key: o.key || "order", seed: o.seed || 7, cseed: (o.seed || 7) * 7919 + 1, rate: o.rate || 2,
      parts: [], ids: [], nextId: 1, assignment: {}, pauseUntil: 0, nextOrder: 1001, follow: [], seen: {},
      ooo: 0, rebalances: 0, produced: 0, processed: 0, rr: 0, dead: null, last: [] };
    for (var p = 0; p < st.P; p++) st.parts.push({ log: [], committed: 0 });
    setConsumers(st, o.consumers || LAB.consumers, true);
    return st;
  }

  /* grow or shrink the group to n consumers; any change but the first triggers a rebalance */
  function setConsumers(st, n, initial) {
    while (st.ids.length < n) st.ids.push(st.nextId++);
    while (st.ids.length > n) st.ids.pop();
    if (initial) st.assignment = assign(st.P, st.ids);
    else rebalance(st);
  }
  function rebalance(st) {
    st.assignment = {};
    st.pauseUntil = st.t + REBALANCE;
    st.rebalances++;
  }
  function kill(st, id) {
    if (st.ids.length === 0) return null;
    if (id === undefined) id = st.ids[0];
    st.ids = st.ids.filter(function (x) { return x !== id; });
    st.dead = { id: id, until: st.t + REBALANCE };
    rebalance(st);
    return id;
  }

  function keyOf(st, msg) {
    if (st.key === "order") return partitionOf("o-" + msg.order, st.P);
    if (st.key === "show") return partitionOf(msg.show, st.P);
    return st.rr++ % st.P;                        /* no key: spread round-robin */
  }
  function append(st, msg) {
    msg.p = keyOf(st, msg);
    msg.offset = st.parts[msg.p].log.length;
    st.parts[msg.p].log.push(msg);
    st.produced++;
    st.last.push(msg);
  }

  /* one tick: produce, then (unless the group is rebalancing) every consumer reads up to its capacity */
  function step(st) {
    st.t++;
    st.last = [];
    var events = [];
    st.follow = st.follow.filter(function (f) { if (f.at <= st.t) { append(st, f.msg); return false; } return true; });
    var n = 1 + Math.floor(rand(st) * (2 * st.rate - 1));
    for (var i = 0; i < n; i++) {
      var order = st.nextOrder++;
      var show = rand(st) < HOT ? "ev-1" : "ev-" + (2 + Math.floor(rand(st) * 40));
      append(st, { order: order, seq: 1, show: show, t: st.t });
      st.follow.push({ at: st.t + 1 + Math.floor(rand(st) * 2), msg: { order: order, seq: 2, show: show, t: 0 } });
    }
    if (st.dead && st.t >= st.dead.until) st.dead = null;
    if (st.t < st.pauseUntil) return events;
    if (st.t === st.pauseUntil) { st.assignment = assign(st.P, st.ids); events.push({ type: "assigned" }); }
    st.ids.forEach(function (id) {
      var mine = st.assignment[id] || [];
      var cap = 1 + (rand(st, "cseed") < 0.5 ? 1 : 0) + (rand(st, "cseed") < 0.5 ? 1 : 0);
      for (var turn = 0; cap > 0; turn++) {
        var any = false;
        for (var q = 0; q < mine.length && cap > 0; q++) {
          var part = st.parts[mine[(q + turn) % mine.length]];
          if (part.committed >= part.log.length) continue;
          var msg = part.log[part.committed++];
          st.processed++; cap--; any = true;
          var seen = st.seen[msg.order] || 0;
          if (msg.seq > seen + 1) { st.ooo++; events.push({ type: "ooo", order: msg.order, p: msg.p, by: id }); }
          if (msg.seq > seen) st.seen[msg.order] = msg.seq;
        }
        if (!any) break;
      }
    });
    return events;
  }

  function lag(st, p) { return st.parts[p].log.length - st.parts[p].committed; }
  function totalLag(st) { var s = 0; for (var p = 0; p < st.P; p++) s += lag(st, p); return s; }
  function idle(st) {
    if (st.t < st.pauseUntil) return 0;
    return st.ids.filter(function (id) { return !(st.assignment[id] || []).length; }).length;
  }
  function run(o, ticks, hook) {
    var st = create(o), events = [];
    for (var i = 0; i < ticks; i++) { if (hook) hook(st); events = events.concat(step(st)); }
    return { st: st, events: events };
  }

  var API = { LAB: LAB, murmur2: murmur2, partitionOf: partitionOf, assign: assign, create: create, step: step, kill: kill,
    setConsumers: setConsumers, lag: lag, totalLag: totalLag, idle: idle, run: run, REBALANCE: REBALANCE };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var CELLS = 14, CW = 20, X0 = 150, PX = 30, CX = 525;

  C.style("kafka", [
    ".md-typeset .csim-kf-cell { fill: var(--cat); stroke: var(--c-bg); stroke-width: 1; }",
    ".md-typeset .csim-kf-cell.done { opacity: .22; }",
    ".md-typeset .csim-kf-cell.new { animation: csim-kf-in .45s ease-out; }",
    ".md-typeset .csim-kf-ltr { fill: var(--c-bg); font-size: 7px; font-weight: 700; pointer-events: none; }",
    ".md-typeset .csim-kf-track { fill: var(--c-panel); stroke: var(--c-line); }",
    ".md-typeset .csim-kf-mark { stroke: var(--c-fg); stroke-width: 2; }",
    ".md-typeset .csim-kf-wire { fill: none; stroke: var(--cat); stroke-width: 1.6; opacity: .75; }",
    ".md-typeset .csim-kf-shot { stroke: var(--c-accent); stroke-width: 1; opacity: .5; fill: none; }",
    ".md-typeset .csim-kf-cons { fill: color-mix(in srgb, var(--cat) 14%, var(--c-bg)); stroke: var(--cat); stroke-width: 1.6; }",
    ".md-typeset text.csim-kf-name { fill: var(--cat); font-weight: 700; font-size: 10px; }",
    "@keyframes csim-kf-in { from { transform: translateX(-14px); opacity: 0; } }"
  ].join("\n"));

  C.register("kafka", function (root) {
    var o = C.opts(root, { partitions: LAB.partitions, consumers: LAB.consumers, key: "order", seed: 7 });
    var P = Math.max(1, Math.min(12, o.partitions)), N = Math.max(1, Math.min(8, o.consumers)), key = o.key;
    var st, oooLog = [];
    var nf = function (v) { return v.toLocaleString(C.PT ? "pt-BR" : "en"); };

    var svg = s("svg", { role: "img", "aria-label": t("Topic partitions and a consumer group", "Partições do tópico e um consumer group") });
    var note = el("p", { class: "csim-note" });
    var lg = C.log(6);
    var st$ = C.stats([
      { key: "lag", label: t("total lag (records)", "lag total (registros)") },
      { key: "max", label: t("worst partition lag", "pior lag de partição") },
      { key: "idle", label: t("idle consumers", "consumidores ociosos") },
      { key: "ooo", label: t("orders read out of order", "pedidos lidos fora de ordem"), title: t("OrderConfirmed processed before OrderPlaced", "OrderConfirmed processado antes de OrderPlaced") }
    ]);
    var ch = C.chart({ title: t("Consumer lag over time", "Consumer lag ao longo do tempo"), len: 80,
      series: [{ label: t("total", "total"), cls: "tone-ink" }, { label: t("worst partition", "pior partição"), cls: "tone-bad" }] });

    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    function owner(p) {
      for (var id in st.assignment) if (st.assignment[id].indexOf(p) >= 0) return +id;
      return null;
    }
    function cat(id) { return "cat-" + ((id - 1) % 8); }

    function reset() {
      st = create({ partitions: P, consumers: N, key: key, seed: o.seed });
      oooLog = [];
      lg.clear(); ch.reset();
      describe();
      draw();
    }

    function describe() {
      var a = assign(P, st.ids), counts = st.ids.map(function (id) { return a[id].length; });
      var idleN = counts.filter(function (c) { return !c; }).length;
      if (idleN) {
        say(t(st.ids.length + " consumers for " + P + " partitions: " + idleN + " get no partition and sit idle. A group never reads faster than its partition count allows.",
          st.ids.length + " consumidores para " + P + " partições: " + idleN + " ficam sem partição, ociosos. Um grupo nunca lê mais rápido do que o número de partições permite."), "warn");
      } else if (key === "show") {
        say(t("Key = the show: " + Math.round(HOT * 100) + "% of the purchases are for ev-1, and they all hash to P" + partitionOf("ev-1", P) + ". One consumer gets the hot partition and falls behind; adding consumers does not help.",
          "Chave = o show: " + Math.round(HOT * 100) + "% das compras são do ev-1, e todas caem em P" + partitionOf("ev-1", P) + ". Um consumidor recebe a partição quente e fica para trás; mais consumidores não ajudam."), "warn");
      } else if (key === "none") {
        say(t("No key: records are spread round-robin, so OrderPlaced and OrderConfirmed of one order land in different partitions, read by different consumers at different speeds. Press play and watch the last tile.",
          "Sem chave: os registros são espalhados em rodízio, então OrderPlaced e OrderConfirmed do mesmo pedido caem em partições diferentes, lidas por consumidores diferentes em velocidades diferentes. Dê play e observe o último indicador."), "warn");
      } else {
        say(t("Key = orderId: both events of an order hash to the same partition and are read in order. " + st.ids.length + " consumer(s) share " + P + " partitions (" + counts.join(" + ") + "). Press play.",
          "Chave = orderId: os dois eventos de um pedido caem na mesma partição e são lidos em ordem. " + st.ids.length + " consumidor(es) dividem " + P + " partições (" + counts.join(" + ") + "). Dê play."), "");
      }
    }

    function tick() {
      var ev = step(st);
      ev.forEach(function (e) {
        if (e.type === "ooo") {
          lg.add(t("t=" + st.t + " o-" + e.order + ": OrderConfirmed read before OrderPlaced (P" + e.p + ", consumer #" + e.by + ")",
            "t=" + st.t + " o-" + e.order + ": OrderConfirmed lido antes de OrderPlaced (P" + e.p + ", consumidor #" + e.by + ")"), "bad");
          if (st.ooo === 1) say(t("Order o-" + e.order + " was confirmed before it was placed — as far as consumer #" + e.by + " can tell. Without a key, ordering across partitions is lost; key by orderId to keep it per order.",
            "O pedido o-" + e.order + " foi confirmado antes de ser criado — do ponto de vista do consumidor #" + e.by + ". Sem chave, a ordem entre partições se perde; use orderId como chave para mantê-la por pedido."), "bad");
        } else if (e.type === "assigned") {
          var parts = st.ids.map(function (id) { return "#" + id + ": " + (st.assignment[id].length ? st.assignment[id].map(function (p) { return "P" + p; }).join(",") : t("idle", "ocioso")); });
          lg.add(t("t=" + st.t + " rebalance done → " + parts.join("  "), "t=" + st.t + " rebalance concluído → " + parts.join("  ")), "ok");
          say(t("Rebalance done: the survivors took over the partitions and resume from the committed offsets, so nothing is lost or read twice here (the commit follows each record). The lag built during the pause now drains.",
            "Rebalance concluído: os sobreviventes assumiram as partições e retomam dos offsets confirmados, então nada se perde nem é lido duas vezes aqui (o commit segue cada registro). O lag acumulado na pausa agora é drenado."), "ok");
        }
      });
      var mx = 0;
      for (var p = 0; p < P; p++) mx = Math.max(mx, lag(st, p));
      ch.push([totalLag(st), mx]);
      draw();
    }

    function draw() {
      var rowH = P > 8 ? 24 : 30, top = 26, H = top + P * rowH + 16;
      var ids = st.ids, slotH = Math.min(44, (P * rowH) / Math.max(1, ids.length + (st.dead ? 1 : 0)));
      svg.setAttribute("viewBox", "0 0 640 " + H);
      C.clear(svg);
      var paused = st.t < st.pauseUntil;
      svg.appendChild(s("text", { x: X0, y: 14, class: "c-small" }, t("topic order-events · committed offset ▏ then unread records → newest", "tópico order-events · offset confirmado ▏ depois registros não lidos → mais novo")));
      /* producer */
      var py = top + (P * rowH) / 2;
      svg.appendChild(s("rect", { x: 4, y: py - 26, width: 92, height: 52, rx: 6, class: "c-box on" }));
      svg.appendChild(s("text", { x: 50, y: py - 6, "text-anchor": "middle", class: "c-label" }, "order"));
      svg.appendChild(s("text", { x: 50, y: py + 9, "text-anchor": "middle", class: "c-small" }, t("key = ", "chave = ") + (key === "order" ? "orderId" : key === "show" ? t("show", "show") : t("none", "nenhuma"))));
      var landed = {};
      st.last.forEach(function (m) { landed[m.p] = true; });
      /* partitions */
      var slotY = {};
      ids.concat(st.dead ? [st.dead.id] : []).forEach(function (id, i) { slotY[id] = top + slotH * i + slotH / 2; });
      for (var p = 0; p < P; p++) {
        var y = top + p * rowH + rowH / 2, part = st.parts[p], len = part.log.length;
        if (landed[p]) svg.appendChild(s("path", { class: "csim-kf-shot", d: "M96," + py + " C120," + py + " 115," + y + " " + (X0 - 6) + "," + y }));
        svg.appendChild(s("text", { x: X0 - 8, y: y + 4, "text-anchor": "end", class: "c-label" }, "P" + p));
        svg.appendChild(s("rect", { x: X0, y: y - 9, width: CELLS * CW, height: 18, rx: 3, class: "csim-kf-track" }));
        var start = Math.max(0, len - CELLS);
        for (var k = start; k < len; k++) {
          var m = part.log[k], cx = X0 + (k - start) * CW + CW / 2;
          var g = s("g");
          g.appendChild(s("circle", { cx: cx, cy: y, r: 7, class: "csim-kf-cell cat-" + (m.order % 8) + (k < part.committed ? " done" : "") + (st.last.indexOf(m) >= 0 ? " new" : "") }));
          g.appendChild(s("text", { x: cx, y: y + 2.5, "text-anchor": "middle", class: "csim-kf-ltr" }, m.seq === 1 ? "P" : "C"));
          g.appendChild(s("title", {}, "offset " + k + " · o-" + m.order + " " + (m.seq === 1 ? "OrderPlaced" : "OrderConfirmed") + " · " + m.show));
          svg.appendChild(g);
        }
        var mk = part.committed >= start ? X0 + (part.committed - start) * CW : X0;
        svg.appendChild(s("line", { x1: mk, x2: mk, y1: y - 12, y2: y + 12, class: "csim-kf-mark" }));
        if (part.committed < start) svg.appendChild(s("text", { x: X0 + 2, y: y - 11, class: "c-small" }, "◂ " + part.committed));
        var l = lag(st, p);
        svg.appendChild(s("text", { x: X0 + CELLS * CW + 6, y: y + 4, class: "c-mono " + (l > 20 ? "c-bad" : l > 6 ? "c-warn" : "") }, t("lag ", "lag ") + l));
        var who = owner(p);
        if (who !== null && slotY[who] !== undefined) {
          var x1 = X0 + CELLS * CW + 50;
          svg.appendChild(s("path", { class: "csim-kf-wire " + cat(who), d: "M" + x1 + "," + y + " C" + (x1 + 30) + "," + y + " " + (CX - 30) + "," + slotY[who] + " " + CX + "," + slotY[who] }));
        }
      }
      /* consumers */
      ids.concat(st.dead ? [st.dead.id] : []).forEach(function (id) {
        var y = slotY[id], h = Math.min(36, slotH - 4), dead = st.dead && st.dead.id === id;
        var mine = st.assignment[id] || [];
        var g = s("g", { class: cat(id) });
        g.appendChild(s("rect", { x: CX, y: y - h / 2, width: 110, height: h, rx: 5, class: dead ? "c-box down" : paused || !mine.length ? "c-box" : "csim-kf-cons" }));
        g.appendChild(s("text", { x: CX + 8, y: y - (h > 26 ? 3 : -3), class: dead || !mine.length ? "c-small" : "csim-kf-name" }, "notification #" + id));
        if (h > 26) g.appendChild(s("text", { x: CX + 8, y: y + 11, class: "c-small" },
          dead ? t("✗ crashed", "✗ caiu") : paused ? t("rebalancing…", "rebalanceando…") : mine.length ? mine.map(function (q) { return "P" + q; }).join(" ") : t("idle", "ocioso")));
        svg.appendChild(g);
      });
      svg.appendChild(s("text", { x: CX, y: 14, class: "c-small" }, t("group notification", "grupo notification")));
      /* stats */
      var tl = totalLag(st), mx = 0, idl = idle(st);
      for (var q = 0; q < P; q++) mx = Math.max(mx, lag(st, q));
      st$.set("lag", nf(tl), tl > 60 ? "bad" : tl > 20 ? "warn" : "ok");
      st$.set("max", nf(mx), mx > 25 ? "bad" : mx > 8 ? "warn" : "ok");
      st$.set("idle", paused ? t("all (paused)", "todos (pausa)") : idl + " / " + ids.length, paused ? "bad" : idl ? "warn" : "ok");
      st$.set("ooo", nf(st.ooo), st.ooo ? "bad" : "ok");
      bKill.disabled = ids.length <= 1 || paused;
    }

    var sP = C.slider({ label: t("Partitions", "Partições"), min: 1, max: 12, value: P, onInput: function (v) { P = v; player.reset(); } });
    var sC = C.slider({ label: t("Consumers", "Consumidores"), min: 1, max: 8, value: N, onInput: function (v) {
      N = v;
      if (st.t === 0) { reset(); return; }
      setConsumers(st, v, false);
      lg.add(t("t=" + st.t + " group now has " + v + " consumers → rebalance", "t=" + st.t + " grupo agora tem " + v + " consumidores → rebalance"), "warn");
      say(t("A member joined or left: the whole group stops for the rebalance (" + REBALANCE + " ticks), then the partitions are reassigned.",
        "Um membro entrou ou saiu: o grupo inteiro para durante o rebalance (" + REBALANCE + " ticks) e depois as partições são redistribuídas."), "warn");
      draw();
    } });
    var cKey = C.choice({ label: t("Key", "Chave"), value: key, options: [
      { value: "order", label: "orderId" }, { value: "show", label: t("show", "show") }, { value: "none", label: t("none", "nenhuma") }],
      onChange: function (v) { key = v; player.reset(); } });
    var bKill = C.button(t("✗ kill a consumer", "✗ derrubar um consumidor"), function () {
      var id = kill(st);
      N = st.ids.length; sC.set(N);
      lg.add(t("t=" + st.t + " consumer #" + id + " crashed → rebalance", "t=" + st.t + " consumidor #" + id + " caiu → rebalance"), "bad");
      say(t("Consumer #" + id + " crashed. The group stops reading every partition for the rebalance (" + REBALANCE + " ticks): lag grows everywhere, not only on its partitions. Then the survivors take over.",
        "O consumidor #" + id + " caiu. O grupo para de ler todas as partições durante o rebalance (" + REBALANCE + " ticks): o lag cresce em todas, não só nas dele. Depois os sobreviventes assumem."), "bad");
      draw();
    }, { tone: "bad" });

    var player = C.player({ interval: 650, onTick: tick, onReset: reset });

    C.add(root, [
      el("p", { class: "csim-title", text: t("Partitions and consumer groups: who reads what, and in which order?", "Partições e consumer groups: quem lê o quê, e em que ordem?") }),
      el("p", { class: "csim-sub", text: t("Each dot is a record (P = OrderPlaced, C = OrderConfirmed), colored by its order; faded dots are already processed. Wires show which consumer owns each partition.",
        "Cada ponto é um registro (P = OrderPlaced, C = OrderConfirmed), na cor do seu pedido; pontos apagados já foram processados. As linhas mostram qual consumidor é dono de cada partição.") }),
      el("div", { class: "csim-row" }, [sP, sC, cKey, bKill]),
      el("div", { class: "csim-stage" }, svg),
      st$,
      el("div", { class: "csim-cols" }, [ch, el("div", {}, [el("div", { class: "csim-lbl", text: t("Events", "Eventos") }), lg])]),
      note,
      player
    ]);
    reset();
    return { destroy: function () { player.pause(); } };
  });
})();
