/*
 * Single-leader replication (2027.1, class 6 — replication):
 *
 *   <div class="csim" data-sim="replication" data-mode="async"></div>
 *
 * A leader and two followers. The fan holds seats (writes go to the leader) and reads "my holds"
 * from a follower. Each follower replays the leader's log after its lag (db-2 after the lag,
 * db-3 after 1.5 × the lag). The replication mode decides when the leader answers "committed":
 * async (own disk), semi-sync (one follower) or sync (every follower: the slowest one decides).
 * Default lag: LAB.lag, lab 6's read-your-writes experiment (REPLICA_DELAY). Read-your-writes sends the fan's reads to the leader for a few seconds after a write. Crashing
 * the leader promotes the most up-to-date follower: what it had not received is lost.
 */
(function () {
  "use strict";

  /* copied from the labs (registered in scripts/csim/lab-values.mjs) */
  var LAB = { lag: 1000 };          /* ms: lab 6, REPLICA_DELAY */

  var FACTOR = [1.25, 1, 1.5];   /* lag multiplier of each node when it is a follower */
  var RTT = 1, FLUSH = 2;        /* ms: network round trip, local WAL flush */
  var RYW_WINDOW = 5000;         /* ms: reads go to the leader for this long after a write */
  var NAMES = ["db-1", "db-2", "db-3"];
  var AGO = 300;                 /* ms: the starting point, the fan's click after the write */

  function create(o) {
    o = o || {};
    return {
      now: 0, mode: o.mode || "async", lag: o.lag === undefined ? LAB.lag : o.lag, ryw: !!o.ryw,
      nodes: NAMES.map(function (n) { return { name: n, up: true, frozen: null }; }),
      leader: 0, log: [], rr: 0, lastWriteAt: -Infinity, seat: 10,
      stats: { writes: 0, reads: 0, stale: 0, leaderReads: 0, lost: 0, latency: 0 }
    };
  }

  function delay(st, i) { return RTT + st.lag * FACTOR[i]; }

  function followers(st) {
    var out = [];
    st.nodes.forEach(function (n, i) { if (n.up && i !== st.leader) out.push(i); });
    return out;
  }

  /* followers the leader waits for before answering "committed" */
  function syncSet(st) {
    var f = followers(st);
    if (st.mode === "sync") return f;
    if (st.mode === "semi") return f.slice(0, 1);
    return [];
  }

  /* how many log entries node i has replayed (the leader has them all) */
  function applied(st, i) {
    if (i === st.leader) return st.log.length;
    var n = 0;
    while (n < st.log.length && st.log[n].arrive[i] !== undefined && st.log[n].arrive[i] <= st.now) n++;
    return n;
  }

  function advance(st, ms) { st.now += ms; return st; }

  /* the fan holds the next seat; the clock moves while the client waits for "committed" */
  function write(st) {
    var seat = "A-" + st.seat++;
    var prev = st.log[st.log.length - 1];
    var e = { seat: seat, at: st.now, arrive: {} };
    followers(st).forEach(function (i) {
      e.arrive[i] = Math.max(st.now + delay(st, i), prev && prev.arrive[i] !== undefined ? prev.arrive[i] : 0);
    });
    var wait = 0, waited = [];
    syncSet(st).forEach(function (i) { wait = Math.max(wait, e.arrive[i] - st.now); waited.push(st.nodes[i].name); });
    var latency = Math.round(FLUSH + wait);
    st.log.push(e);
    advance(st, latency);
    st.lastWriteAt = st.now;
    st.stats.writes++;
    st.stats.latency = latency;
    return { seat: seat, latency: latency, waited: waited };
  }

  /* read "my holds": from a follower (round robin), or from the leader right after a write */
  function read(st) {
    var f = followers(st), target, why;
    if (st.ryw && st.now - st.lastWriteAt < RYW_WINDOW) { target = st.leader; why = "ryw"; }
    else if (!f.length) { target = st.leader; why = "alone"; }
    else { target = f[st.rr++ % f.length]; why = "replica"; }
    var k = applied(st, target);
    var res = {
      node: target, why: why,
      seen: st.log.slice(0, k).map(function (e) { return e.seat; }),
      missing: st.log.slice(k).map(function (e) { return e.seat; })
    };
    res.stale = res.missing.length > 0;
    st.stats.reads++;
    if (res.stale) st.stats.stale++;
    if (target === st.leader) st.stats.leaderReads++;
    return res;
  }

  /* the leader dies; the follower with the most of the log is promoted */
  function crash(st) {
    var f = followers(st);
    if (!f.length) return null;
    var old = st.leader;
    f.sort(function (a, b) { return applied(st, b) - applied(st, a) || a - b; });
    var next = f[0], keep = applied(st, next);
    var lost = st.log.slice(keep).map(function (e) { return e.seat; });
    st.nodes[old].up = false;
    st.nodes[old].frozen = { seats: st.log.map(function (e) { return e.seat; }), lost: lost };
    st.log = st.log.slice(0, keep);
    st.leader = next;
    st.stats.lost += lost.length;
    return { from: old, to: next, lost: lost };
  }

  /* the page's starting point: A-10 and A-11 replicated, A-12 written 300 ms ago (in flight when lag > 300 ms) */
  function scenario(o) {
    var st = create(o);
    write(st); write(st);
    advance(st, 1500);
    write(st);
    advance(st, AGO);
    return st;
  }

  var API = { create: create, scenario: scenario, write: write, read: read, crash: crash, advance: advance,
    applied: applied, followers: followers, syncSet: syncSet, delay: delay, RYW_WINDOW: RYW_WINDOW, NAMES: NAMES, AGO: AGO, FACTOR: FACTOR, LAB: LAB };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var TICK = 100;
  /* node slots: the first leader in the middle, the two followers on the right */
  var POS = [{ x: 175, y: 92 }, { x: 405, y: 14 }, { x: 405, y: 170 }];
  var BW = 145, BH = 66, FAN = { x: 6, y: 104, w: 80, h: 42 };

  function sec(ms) {
    var v = (ms / 1000).toFixed(ms % 100 ? 3 : 1);
    return (C.PT ? v.replace(".", ",") : v) + " s";
  }
  function list(a) { return a.length ? a.join(", ") : t("nothing", "nada"); }

  C.style("replication", [
    ".md-typeset .csim-rep-cell { stroke-width: 1; }",
    ".md-typeset .csim-rep-cell.have { fill: var(--c-tint2); stroke: var(--c-ink); }",
    ".md-typeset .csim-rep-cell.wait { fill: var(--c-bg); stroke: var(--c-warn); stroke-dasharray: 3 2; }",
    ".md-typeset .csim-rep-cell.lost { fill: color-mix(in srgb, var(--c-bad) 18%, var(--c-bg)); stroke: var(--c-bad); }",
    ".md-typeset .csim-rep-wire.read { stroke: var(--c-accent); stroke-width: 2.4; }",
    ".md-typeset .csim-rep-wire.write { stroke: var(--c-ink); stroke-width: 2.4; }",
    ".md-typeset .csim .csim-rep-node.down text { fill: var(--c-fg3); }"
  ].join("\n"));

  C.register("replication", function (root) {
    var o = C.opts(root, { mode: "async", lag: LAB.lag });
    var st, lastRead = null, lastWrite = false;

    var svg = s("svg", { viewBox: "0 0 560 250", role: "img", "aria-label": t("Leader and followers", "Líder e seguidores") });
    var note = el("p", { class: "csim-note" });
    var events = C.log(7);
    var tiles = C.stats([
      { key: "stale", label: t("stale reads", "leituras desatualizadas") },
      { key: "lat", label: t("last write latency", "latência da última escrita") },
      { key: "lost", label: t("writes lost in failover", "escritas perdidas no failover") },
      { key: "lead", label: t("reads on the leader", "leituras no líder") }
    ]);
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    function stamp(text, tone) { events.add("t=" + sec(st.now) + "  " + text, tone); }

    var mode = C.choice({
      label: t("Mode", "Modo"), value: o.mode,
      options: [
        { value: "async", label: "async", title: t("the leader answers after its own disk flush", "o líder responde após gravar no próprio disco") },
        { value: "semi", label: "semi-sync", title: t("waits for one follower (db-2)", "espera um seguidor (db-2)") },
        { value: "sync", label: "sync", title: t("waits for every follower", "espera todos os seguidores") }
      ],
      onChange: function (v) {
        st.mode = v;
        say(v === "async" ? t("Async: the leader answers after its own flush; followers catch up later.", "Async: o líder responde após gravar no próprio disco; os seguidores alcançam depois.")
          : v === "semi" ? t("Semi-sync: each write waits for one follower, so one copy is always complete.", "Semissíncrono: cada escrita espera um seguidor, então uma cópia está sempre completa.")
          : t("Sync: each write waits for every follower — the slowest one sets the latency.", "Síncrono: cada escrita espera todos os seguidores — o mais lento define a latência."), "");
        draw();
      }
    });
    var lag = C.slider({
      label: t("Lag", "Atraso"), min: 0, max: 2000, step: 100, value: o.lag,
      fmt: function (v) { return v + " ms"; },
      onInput: function (v) { st.lag = v; draw(); }
    });
    var ryw = C.toggle({
      label: t("read your writes", "ler as próprias escritas"),
      title: t("for 5 s after a write, the fan's reads go to the leader", "por 5 s após uma escrita, as leituras do fã vão para o líder"),
      onChange: function (v) { st.ryw = v; draw(); }
    });

    var bWrite = C.button(t("hold a seat (write)", "segurar assento (escrita)"), function () {
      var r = write(st);
      lastWrite = true; lastRead = null;
      stamp(t("write " + r.seat + " → committed in " + r.latency + " ms", "escrita " + r.seat + " → confirmada em " + r.latency + " ms"), r.latency > 500 ? "warn" : "ok");
      say(r.waited.length
        ? t("Hold " + r.seat + " committed after " + r.latency + " ms: the leader waited for " + r.waited.join(" and ") + ". The fan's click was blocked meanwhile (the clock jumped).",
          "Reserva " + r.seat + " confirmada após " + r.latency + " ms: o líder esperou " + r.waited.join(" e ") + ". O clique do fã ficou bloqueado nesse tempo (o relógio saltou).")
        : t("Hold " + r.seat + " committed in " + r.latency + " ms (leader's own disk). The WAL is on its way to the followers — read now and you hit a replica that does not have it.",
          "Reserva " + r.seat + " confirmada em " + r.latency + " ms (disco do próprio líder). O WAL está a caminho dos seguidores — leia agora e você cai numa réplica que ainda não a tem."), "");
      draw();
    }, { tone: "ok" });
    var bRead = C.button(t("read my holds", "ler minhas reservas"), function () {
      var r = read(st);
      lastRead = r; lastWrite = false;
      var who = st.nodes[r.node].name;
      stamp(t("read on " + who + " → " + list(r.seen), "leitura em " + who + " → " + list(r.seen)) + (r.stale ? t("  (stale)", "  (desatualizada)") : ""), r.stale ? "bad" : "ok");
      if (r.stale) say(t("Stale read: " + who + " has not replayed " + list(r.missing) + " yet. The fan paid, and \"My holds\" does not show it.",
        "Leitura desatualizada: " + who + " ainda não aplicou " + list(r.missing) + ". O fã pagou, e \"Minhas reservas\" não mostra."), "bad");
      else if (r.why === "ryw") say(t("Read-your-writes: the fan wrote less than 5 s ago, so this read went to the leader (" + who + ") — fresh, at the cost of leader load.",
        "Read-your-writes: o fã escreveu há menos de 5 s, então esta leitura foi ao líder (" + who + ") — atualizada, ao custo de carga no líder."), "ok");
      else say(t(who + " has every hold: " + list(r.seen) + ".", who + " tem todas as reservas: " + list(r.seen) + "."), "ok");
      draw();
    });
    var bCrash = C.button(t("crash the leader", "derrubar o líder"), function () {
      var r = crash(st);
      if (!r) return;
      player.pause();
      lastRead = null; lastWrite = false;
      var a = st.nodes[r.from].name, b = st.nodes[r.to].name;
      stamp(t(a + " crashed; " + b + " promoted", a + " caiu; " + b + " promovido") + (r.lost.length ? t(", lost " + list(r.lost), ", perdidas " + list(r.lost)) : ""), r.lost.length ? "bad" : "warn");
      if (r.lost.length) say(t(a + " died and " + b + " (the most up-to-date follower) took over. " + list(r.lost) + " had been confirmed to the fan but never reached " + b + ": lost — the seat can be sold again.",
        a + " morreu e " + b + " (o seguidor mais atualizado) assumiu. " + list(r.lost) + " tinha(m) sido confirmada(s) ao fã, mas nunca chegou(aram) a " + b + ": perdida(s) — o assento pode ser vendido de novo."), "bad");
      else say(t(a + " died and " + b + " took over with every confirmed hold: nothing lost." + (st.mode === "async" ? " (Lucky: nothing was in flight.)" : " That is what waiting for a follower buys."),
        a + " morreu e " + b + " assumiu com todas as reservas confirmadas: nada perdido." + (st.mode === "async" ? " (Sorte: nada estava em trânsito.)" : " É isso que esperar um seguidor compra.")), "ok");
      draw();
    }, { tone: "bad" });

    var player = C.player({
      interval: 300,
      label: function () { return "t = " + sec(st ? st.now : 0); },
      onTick: function () { advance(st, TICK); draw(); },
      onReset: function () { reset(); }
    });

    function cells(x, y, seats, cls) {
      var g = s("g", {});
      seats.slice(-4).forEach(function (seat, k) {
        var cx = x + 8 + k * 33;
        g.appendChild(s("rect", { x: cx, y: y, width: 30, height: 16, rx: 3, class: "csim-rep-cell " + cls(seat) }));
        g.appendChild(s("text", { x: cx + 15, y: y + 11.5, "text-anchor": "middle", class: "c-small c-mono" }, seat));
      });
      return g;
    }

    function center(i) { return { x: POS[i].x + BW / 2, y: POS[i].y + BH / 2 }; }

    function draw() {
      C.clear(svg);
      var L = st.leader, sync = syncSet(st);
      /* fan wires: to the leader (writes) and to each node (reads) */
      st.nodes.forEach(function (n, i) {
        if (!n.up) return;
        var c = center(i), cls = "c-wire csim-rep-wire";
        if (i === L && lastWrite) cls += " write";
        if (lastRead && lastRead.node === i) cls += " read";
        var fx = FAN.x + FAN.w, fy = FAN.y + FAN.h / 2;
        svg.appendChild(s("path", { d: "M" + fx + "," + fy + " C" + (fx + 50) + "," + c.y + " " + (POS[i].x - 120) + "," + c.y + " " + POS[i].x + "," + c.y, class: cls }));
      });
      /* WAL wires and entries in flight */
      followers(st).forEach(function (i) {
        var a = center(L), b = center(i);
        var x1 = a.x + (b.x > a.x ? BW / 2 : 0), y1 = a.y + (b.y > a.y ? BH / 2 : b.y < a.y ? -BH / 2 : 0);
        var x2 = b.x - (b.x > a.x ? BW / 2 : 0), y2 = b.y + (b.y > a.y ? -BH / 2 : b.y < a.y ? BH / 2 : 0);
        svg.appendChild(s("line", { x1: x1, y1: y1, x2: x2, y2: y2, class: "c-wire on" + (sync.indexOf(i) >= 0 ? "" : " dashed") }));
        var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        var vert = Math.abs(x2 - x1) < 10;
        svg.appendChild(s("text", { x: vert ? mx + 6 : mx, y: vert ? my + 3 : my - 7, "text-anchor": vert ? "start" : "middle", class: "c-small" },
          (sync.indexOf(i) >= 0 ? "sync · " : "async · ") + Math.round(delay(st, i)) + " ms"));
        st.log.forEach(function (e) {
          var arr = e.arrive[i];
          if (arr === undefined || arr <= st.now) return;
          var f = Math.max(0, Math.min(1, (st.now - e.at) / Math.max(1, arr - e.at)));
          var dot = s("circle", { cx: x1 + (x2 - x1) * f, cy: y1 + (y2 - y1) * f, r: 5, class: "c-dot" });
          dot.appendChild(s("title", {}, e.seat));
          svg.appendChild(dot);
        });
      });
      /* the fan */
      svg.appendChild(s("rect", { x: FAN.x, y: FAN.y, width: FAN.w, height: FAN.h, rx: 6, class: "c-box on" }));
      svg.appendChild(s("text", { x: FAN.x + FAN.w / 2, y: FAN.y + 18, "text-anchor": "middle", class: "c-label" }, t("fan", "fã")));
      svg.appendChild(s("text", { x: FAN.x + FAN.w / 2, y: FAN.y + 32, "text-anchor": "middle", class: "c-small" }, "order service"));
      /* the nodes and their logs */
      st.nodes.forEach(function (n, i) {
        var p = POS[i], g = s("g", { class: "csim-rep-node" + (n.up ? "" : " down") });
        var box = !n.up ? "down" : i === L ? "hot" : lastRead && lastRead.node === i ? (lastRead.stale ? "bad" : "ok") : "on";
        g.appendChild(s("rect", { x: p.x, y: p.y, width: BW, height: BH, rx: 8, class: "c-box " + box }));
        var role = !n.up ? t("down", "fora do ar") : i === L ? t("leader", "líder")
          : t("follower", "seguidor") + (sync.indexOf(i) >= 0 ? " · sync" : "");
        g.appendChild(s("text", { x: p.x + 8, y: p.y + 16, class: "c-label" }, n.name));
        g.appendChild(s("text", { x: p.x + BW - 8, y: p.y + 16, "text-anchor": "end", class: "c-small" }, role));
        if (!n.up) {
          var fr = n.frozen;
          g.appendChild(cells(p.x, p.y + 26, fr.seats, function (seat) { return fr.lost.indexOf(seat) >= 0 ? "lost" : "have"; }));
          if (fr.lost.length) g.appendChild(s("text", { x: p.x + 8, y: p.y + 58, class: "c-small c-bad" }, t("lost: ", "perdidas: ") + fr.lost.join(", ")));
        } else {
          var k = applied(st, i);
          g.appendChild(cells(p.x, p.y + 26, st.log.map(function (e) { return e.seat; }), function (seat) {
            var idx = -1;
            for (var j = 0; j < st.log.length; j++) if (st.log[j].seat === seat) idx = j;
            return idx < k ? "have" : "wait";
          }));
          var behind = st.log.length - k;
          g.appendChild(s("text", { x: p.x + 8, y: p.y + 58, class: "c-small" + (behind ? " c-warn" : "") },
            i === L ? t(st.log.length + " holds in the log", st.log.length + " reservas no log")
              : behind ? t(behind + " behind", behind + " atrás") : t("up to date", "em dia")));
        }
        svg.appendChild(g);
      });
      /* stats */
      var S = st.stats;
      tiles.set("stale", S.stale + " / " + S.reads, S.stale ? "bad" : S.reads ? "ok" : "");
      tiles.set("lat", S.writes ? S.latency + " ms" : "–", !S.writes ? "" : S.latency > 500 ? "bad" : S.latency > 20 ? "warn" : "ok");
      tiles.set("lost", String(S.lost), S.lost ? "bad" : "ok");
      tiles.set("lead", S.leaderReads + " / " + S.reads, S.reads && S.leaderReads / S.reads > 0.5 ? "warn" : "");
      bCrash.disabled = !followers(st).length;
      player.refresh();
    }

    function reset() {
      st = scenario({ mode: mode.get(), lag: lag.get(), ryw: ryw.get() });
      lastRead = null; lastWrite = true;
      events.clear();
      stamp(t("A-10, A-11 replicated; A-12 written 300 ms ago", "A-10, A-11 replicadas; A-12 escrita há 300 ms"), "info");
      say(t("The fan held A-12 300 ms ago and now opens \"My holds\". Read it — then press play to let the WAL arrive, or crash the leader while A-12 is in flight.",
        "O fã segurou A-12 há 300 ms e agora abre \"Minhas reservas\". Leia — depois aperte play para o WAL chegar, ou derrube o líder com A-12 em trânsito."), "");
      draw();
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("Replication lag: does the fan see their own hold — and does it survive a failover?",
        "Atraso de replicação: o fã vê a própria reserva — e ela sobrevive a um failover?") }),
      el("p", { class: "csim-sub", text: t("Writes go to the leader; each follower replays the WAL after its lag (db-3 is 1.5× slower). Dots are entries in flight.",
        "As escritas vão ao líder; cada seguidor aplica o WAL após seu atraso (db-3 é 1,5× mais lento). Os pontos são entradas em trânsito.") }),
      el("div", { class: "csim-row" }, [mode, lag, ryw]),
      el("div", { class: "csim-row" }, [bWrite, bRead, bCrash]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-cols" }, [tiles, events]),
      note,
      player
    ]);
    reset();
    return {};
  });
})();
