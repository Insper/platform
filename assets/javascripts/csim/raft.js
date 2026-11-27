/*
 * Raft (2027.1, distributed — consensus):
 *
 *   <div class="csim" data-sim="raft" data-seed="3"></div>
 *
 * Five nodes on a circle. Randomised election timeouts (the shrinking rings), terms, RequestVote
 * and AppendEntries messages moving as dots, and each node's log with its commit index. The
 * student writes ("hold A-14"), crashes and restarts nodes (click), crashes the leader, and
 * partitions the cluster 2 | 3 with the leader on the small side. A simplified but faithful
 * Raft: one vote per term, the log up-to-date check, commit on a majority in the current term,
 * step down on a higher term, conflicting suffixes overwritten by the leader.
 * One tick = 10 ms: heartbeats every 50 ms, messages take 30–40 ms, timeouts 150–300 ms.
 */
(function () {
  "use strict";

  var N = 5, HB = 5, LAT = 3, EMIN = 15, EMAX = 30;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function create(seed) {
    var st = { now: 0, rnd: mulberry32(seed || 3), nodes: [], msgs: [], groups: null, events: [], seat: 12 };
    for (var i = 0; i < N; i++) {
      st.nodes.push({ id: i, role: "follower", term: 0, votedFor: null, log: [], commit: 0, up: true,
        deadline: 0, span: 1, votes: {}, next: [], match: [], hbAt: 0 });
      resetTimer(st, st.nodes[i]);
    }
    return st;
  }
  function name(i) { return "S" + (i + 1); }
  function emit(st, tone, en, pt) { st.events.push({ tone: tone, en: en, pt: pt, at: st.now }); }
  function resetTimer(st, n) { n.span = EMIN + Math.floor(st.rnd() * (EMAX - EMIN + 1)); n.deadline = st.now + n.span; }
  function lastTerm(n) { return n.log.length ? n.log[n.log.length - 1].term : 0; }
  function reachable(st, a, b) { return !st.groups || st.groups[a] === st.groups[b]; }
  function majority(count) { return count > N / 2; }
  function send(st, from, to, type, data) {
    var m = { from: from, to: to, type: type, term: st.nodes[from].term, sent: st.now, at: st.now + LAT + Math.floor(st.rnd() * 2) };
    Object.keys(data || {}).forEach(function (k) { m[k] = data[k]; });
    st.msgs.push(m);
  }

  function stepDown(st, n, term) {
    var was = n.role;
    if (term > n.term) { n.term = term; n.votedFor = null; }
    n.role = "follower";
    if (was === "leader") emit(st, "warn", name(n.id) + " (leader) sees term " + term + " and steps down to follower: a newer leader exists.",
      name(n.id) + " (líder) vê o termo " + term + " e volta a seguidor: existe um líder mais novo.");
  }

  function startElection(st, n) {
    n.role = "candidate"; n.term++; n.votedFor = n.id; n.votes = {}; n.votes[n.id] = true;
    resetTimer(st, n);
    emit(st, "", name(n.id) + "'s election timeout fired: it starts term " + n.term + ", votes for itself and asks the others.",
      "O timeout de eleição de " + name(n.id) + " disparou: ele inicia o termo " + n.term + ", vota em si e pede votos aos outros.");
    for (var i = 0; i < N; i++) if (i !== n.id) send(st, n.id, i, "RV", { lastIndex: n.log.length, lastTerm: lastTerm(n) });
  }

  function becomeLeader(st, n) {
    n.role = "leader";
    for (var i = 0; i < N; i++) { n.next[i] = n.log.length + 1; n.match[i] = 0; }
    n.match[n.id] = n.log.length;
    emit(st, "ok", name(n.id) + " wins term " + n.term + " with " + Object.keys(n.votes).length + " of " + N + " votes — a majority — and starts sending heartbeats.",
      name(n.id) + " vence o termo " + n.term + " com " + Object.keys(n.votes).length + " de " + N + " votos — uma maioria — e começa a enviar heartbeats.");
    heartbeat(st, n);
  }

  function sendAppend(st, L, to) {
    var prev = L.next[to] - 1;
    send(st, L.id, to, "AE", { prevIndex: prev, prevTerm: prev > 0 ? L.log[prev - 1].term : 0,
      entries: L.log.slice(prev).map(function (e) { return { term: e.term, cmd: e.cmd }; }), commit: L.commit });
  }
  function heartbeat(st, L) {
    L.hbAt = st.now + HB;
    for (var i = 0; i < N; i++) if (i !== L.id) sendAppend(st, L, i);
  }

  function advanceCommit(st, L) {
    for (var idx = L.log.length; idx > L.commit; idx--) {
      if (L.log[idx - 1].term !== L.term) continue;          /* only entries of the current term count */
      var c = 0;
      for (var i = 0; i < N; i++) if ((i === L.id ? L.log.length : L.match[i]) >= idx) c++;
      if (majority(c)) {
        for (var k = L.commit + 1; k <= idx; k++) emit(st, "ok", "Entry " + k + " (" + L.log[k - 1].cmd + ", term " + L.log[k - 1].term + ") is committed: " + c + " of " + N + " logs have it. Now it can never be lost.",
          "A entrada " + k + " (" + L.log[k - 1].cmd + ", termo " + L.log[k - 1].term + ") está confirmada: " + c + " de " + N + " logs a têm. Agora ela nunca mais se perde.");
        L.commit = idx;
        return;
      }
    }
  }

  function handle(st, m) {
    var n = st.nodes[m.to];
    if (m.term > n.term) stepDown(st, n, m.term);
    if (m.type === "RV") {
      var upToDate = m.lastTerm > lastTerm(n) || (m.lastTerm === lastTerm(n) && m.lastIndex >= n.log.length);
      var grant = m.term === n.term && (n.votedFor === null || n.votedFor === m.from) && upToDate;
      if (grant) { n.votedFor = m.from; resetTimer(st, n); }
      else if (m.term === n.term && !upToDate) emit(st, "warn", name(n.id) + " refuses its vote to " + name(m.from) + ": its own log is more up-to-date (election restriction).",
        name(n.id) + " nega o voto a " + name(m.from) + ": o próprio log está mais atualizado (restrição de eleição).");
      send(st, n.id, m.from, "RVR", { granted: grant });
    } else if (m.type === "RVR") {
      if (n.role === "candidate" && m.term === n.term && m.granted) {
        n.votes[m.from] = true;
        if (majority(Object.keys(n.votes).length)) becomeLeader(st, n);
      }
    } else if (m.type === "AE") {
      if (m.term < n.term) { send(st, n.id, m.from, "AER", { success: false, match: 0 }); return; }
      if (n.role !== "follower") stepDown(st, n, m.term);
      resetTimer(st, n);
      if (m.prevIndex > n.log.length || (m.prevIndex > 0 && n.log[m.prevIndex - 1].term !== m.prevTerm)) {
        send(st, n.id, m.from, "AER", { success: false, match: 0 });
        return;
      }
      for (var k = 0; k < m.entries.length; k++) {
        var idx = m.prevIndex + 1 + k, e = m.entries[k];
        if (n.log.length >= idx && n.log[idx - 1].term !== e.term) {
          var gone = n.log.slice(idx - 1);
          n.log = n.log.slice(0, idx - 1);
          emit(st, "bad", name(n.id) + " drops " + gone.length + " uncommitted entr" + (gone.length > 1 ? "ies" : "y") + " from index " + idx + " (" + gone.map(function (g) { return g.cmd + ", term " + g.term; }).join("; ") + "): the leader's log overwrites them. Those writes were never acknowledged.",
            name(n.id) + " descarta " + gone.length + " entrada(s) não confirmada(s) a partir do índice " + idx + " (" + gone.map(function (g) { return g.cmd + ", termo " + g.term; }).join("; ") + "): o log do líder as sobrescreve. Essas escritas nunca foram confirmadas.");
        }
        if (n.log.length < idx) n.log.push({ term: e.term, cmd: e.cmd });
      }
      var match = m.prevIndex + m.entries.length;
      if (m.commit > n.commit) n.commit = Math.min(m.commit, match);
      send(st, n.id, m.from, "AER", { success: true, match: match });
    } else if (m.type === "AER") {
      if (n.role !== "leader" || m.term !== n.term) return;
      if (m.success) { n.match[m.from] = Math.max(n.match[m.from], m.match); n.next[m.from] = n.match[m.from] + 1; advanceCommit(st, n); }
      else { n.next[m.from] = Math.max(1, n.next[m.from] - 1); sendAppend(st, n, m.from); }
    }
  }

  function tick(st) {
    st.now++;
    var due = st.msgs.filter(function (m) { return m.at <= st.now; });
    st.msgs = st.msgs.filter(function (m) { return m.at > st.now; });
    due.forEach(function (m) { if (st.nodes[m.to].up && reachable(st, m.from, m.to)) handle(st, m); });
    st.nodes.forEach(function (n) {
      if (!n.up) return;
      if (n.role === "leader") { if (st.now >= n.hbAt) heartbeat(st, n); }
      else if (st.now >= n.deadline) startElection(st, n);
    });
  }

  function leaders(st) { return st.nodes.filter(function (n) { return n.up && n.role === "leader"; }); }
  function leader(st) { var l = leaders(st); l.sort(function (a, b) { return b.term - a.term; }); return l[0] || null; }

  /* a client write; side = partition group the client is in (null: any) */
  function write(st, side) {
    var L = leaders(st).filter(function (n) { return side === null || side === undefined || !st.groups || st.groups[n.id] === side; })
      .sort(function (a, b) { return b.term - a.term; })[0];
    if (!L) {
      emit(st, "bad", "No leader reachable: the write is rejected (the client retries later).", "Nenhum líder alcançável: a escrita é rejeitada (o cliente tenta de novo depois).");
      return null;
    }
    var cmd = "hold A-" + st.seat++;
    L.log.push({ term: L.term, cmd: cmd });
    L.match[L.id] = L.log.length;
    var reach = st.nodes.filter(function (n) { return n.up && reachable(st, L.id, n.id); }).length;
    if (!majority(reach)) emit(st, "bad", "Client → " + name(L.id) + ": '" + cmd + "' appended at index " + L.log.length + ", but " + name(L.id) + " reaches only " + reach + " of " + N + " nodes: it can never commit this entry.",
      "Cliente → " + name(L.id) + ": '" + cmd + "' anexado no índice " + L.log.length + ", mas " + name(L.id) + " alcança só " + reach + " de " + N + " nós: nunca vai confirmar essa entrada.");
    else emit(st, "", "Client → " + name(L.id) + ": '" + cmd + "' appended at index " + L.log.length + " (term " + L.term + "), not committed yet.",
      "Cliente → " + name(L.id) + ": '" + cmd + "' anexado no índice " + L.log.length + " (termo " + L.term + "), ainda não confirmado.");
    for (var i = 0; i < N; i++) if (i !== L.id) sendAppend(st, L, i);
    return L.id;
  }

  /* crash keeps the persistent state (term, vote, log); the commit index is volatile */
  function setUp(st, id, up) {
    var n = st.nodes[id];
    if (n.up === up) return;
    n.up = up;
    if (!up) {
      var was = n.role;
      n.role = "follower";
      emit(st, "bad", name(id) + (was === "leader" ? " (the leader)" : "") + " crashes." + (was === "leader" ? " The followers stop hearing heartbeats; the first timeout to fire starts an election." : ""),
        name(id) + (was === "leader" ? " (o líder)" : "") + " cai." + (was === "leader" ? " Os seguidores param de receber heartbeats; o primeiro timeout a disparar começa uma eleição." : ""));
    } else {
      n.commit = 0; resetTimer(st, n);
      emit(st, "", name(id) + " restarts as a follower with its log and term from disk; it learns the commit index from the leader.",
        name(id) + " volta como seguidor com o log e o termo do disco; aprende o índice de commit com o líder.");
    }
  }

  /* 2 | 3, with the leader (if any) on the small side */
  function partition(st, on) {
    if (!on) { st.groups = null; emit(st, "", "The network heals: every node hears every other again.", "A rede se recupera: todos os nós voltam a se ouvir."); return; }
    var L = leader(st), a = L ? L.id : 0, b = (a + 1) % N;
    st.groups = st.nodes.map(function (n) { return n.id === a || n.id === b ? 0 : 1; });
    emit(st, "warn", "Partition: " + name(a) + ", " + name(b) + " | the other three. " + (L ? name(a) + " is still leader of term " + L.term + " on the small side, but cannot reach a majority." : ""),
      "Partição: " + name(a) + ", " + name(b) + " | os outros três. " + (L ? name(a) + " ainda é líder do termo " + L.term + " no lado pequeno, mas não alcança uma maioria." : ""));
  }

  /* a warmed-up cluster: a leader and two committed holds */
  function preset(seed) {
    var st = create(seed);
    for (var i = 0; i < 300 && !leader(st); i++) tick(st);
    for (i = 0; i < 6; i++) tick(st);
    write(st); for (i = 0; i < 8; i++) tick(st);
    write(st); for (i = 0; i < 20; i++) tick(st);
    st.events = [];
    return st;
  }

  var API = { N: N, HB: HB, EMIN: EMIN, EMAX: EMAX, create: create, tick: tick, write: write, setUp: setUp, partition: partition,
    leader: leader, leaders: leaders, preset: preset, name: name };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var CX = 150, CY = 150, R = 105, NR = 22, LX = 318, CW = 24, SHOWN = 12;

  function pos(i) { var a = -Math.PI / 2 + i * 2 * Math.PI / N; return [CX + R * Math.cos(a), CY + R * Math.sin(a)]; }

  C.style("raft", [
    ".md-typeset .csim-rf-node { cursor: pointer; }",
    ".md-typeset .csim-rf-node:focus { outline: none; }",
    ".md-typeset .csim-rf-node:hover .c-box, .md-typeset .csim-rf-node:focus .c-box { stroke: var(--c-accent); stroke-width: 2.4; }",
    ".md-typeset .csim-rf-ring { fill: none; stroke: var(--c-fg3); stroke-width: 3; transition: stroke-dasharray .12s linear; }",
    ".md-typeset .csim-rf-ring.low { stroke: var(--c-warn); }",
    ".md-typeset .csim-rf-crown { fill: var(--c-ink); }",
    ".md-typeset .csim-rf-cell { fill: color-mix(in srgb, var(--cat) 30%, var(--c-bg)); stroke: var(--cat); stroke-width: 1.2; }",
    ".md-typeset .csim-rf-cell.unc { fill: var(--c-bg); stroke-dasharray: 3 2; }",
    ".md-typeset .csim-rf-commit { stroke: var(--c-ok); stroke-width: 2.4; }",
    ".md-typeset .csim-rf-row.down { opacity: .45; }",
    ".md-typeset .csim-rf-legend { display: flex; flex-wrap: wrap; gap: .2rem .9rem; color: var(--c-fg2); font-size: .6rem; }",
    ".md-typeset .csim-rf-legend svg { width: .7rem; height: .7rem; vertical-align: -.1rem; margin-right: .2rem; }"
  ].join("\n"));

  C.register("raft", function (root) {
    var o = C.opts(root, { seed: 3 });
    var st, seen = 0;
    var svg = s("svg", { viewBox: "0 0 640 300", role: "img", "aria-label": t("Five Raft nodes and their logs", "Cinco nós Raft e seus logs") });
    var note = el("p", { class: "csim-note" });
    var log = C.log(7);
    var stt = C.stats([
      { key: "term", label: t("highest term", "maior termo") },
      { key: "leader", label: t("leader(s)", "líder(es)") },
      { key: "commit", label: t("committed entries", "entradas confirmadas") },
      { key: "unc", label: t("waiting for a majority", "esperando maioria") }
    ]);
    var writes = el("span", { class: "csim-row", style: "margin:0" });
    var part = C.toggle({ label: t("partition 2 | 3", "partição 2 | 3"), title: t("the leader and one follower on the small side", "o líder e um seguidor no lado pequeno"),
      onChange: function (v) { act(function () { partition(st, v); }); } });
    var bar = C.player({ interval: 140, onTick: function () { tick(st); after(); }, onReset: function () { start(); },
      label: function () { return "t = " + (st ? st.now * 10 : 0) + " ms"; } });

    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    function after() {
      for (; seen < st.events.length; seen++) { var e = st.events[seen]; log.add(t(e.en, e.pt), e.tone); say(t(e.en, e.pt), e.tone); }
      draw();
    }
    function act(fn) { fn(); after(); if (!bar.running()) bar.play(); }

    function start() {
      st = preset(o.seed); seen = 0; log.clear(); part.set(false);
      var L = leader(st);
      say(t(name(L.id) + " leads term " + L.term + "; two holds are committed on every log. Press play, then crash the leader, write, or cut the network.",
        name(L.id) + " lidera o termo " + L.term + "; duas reservas estão confirmadas em todos os logs. Aperte play, depois derrube o líder, escreva ou corte a rede."), "");
      draw();
    }

    function buildWrites() {
      C.clear(writes);
      if (st.groups) {
        writes.appendChild(C.button(t("write on the small side", "escrever no lado pequeno"), function () { act(function () { write(st, 0); }); }));
        writes.appendChild(C.button(t("write on the big side", "escrever no lado grande"), function () { act(function () { write(st, 1); }); }));
      } else writes.appendChild(C.button(t("client write", "escrita do cliente"), function () { act(function () { write(st); }); }));
    }

    function draw() {
      C.clear(svg);
      /* partition line */
      if (st.groups) {
        var small = st.nodes.filter(function (n) { return st.groups[n.id] === 0; }).map(function (n) { return pos(n.id); });
        var mx = (small[0][0] + small[1][0]) / 2 - CX, my = (small[0][1] + small[1][1]) / 2 - CY, d = Math.sqrt(mx * mx + my * my);
        var ux = mx / d, uy = my / d, px = CX + ux * R * 0.3, py = CY + uy * R * 0.3;
        svg.appendChild(s("line", { x1: px - uy * R * 1.25, y1: py + ux * R * 1.25, x2: px + uy * R * 1.25, y2: py - ux * R * 1.25, class: "c-wire cut" }));
      }
      /* messages */
      st.msgs.forEach(function (m) {
        var a = pos(m.from), b = pos(m.to), f = Math.min(1, (st.now - m.sent) / (m.at - m.sent));
        var cls = m.type === "RV" ? "" : m.type === "RVR" ? (m.granted ? "ok" : "bad") : m.type === "AE" ? (m.entries.length ? "ink" : "mute") : "mute";
        var r = m.type === "AER" ? 2.6 : m.type === "AE" && !m.entries.length ? 3.2 : 4.6;
        if (!reachable(st, m.from, m.to)) cls = "bad";
        var c = s("circle", { cx: a[0] + (b[0] - a[0]) * f, cy: a[1] + (b[1] - a[1]) * f, r: r, class: "c-dot " + cls });
        c.appendChild(s("title", {}, m.type + " · term " + m.term));
        svg.appendChild(c);
      });
      /* nodes */
      st.nodes.forEach(function (n) {
        var p = pos(n.id);
        var g = s("g", { class: "csim-rf-node", tabindex: 0, role: "button",
          onclick: function () { act(function () { setUp(st, n.id, !n.up); }); },
          onkeydown: function (e) { if (e.key === "Enter") { e.stopPropagation(); act(function () { setUp(st, n.id, !n.up); }); } } });
        if (n.up && n.role !== "leader") {
          var left = Math.max(0, (n.deadline - st.now) / n.span), circ = 2 * Math.PI * (NR + 6);
          g.appendChild(s("circle", { cx: p[0], cy: p[1], r: NR + 6, class: "csim-rf-ring" + (left < 0.3 ? " low" : ""),
            "stroke-dasharray": (circ * left).toFixed(1) + " " + circ.toFixed(1), transform: "rotate(-90 " + p[0] + " " + p[1] + ")" }));
        }
        var tone = !n.up ? "down" : n.role === "leader" ? "on" : n.role === "candidate" ? "warn" : "";
        g.appendChild(s("circle", { cx: p[0], cy: p[1], r: NR, class: "c-box " + tone }));
        g.appendChild(s("text", { x: p[0], y: p[1] - 2, "text-anchor": "middle", class: "c-label" }, name(n.id)));
        g.appendChild(s("text", { x: p[0], y: p[1] + 11, "text-anchor": "middle", class: "c-small" }, "T" + n.term));
        var role = !n.up ? t("down", "fora") : n.role === "leader" ? t("leader", "líder") : n.role === "candidate" ? t("candidate", "candidato") : "";
        if (role) g.appendChild(s("text", { x: p[0], y: p[1] + (n.id === 0 ? -NR - 12 : NR + 18), "text-anchor": "middle", class: "c-small" + (n.role === "leader" && n.up ? " c-ink" : "") }, role));
        g.appendChild(s("title", {}, name(n.id) + " · " + t("click to ", "clique para ") + (n.up ? t("crash", "derrubar") : t("restart", "reiniciar"))));
        svg.appendChild(g);
      });
      /* logs */
      svg.appendChild(s("text", { x: LX, y: 22, class: "c-label" }, t("Logs (cell = term of the entry)", "Logs (célula = termo da entrada)")));
      var longest = Math.max.apply(null, st.nodes.map(function (n) { return n.log.length; }));
      var first = Math.max(1, longest - SHOWN + 1);
      for (var c = first; c <= Math.min(longest, first + SHOWN - 1); c++)
        svg.appendChild(s("text", { x: LX + 30 + (c - first) * CW + CW / 2 - 1, y: 44, "text-anchor": "middle", class: "c-small" }, c));
      st.nodes.forEach(function (n, i) {
        var y = 54 + i * 46;
        var row = s("g", { class: "csim-rf-row" + (n.up ? "" : " down") });
        row.appendChild(s("text", { x: LX, y: y + 16, class: "c-label" }, name(n.id)));
        n.log.forEach(function (e, k) {
          var idx = k + 1;
          if (idx < first || idx >= first + SHOWN) return;
          var x = LX + 30 + (idx - first) * CW;
          var cell = s("rect", { x: x, y: y, width: CW - 3, height: 22, rx: 3, class: "csim-rf-cell cat-" + (e.term % 8) + (idx > n.commit ? " unc" : "") });
          cell.appendChild(s("title", {}, "index " + idx + " · term " + e.term + " · " + e.cmd + (idx > n.commit ? t(" (not committed here)", " (não confirmada aqui)") : "")));
          row.appendChild(cell);
          row.appendChild(s("text", { x: x + (CW - 3) / 2, y: y + 15, "text-anchor": "middle", class: "c-mono" }, e.term));
        });
        if (n.commit >= first) {
          var cx = LX + 30 + (n.commit - first + 1) * CW - 1.5;
          row.appendChild(s("line", { x1: cx, y1: y - 3, x2: cx, y2: y + 25, class: "csim-rf-commit" }));
        }
        var last = n.log.length ? n.log[n.log.length - 1].cmd : "";
        row.appendChild(s("text", { x: LX + 30, y: y + 35, class: "c-small" }, t("commit ", "commit ") + n.commit + (last ? " · " + t("last: ", "último: ") + last : "")));
        svg.appendChild(row);
      });
      /* stats */
      var ls = leaders(st), top = Math.max.apply(null, st.nodes.map(function (n) { return n.term; }));
      stt.set("term", String(top), "");
      stt.set("leader", ls.length ? ls.map(function (l) { return name(l.id) + " (T" + l.term + ")"; }).join(", ") : t("none", "nenhum"), ls.length === 1 ? "ok" : ls.length ? "warn" : "bad");
      var L = leader(st), best = Math.max.apply(null, st.nodes.map(function (n) { return n.commit; }));
      stt.set("commit", String(best), "ok");
      var unc = ls.reduce(function (a, l) { return a + l.log.length - l.commit; }, 0);
      stt.set("unc", String(unc), unc ? (L && unc && ls.length > 1 ? "bad" : "warn") : "ok");
      buildWrites();
      bar.refresh();
    }

    function legendDot(cls, r) { var v = s("svg", { viewBox: "0 0 12 12" }); v.appendChild(s("circle", { cx: 6, cy: 6, r: r, class: "c-dot " + cls })); return v; }

    C.add(root, [
      el("p", { class: "csim-title", text: t("Raft: who leads, and when is a write safe?", "Raft: quem lidera, e quando uma escrita está segura?") }),
      el("p", { class: "csim-sub", text: t("Click a node to crash or restart it. The ring around a follower is its election timeout running out. On the right, each node's log: solid cells are committed on that node, dashed ones are not; the green bar is its commit index.",
        "Clique num nó para derrubá-lo ou reiniciá-lo. O anel em volta de um seguidor é o timeout de eleição se esgotando. À direita, o log de cada nó: células cheias estão confirmadas naquele nó, tracejadas não; a barra verde é o índice de commit.") }),
      el("div", { class: "csim-row" }, [writes,
        C.button(t("crash the leader", "derrubar o líder"), function () { act(function () { var L = leader(st); if (L) setUp(st, L.id, false); }); }, { tone: "bad" }),
        part]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-rf-legend" }, [
        el("span", {}, [legendDot("", 4.6), "RequestVote"]),
        el("span", {}, [legendDot("ok", 4.6), t("vote granted", "voto concedido")]),
        el("span", {}, [legendDot("ink", 4.6), t("AppendEntries with entries", "AppendEntries com entradas")]),
        el("span", {}, [legendDot("mute", 3.2), t("heartbeat / reply", "heartbeat / resposta")]),
        el("span", {}, [legendDot("bad", 4), t("dropped by the partition", "descartada pela partição")])
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
