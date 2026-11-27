/*
 * Leaderless quorums (2027.1, class 6 — replication, leaderless section):
 *
 *   <div class="csim" data-sim="quorum" data-n="3" data-w="2" data-r="2" data-down="C"></div>
 *
 * N replicas of one key (the price of event 42), each with a version. A write reaches W replicas
 * (picked at random among the live ones; the others miss it, as if slow) and is acknowledged;
 * a read asks R live replicas and returns the newest version. With R + W > N every read set
 * overlaps the last write set, so no read is stale. Fewer than W (or R) live replicas: the
 * write (or read) fails. Click a replica to take it down or bring it back.
 */
(function () {
  "use strict";

  var NAMES = "ABCDEFG".split("");

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
    var n = o.n || 3;
    var st = {
      n: n, w: Math.min(o.w || 2, n), r: Math.min(o.r || 2, n), repair: !!o.repair,
      versions: [], up: [], latest: 0, rand: mulberry32(o.seed || 42), last: null, writeSet: [],
      stats: { reads: 0, stale: 0, readFail: 0, writes: 0, writeFail: 0 }
    };
    for (var i = 0; i < n; i++) { st.versions.push(0); st.up.push(true); }
    (o.down || []).forEach(function (i) { if (i < n) st.up[i] = false; });
    return st;
  }

  function live(st) {
    var out = [];
    st.up.forEach(function (u, i) { if (u) out.push(i); });
    return out;
  }

  /* k distinct live replicas, at random (partial Fisher–Yates) */
  function pick(st, k) {
    var a = live(st);
    for (var i = 0; i < k; i++) {
      var j = i + Math.floor(st.rand() * (a.length - i));
      var x = a[i]; a[i] = a[j]; a[j] = x;
    }
    return a.slice(0, k).sort(function (x, y) { return x - y; });
  }

  function write(st) {
    st.stats.writes++;
    var up = live(st);
    if (up.length < st.w) {
      st.stats.writeFail++;
      st.last = { type: "write", ok: false, up: up.length };
      return st.last;
    }
    var set = pick(st, st.w), v = st.latest + 1;
    set.forEach(function (i) { st.versions[i] = v; });
    st.latest = v;
    st.writeSet = set;
    st.last = { type: "write", ok: true, set: set, version: v };
    return st.last;
  }

  function read(st) {
    st.stats.reads++;
    var up = live(st);
    if (up.length < st.r) {
      st.stats.readFail++;
      st.last = { type: "read", ok: false, up: up.length };
      return st.last;
    }
    var set = pick(st, st.r), best = 0;
    set.forEach(function (i) { best = Math.max(best, st.versions[i]); });
    var overlap = set.filter(function (i) { return st.versions[i] === st.latest && st.latest > 0; });
    var res = { type: "read", ok: true, set: set, version: best, stale: best < st.latest, overlap: overlap, repaired: [] };
    if (res.stale) st.stats.stale++;
    if (st.repair) set.forEach(function (i) { if (st.versions[i] < best) { st.versions[i] = best; res.repaired.push(i); } });
    st.last = res;
    return res;
  }

  /* operation k of the automatic run: write, read, read, write, … */
  function step(st, k) { return (k - 1) % 3 === 0 ? write(st) : read(st); }

  function binom(n, k) {
    if (k < 0 || k > n) return 0;
    var r = 1;
    for (var i = 1; i <= k; i++) r = r * (n - k + i) / i;
    return r;
  }
  /* chance that R random live replicas all miss the W that took the last write */
  function pStale(upCount, w, r) {
    if (upCount < w || upCount < r) return null;
    return binom(upCount - w, r) / binom(upCount, r);
  }

  function setUp(st, i, up) { st.up[i] = up; }

  var API = { create: create, write: write, read: read, step: step, pick: pick, live: live, pStale: pStale, binom: binom,
    setUp: setUp, NAMES: NAMES };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var COORD = { x: 10, y: 40, w: 130, h: 60 };

  function pct(f) { return (f * 100).toFixed(0) + "%"; }
  function names(a) { return a.map(function (i) { return NAMES[i]; }).join(", ") || "–"; }

  C.style("quorum", [
    ".md-typeset .csim-q-node { cursor: pointer; }",
    ".md-typeset .csim-q-node:hover rect, .md-typeset .csim-q-node:focus rect { stroke: var(--c-bad); stroke-width: 2.4; }",
    ".md-typeset .csim .csim-q-wire.w { stroke: var(--c-ok); stroke-width: 2.2; }",
    ".md-typeset .csim .csim-q-wire.r { stroke: var(--c-accent); stroke-width: 2.2; }",
    ".md-typeset .csim .csim-q-wire.f { stroke: var(--c-bad); stroke-dasharray: 5 4; }",
    ".md-typeset .csim-q-tag { font-size: 9px; font-weight: 700; }",
    ".md-typeset .csim .csim-q-tag.w { fill: var(--c-ok); }",
    ".md-typeset .csim .csim-q-tag.r { fill: var(--c-accent); }",
    ".md-typeset .csim-q-sum { font-family: var(--md-code-font-family); font-weight: 700; margin: .2rem 0; }",
    ".md-typeset .csim-q-sum.csim-ok { color: var(--c-ok); }",
    ".md-typeset .csim-q-sum.csim-warn { color: var(--c-warn); }"
  ].join("\n"));

  C.register("quorum", function (root) {
    var o = C.opts(root, { n: 3, w: 2, r: 2, down: "C" });
    var downInit = String(o.down || "").split(/[ ,]+/).map(function (x) { return NAMES.indexOf(x.toUpperCase()); })
      .filter(function (i) { return i >= 0; });
    var st;

    var svg = s("svg", { viewBox: "0 0 520 140", role: "img", "aria-label": t("Coordinator and replicas", "Coordenador e réplicas") });
    var note = el("p", { class: "csim-note" });
    var rule = el("p", { class: "csim-q-sum" });
    var tiles = C.stats([
      { key: "stale", label: t("stale reads", "leituras desatualizadas") },
      { key: "p", label: t("chance a read misses the last write", "chance de uma leitura perder a última escrita"),
        title: "C(U−W, R) / C(U, R), U = " + t("live replicas", "réplicas vivas") },
      { key: "wf", label: t("failed writes", "escritas que falharam") },
      { key: "rf", label: t("failed reads", "leituras que falharam") }
    ]);
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    var nS, wS, rS;
    function sliderFor(label, key, max) {
      return C.slider({ label: label, min: 1, max: max, value: o[key], onInput: function () { settings(); } });
    }
    nS = C.slider({ label: "N", min: 3, max: 7, value: o.n, onInput: function () { player.reset(); } });
    wS = sliderFor("W", "w", 7);
    rS = sliderFor("R", "r", 7);
    var repair = C.toggle({ label: t("read repair", "read repair"),
      title: t("a read writes the newest version back to the replicas it asked", "uma leitura grava a versão mais nova de volta nas réplicas consultadas"),
      onChange: function (v) { st.repair = v; } });

    function settings() {
      if (wS.get() > st.n) wS.set(st.n);
      if (rS.get() > st.n) rS.set(st.n);
      st.w = wS.get(); st.r = rS.get();
      var ok = st.w + st.r > st.n;
      say(ok ? t("R + W = " + (st.w + st.r) + " > N = " + st.n + ": any " + st.r + " replicas include at least " + (st.w + st.r - st.n) + " of the " + st.w + " that took the last write.",
        "R + W = " + (st.w + st.r) + " > N = " + st.n + ": quaisquer " + st.r + " réplicas incluem pelo menos " + (st.w + st.r - st.n) + " das " + st.w + " que receberam a última escrita.")
        : t("R + W = " + (st.w + st.r) + " ≤ N = " + st.n + ": a read can ask only replicas the last write never reached. Play and watch the stale reads.",
          "R + W = " + (st.w + st.r) + " ≤ N = " + st.n + ": uma leitura pode consultar só réplicas que a última escrita não alcançou. Dê play e veja as leituras desatualizadas."), ok ? "ok" : "warn");
      draw();
    }

    var player = C.player({
      interval: 900,
      label: function (k) { return t("op ", "op ") + k + (st && st.last ? " · " + (st.last.type === "write" ? t("write", "escrita") : t("read", "leitura")) : ""); },
      onTick: function (k) { explain(step(st, k)); draw(); },
      onReset: function () { reset(); }
    });

    function explain(r) {
      if (r.type === "write") {
        if (!r.ok) say(t("Write rejected: only " + r.up + " replica(s) alive, W = " + st.w + ". The coordinator cannot collect W acks, so the client gets an error (a sloppy quorum would let other nodes hold it temporarily).",
          "Escrita rejeitada: só " + r.up + " réplica(s) viva(s), W = " + st.w + ". O coordenador não junta W confirmações, e o cliente recebe erro (um sloppy quorum deixaria outros nós guardarem temporariamente)."), "bad");
        else say(t("Write v" + r.version + " acknowledged by " + names(r.set) + " (W = " + st.w + "). The other replicas still hold an older version.",
          "Escrita v" + r.version + " confirmada por " + names(r.set) + " (W = " + st.w + "). As outras réplicas ainda têm uma versão mais antiga."), "");
      } else {
        if (!r.ok) say(t("Read failed: only " + r.up + " replica(s) alive, R = " + st.r + ".", "Leitura falhou: só " + r.up + " réplica(s) viva(s), R = " + st.r + "."), "bad");
        else if (r.stale) say(t("Stale read: " + names(r.set) + " answered v" + r.version + ", but v" + st.latest + " was acknowledged. The read set did not overlap the write set " + names(st.writeSet) + ".",
          "Leitura desatualizada: " + names(r.set) + " responderam v" + r.version + ", mas v" + st.latest + " foi confirmada. O conjunto de leitura não cruzou o de escrita " + names(st.writeSet) + "."), "bad");
        else say(t("Read asked " + names(r.set) + " and returned v" + r.version + (r.overlap.length ? ": " + names(r.overlap) + " had it (the overlap)." : ".") + (r.repaired.length ? " Read repair updated " + names(r.repaired) + "." : ""),
          "A leitura consultou " + names(r.set) + " e devolveu v" + r.version + (r.overlap.length ? ": " + names(r.overlap) + " tinha(m) a versão (a interseção)." : ".") + (r.repaired.length ? " O read repair atualizou " + names(r.repaired) + "." : "")), "ok");
      }
    }

    function height() { return Math.max(110, st.n * 32 + 14); }
    function slot(i) { return { x: 300, y: 10 + i * 32, w: 210, h: 26 }; }

    function draw() {
      C.clear(svg);
      svg.setAttribute("viewBox", "0 0 520 " + height());
      COORD.y = height() / 2 - COORD.h / 2;
      var L = st.last, rs = L && L.type === "read" && L.ok ? L.set : [], ws = st.writeSet;
      var cx = COORD.x + COORD.w, cy = COORD.y + COORD.h / 2;
      for (var i = 0; i < st.n; i++) {
        var p = slot(i), y = p.y + p.h / 2;
        var cls = "c-wire csim-q-wire";
        if (!st.up[i]) cls += " f";
        else if (L && L.type === "read" && rs.indexOf(i) >= 0) cls += " r";
        else if (L && L.type === "write" && L.ok && ws.indexOf(i) >= 0) cls += " w";
        svg.appendChild(s("path", { d: "M" + cx + "," + cy + " C" + (cx + 90) + "," + cy + " " + (p.x - 90) + "," + y + " " + p.x + "," + y, class: cls }));
      }
      svg.appendChild(s("rect", { x: COORD.x, y: COORD.y, width: COORD.w, height: COORD.h, rx: 8, class: "c-box on" }));
      svg.appendChild(s("text", { x: COORD.x + COORD.w / 2, y: COORD.y + 22, "text-anchor": "middle", class: "c-label" }, t("coordinator", "coordenador")));
      svg.appendChild(s("text", { x: COORD.x + COORD.w / 2, y: COORD.y + 38, "text-anchor": "middle", class: "c-small" }, "N=" + st.n + " W=" + st.w + " R=" + st.r));
      svg.appendChild(s("text", { x: COORD.x + COORD.w / 2, y: COORD.y + 52, "text-anchor": "middle", class: "c-small" }, t("latest ack: v", "última confirmada: v") + st.latest));
      for (var j = 0; j < st.n; j++) (function (i) {
        var p = slot(i), v = st.versions[i];
        var inR = rs.indexOf(i) >= 0, inW = ws.indexOf(i) >= 0 && st.latest > 0;
        var box = !st.up[i] ? "down" : inR && L.stale ? "bad" : inR && v === st.latest ? "hot" : v === st.latest && st.latest > 0 ? "ok" : "";
        var g = s("g", { class: "csim-q-node", tabindex: 0, role: "button",
          onclick: function () { st.up[i] = !st.up[i]; say(st.up[i] ? t("Replica " + NAMES[i] + " is back, still at v" + st.versions[i] + ": it missed every write while it was down.", "A réplica " + NAMES[i] + " voltou, ainda na v" + st.versions[i] + ": perdeu todas as escritas enquanto estava fora.")
            : t("Replica " + NAMES[i] + " is down: " + live(st).length + " of " + st.n + " alive.", "A réplica " + NAMES[i] + " caiu: " + live(st).length + " de " + st.n + " vivas."), st.up[i] ? "" : "warn"); draw(); },
          onkeydown: function (ev) { if (ev.key === "Enter") { ev.preventDefault(); this.dispatchEvent(new Event("click")); } } });
        g.appendChild(s("rect", { x: p.x, y: p.y, width: p.w, height: p.h, rx: 6, class: "c-box " + box }));
        g.appendChild(s("text", { x: p.x + 10, y: p.y + 17, class: "c-label" }, NAMES[i]));
        g.appendChild(s("text", { x: p.x + 30, y: p.y + 17, class: "c-mono" + (v < st.latest ? " c-warn" : "") }, st.up[i] ? t("price v", "preço v") + v : t("down", "fora")));
        if (inW && st.up[i]) g.appendChild(s("text", { x: p.x + p.w - 30, y: p.y + 17, class: "csim-q-tag w", "text-anchor": "end" }, "W"));
        if (inR) g.appendChild(s("text", { x: p.x + p.w - 10, y: p.y + 17, class: "csim-q-tag r", "text-anchor": "end" }, "R"));
        g.appendChild(s("title", {}, t("click to take down / bring back", "clique para derrubar / religar")));
        svg.appendChild(g);
      })(j);
      var S = st.stats, sum = st.w + st.r, ok = sum > st.n;
      rule.textContent = "R + W = " + st.r + " + " + st.w + " = " + sum + (ok ? " > " : " ≤ ") + "N = " + st.n +
        (ok ? t(" → every read overlaps the last write", " → toda leitura cruza a última escrita") : t(" → reads can miss it", " → leituras podem perdê-la"));
      rule.className = "csim-q-sum " + (ok ? "csim-ok" : "csim-warn");
      var okReads = S.reads - S.readFail;
      tiles.set("stale", S.stale + " / " + okReads, S.stale ? "bad" : okReads ? "ok" : "");
      var p = pStale(live(st).length, st.w, st.r);
      tiles.set("p", p === null ? "–" : pct(p), p === null ? "" : p > 0 ? "warn" : "ok");
      tiles.set("wf", S.writeFail + " / " + S.writes, S.writeFail ? "bad" : S.writes ? "ok" : "");
      tiles.set("rf", S.readFail + " / " + S.reads, S.readFail ? "bad" : S.reads ? "ok" : "");
      player.refresh();
    }

    /* restart: same N as the page → the page's down replicas; another N → all alive */
    function reset() {
      var n = nS.get();
      [wS, rS].forEach(function (x) { x.range(1, n); });
      if (wS.get() > n) wS.set(n);
      if (rS.get() > n) rS.set(n);
      st = create({ n: n, w: wS.get(), r: rS.get(), repair: repair.get(), down: n === o.n ? downInit : [] });
      settings();
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("Quorums: when does a read see the latest write?", "Quóruns: quando uma leitura vê a última escrita?") }),
      el("p", { class: "csim-sub", text: t("One key (the price of event 42) on N replicas. A write reaches W random live replicas; a read asks R and keeps the newest version. Click a replica to take it down.",
        "Uma chave (o preço do evento 42) em N réplicas. Uma escrita alcança W réplicas vivas ao acaso; uma leitura consulta R e fica com a versão mais nova. Clique numa réplica para derrubá-la.") }),
      el("div", { class: "csim-row" }, [nS, wS, rS, repair]),
      rule,
      el("div", { class: "csim-stage" }, svg),
      tiles,
      note,
      player
    ]);
    reset();
    return {};
  });
})();
