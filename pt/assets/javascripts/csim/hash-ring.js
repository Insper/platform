/*
 * Consistent hashing ring (2027.1, class 6 — partitioning):
 *
 *   <div class="csim" data-sim="hash-ring" data-nodes="4" data-vnodes="1"></div>
 *
 * Nodes and keys share one 32-bit ring; a key belongs to the first node clockwise. Adding or
 * removing a node shows which keys move, and the stats compare with hash(key) mod N for the
 * same change. Virtual nodes show how the load evens out.
 */
(function () {
  "use strict";

  var NAMES = "ABCDEFGHIJKL".split("");
  var MAX = Math.pow(2, 32);

  /* FNV-1a, 32 bits, then a final mix (FNV alone clusters on short similar strings) */
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  /* points of the ring, sorted: [{pos, node}] */
  function ring(nodes, vnodes) {
    var pts = [];
    nodes.forEach(function (n) {
      for (var v = 0; v < vnodes; v++) pts.push({ pos: hash(n + "#" + v), node: n });
    });
    pts.sort(function (a, b) { return a.pos - b.pos; });
    return pts;
  }

  /* first point clockwise from h (binary search), wrapping to the first point */
  function owner(pts, h) {
    var lo = 0, hi = pts.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (pts[mid].pos < h) lo = mid + 1; else hi = mid;
    }
    return pts[lo === pts.length ? 0 : lo].node;
  }

  function keyHashes(count) {
    var out = new Array(count);
    for (var i = 0; i < count; i++) out[i] = hash("seat:" + i);
    return out;
  }

  function assignRing(keys, nodes, vnodes) {
    var pts = ring(nodes, vnodes);
    return keys.map(function (h) { return owner(pts, h); });
  }
  function assignMod(keys, nodes) {
    return keys.map(function (h) { return nodes[h % nodes.length]; });
  }
  function movedFraction(a, b) {
    var m = 0;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) m++;
    return a.length ? m / a.length : 0;
  }
  function loads(assign, nodes) {
    var c = {};
    nodes.forEach(function (n) { c[n] = 0; });
    assign.forEach(function (n) { c[n]++; });
    return c;
  }
  /* busiest node ÷ average */
  function imbalance(assign, nodes) {
    var c = loads(assign, nodes), max = 0;
    nodes.forEach(function (n) { if (c[n] > max) max = c[n]; });
    return max / (assign.length / nodes.length);
  }

  var API = { hash: hash, ring: ring, owner: owner, keyHashes: keyHashes, assignRing: assignRing, assignMod: assignMod,
    movedFraction: movedFraction, loads: loads, imbalance: imbalance, NAMES: NAMES };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var R = 120, CX = 170, CY = 150, SHOWN = 90, TOTAL = 10000;

  function angle(pos) { return (pos / MAX) * 2 * Math.PI - Math.PI / 2; }
  function at(pos, r) { var a = angle(pos); return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; }
  function pct(f) { return (100 * f).toFixed(f < 0.1 ? 1 : 0) + "%"; }

  C.style("hash-ring", [
    ".md-typeset .csim-hr-arc { fill: none; stroke: var(--cat); stroke-width: 7; opacity: .55; transition: opacity .3s; }",
    ".md-typeset .csim-hr-arc.hl { opacity: 1; stroke-width: 9; }",
    ".md-typeset .csim-hr-key { fill: var(--cat); transition: r .3s; }",
    ".md-typeset .csim-hr-key.moved { stroke: var(--c-fg); stroke-width: 1.4; animation: csim-pulse 1.2s ease-in-out 3; }",
    ".md-typeset .csim-hr-node { cursor: pointer; }",
    ".md-typeset .csim-hr-node circle { fill: var(--cat); stroke: var(--c-bg); stroke-width: 2; }",
    ".md-typeset .csim-hr-node text { fill: var(--cat); }",
    ".md-typeset .csim-hr-node:hover circle, .md-typeset .csim-hr-node:focus circle { stroke: var(--c-bad); stroke-width: 3; }",
    ".md-typeset .csim-hr-bars { display: flex; flex-direction: column; gap: .2rem; margin-top: .5rem; }",
    ".md-typeset .csim-hr-bar { display: flex; align-items: center; gap: .4rem; font-variant-numeric: tabular-nums; }",
    ".md-typeset .csim-hr-name { width: 1rem; font-weight: 700; color: var(--cat); }",
    ".md-typeset .csim-hr-track { flex: 1; height: .55rem; background: var(--c-panel); border-radius: .2rem; position: relative; overflow: hidden; }",
    ".md-typeset .csim-hr-track i { display: block; height: 100%; background: var(--cat); border-radius: .2rem; transition: width .4s; }",
    ".md-typeset .csim-hr-track em { position: absolute; top: -.1rem; bottom: -.1rem; border-left: .1rem dashed var(--c-fg2); }",
    ".md-typeset .csim-hr-bar.hl .csim-hr-track { outline: .1rem solid var(--cat); }",
    ".md-typeset .csim-hr-n { width: 2.4rem; text-align: right; color: var(--c-fg2); }"
  ].join("\n"));

  C.register("hash-ring", function (root) {
    var o = C.opts(root, { nodes: 4, vnodes: 1 });
    var nodes = NAMES.slice(0, Math.max(1, Math.min(NAMES.length, o.nodes)));
    var vnodes = o.vnodes;
    var keys = keyHashes(TOTAL);
    var current = assignRing(keys, nodes, vnodes);
    var moved = {};

    var svg = s("svg", { viewBox: "0 0 340 300", role: "img", "aria-label": t("Hash ring", "Anel de hash") });
    var note = el("p", { class: "csim-note" });
    var st = C.stats([
      { key: "moved", label: t("keys moved (consistent)", "chaves movidas (consistente)") },
      { key: "mod", label: t("would move with mod N", "moveriam com mod N") },
      { key: "ideal", label: t("minimum possible (1/N)", "mínimo possível (1/N)") },
      { key: "imb", label: t("busiest ÷ average", "mais carregado ÷ média"), title: t("1.0 is a perfect balance", "1,0 é o equilíbrio perfeito") }
    ]);
    var bars = el("div", { class: "csim-hr-bars" });
    var vn = C.choice({
      label: t("Virtual nodes", "Nós virtuais"), value: vnodes,
      options: [1, 4, 16, 64].map(function (v) { return { value: v, label: String(v) }; }),
      onChange: function (v) {
        var before = current;
        vnodes = v;
        current = assignRing(keys, nodes, vnodes);
        markMoved(before);
        say(t("With " + v + " position(s) per node the ring is cut into " + v * nodes.length + " arcs: the busiest node now holds " +
          imbalance(current, nodes).toFixed(2) + "× the average.",
          "Com " + v + " posição(ões) por nó o anel é cortado em " + v * nodes.length + " arcos: o nó mais carregado agora tem " +
          imbalance(current, nodes).toFixed(2).replace(".", ",") + "× a média."), "");
        draw(null);
      }
    });

    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    function markMoved(before) {
      moved = {};
      for (var i = 0; i < SHOWN; i++) if (before[i] !== current[i]) moved[i] = true;
    }

    function change(next, verb, who) {
      var before = current, beforeNodes = nodes;
      nodes = next;
      current = assignRing(keys, nodes, vnodes);
      markMoved(before);
      var f = movedFraction(before, current);
      var fm = movedFraction(assignMod(keys, beforeNodes), assignMod(keys, nodes));
      var from = {};
      for (var i = 0; i < keys.length; i++) if (before[i] !== current[i]) from[verb === "add" ? before[i] : current[i]] = true;
      var others = Object.keys(from).sort().join(", ");
      st.set("moved", pct(f) + " (" + Math.round(f * TOTAL).toLocaleString(C.PT ? "pt-BR" : "en") + ")", "ok");
      st.set("mod", pct(fm), fm > 0.5 ? "bad" : "warn");
      st.set("ideal", pct(1 / Math.max(nodes.length, beforeNodes.length)), "");
      if (verb === "add") {
        say(t("Node " + who + " joined and took " + pct(f) + " of the keys, only from " + others + ". With hash(key) mod N, " + pct(fm) +
          " of all keys would change node: in a cache, that is a flush onto the database.",
          "O nó " + who + " entrou e levou " + pct(f) + " das chaves, só de " + others + ". Com hash(chave) mod N, " + pct(fm) +
          " de todas as chaves mudariam de nó: num cache, é o mesmo que esvaziá-lo sobre o banco."), "ok");
      } else {
        say(t("Node " + who + " left: only its own keys (" + pct(f) + ") moved, to " + others + ". With mod N, " + pct(fm) + " would move.",
          "O nó " + who + " saiu: só as chaves dele (" + pct(f) + ") se moveram, para " + others + ". Com mod N, " + pct(fm) + " se moveriam."), "warn");
      }
      draw(who);
    }

    function addNode() {
      var free = NAMES.filter(function (n) { return nodes.indexOf(n) < 0; });
      if (!free.length) return;
      change(nodes.concat(free[0]), "add", free[0]);
    }
    function removeNode(n) {
      if (nodes.length <= 1) return;
      n = n || nodes[nodes.length - 1];
      change(nodes.filter(function (x) { return x !== n; }), "remove", n);
    }

    function cat(n) { return "cat-" + NAMES.indexOf(n) % 8; }

    function draw(highlight) {
      C.clear(svg);
      var pts = ring(nodes, vnodes);
      svg.appendChild(s("circle", { cx: CX, cy: CY, r: R, class: "c-wire" }));
      /* arcs: each ring segment colored by the node that owns it */
      for (var i = 0; i < pts.length; i++) {
        var prev = pts[(i - 1 + pts.length) % pts.length].pos;
        var cur = pts[i].pos;
        var a0 = angle(prev), a1 = angle(cur);
        if (a1 <= a0) a1 += 2 * Math.PI;
        if (pts.length === 1) { a0 = -Math.PI / 2; a1 = a0 + 2 * Math.PI - 0.0001; }
        var large = a1 - a0 > Math.PI ? 1 : 0;
        var p0 = [CX + R * Math.cos(a0), CY + R * Math.sin(a0)], p1 = [CX + R * Math.cos(a1), CY + R * Math.sin(a1)];
        svg.appendChild(s("path", { class: "csim-hr-arc " + cat(pts[i].node) + (pts[i].node === highlight ? " hl" : ""),
          d: "M" + p0[0] + "," + p0[1] + " A" + R + "," + R + " 0 " + large + " 1 " + p1[0] + "," + p1[1] }));
      }
      /* keys: inner dots */
      for (var k = 0; k < SHOWN; k++) {
        var p = at(keys[k], R - 14);
        var c = s("circle", { cx: p[0], cy: p[1], r: moved[k] ? 3.6 : 2.6, class: "csim-hr-key " + cat(current[k]) + (moved[k] ? " moved" : "") });
        c.appendChild(s("title", {}, "seat:" + k + " → " + current[k]));
        svg.appendChild(c);
      }
      /* node positions: outer markers, click to remove */
      var labelled = {};
      pts.forEach(function (pt) {
        var p = at(pt.pos, R);
        var g = s("g", { class: "csim-hr-node " + cat(pt.node), tabindex: vnodes === 1 ? 0 : null, role: "button",
          onclick: function () { removeNode(pt.node); } });
        g.appendChild(s("circle", { cx: p[0], cy: p[1], r: vnodes > 16 ? 3 : vnodes > 1 ? 4.5 : 9 }));
        if (vnodes === 1 || !labelled[pt.node]) {
          var q = at(pt.pos, R + (vnodes === 1 ? 22 : 14));
          g.appendChild(s("text", { x: q[0], y: q[1] + 4, "text-anchor": "middle", class: "c-label" }, pt.node));
          labelled[pt.node] = true;
        }
        g.appendChild(s("title", {}, t("node ", "nó ") + pt.node + " @ 0x" + pt.pos.toString(16).padStart(8, "0") + t(" — click to remove", " — clique para remover")));
        svg.appendChild(g);
      });
      svg.appendChild(s("text", { x: CX, y: CY - 4, "text-anchor": "middle", class: "c-label" }, nodes.length + t(" nodes", " nós")));
      svg.appendChild(s("text", { x: CX, y: CY + 12, "text-anchor": "middle", class: "c-small" }, "0 … 2³² − 1"));
      /* load bars */
      var ld = loads(current, nodes), avg = TOTAL / nodes.length, maxv = 0;
      nodes.forEach(function (n) { maxv = Math.max(maxv, ld[n]); });
      C.clear(bars);
      bars.appendChild(el("div", { class: "csim-lbl", text: t("Keys per node (" + TOTAL.toLocaleString("en") + " keys)", "Chaves por nó (" + TOTAL.toLocaleString("pt-BR") + " chaves)") }));
      nodes.forEach(function (n) {
        bars.appendChild(el("div", { class: "csim-hr-bar " + cat(n) + (n === highlight ? " hl" : "") }, [
          el("span", { class: "csim-hr-name", text: n }),
          el("span", { class: "csim-hr-track" }, [
            el("i", { style: "width:" + (100 * ld[n] / Math.max(maxv, avg * 1.6)).toFixed(1) + "%" }),
            el("em", { style: "left:" + (100 * avg / Math.max(maxv, avg * 1.6)).toFixed(1) + "%", title: t("average", "média") })
          ]),
          el("span", { class: "csim-hr-n", text: ld[n] })
        ]));
      });
      var imb = imbalance(current, nodes);
      st.set("imb", imb.toFixed(2) + "×", imb > 1.5 ? "bad" : imb > 1.2 ? "warn" : "ok");
      bAdd.disabled = nodes.length >= NAMES.length;
      bDel.disabled = nodes.length <= 1;
    }

    var bAdd = C.button(t("+ add a node", "+ adicionar nó"), addNode, { tone: "ok" });
    var bDel = C.button(t("− remove a node", "− remover nó"), function () { removeNode(); }, { tone: "bad" });
    var bReset = C.button(t("restart", "recomeçar"), function () {
      nodes = NAMES.slice(0, Math.max(1, o.nodes)); vnodes = o.vnodes; vn.set(vnodes);
      current = assignRing(keys, nodes, vnodes); moved = {};
      ["moved", "mod", "ideal"].forEach(function (k) { st.set(k, "–", ""); });
      say(t("Add or remove a node (or click one on the ring) and watch which keys move.",
        "Adicione ou remova um nó (ou clique num nó do anel) e veja quais chaves se movem."), "");
      draw(null);
    });

    C.add(root, [
      el("p", { class: "csim-title", text: t("Consistent hashing: what moves when the cluster changes?", "Hashing consistente: o que se move quando o cluster muda?") }),
      el("p", { class: "csim-sub", text: t("Inner dots are keys (seat:0, seat:1, …), colored by the node that owns them; the ring's arcs show each node's range.",
        "Os pontos internos são chaves (seat:0, seat:1, …), na cor do nó dono; os arcos do anel mostram a faixa de cada nó.") }),
      el("div", { class: "csim-row" }, [bAdd, bDel, vn, bReset]),
      el("div", { class: "csim-cols" }, [el("div", { class: "csim-stage" }, svg), el("div", {}, [st, bars])]),
      note
    ]);
    bReset.click();
    return {};
  });
})();
