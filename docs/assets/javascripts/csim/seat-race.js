/*
 * Two fans, one seat (2027.1, class 6 — transactions):
 *
 *   <div class="csim" data-sim="seat-race" data-strategy="naive"></div>
 *
 * Alice (T1) and Bob (T2) try to hold seat A-12 at the same time, each with the statements of one
 * strategy of the page: naive check-then-act at read committed, the conditional UPDATE, SELECT … FOR
 * UPDATE, an optimistic version column, or the naive code at repeatable read. You choose who sends
 * the next statement (or play the interleaving that sold A-12 twice, or Alice first) and watch the
 * row: its committed version, the row lock, who waits, and what each fan is told.
 *
 * The model follows PostgreSQL: a statement that needs a row locked by the other transaction waits;
 * when the holder commits, the waiting statement runs against the new row version: read committed
 * re-checks its WHERE (an UPDATE without a status condition still matches and overwrites; one with
 * AND status = 'AVAILABLE' or AND version = 7 matches 0 rows; FOR UPDATE returns the new row), and
 * repeatable read fails with 40001 because the row changed after its snapshot.
 */
(function () {
  "use strict";

  var FANS = ["Alice", "Bob"];
  var VERSION = 7;                       /* the seat's version before the race, as on the page */
  var STRATS = {
    naive: ["select", "update", "commit"],
    conditional: ["cupdate", "commit"],
    "for-update": ["selectfu", "update", "commit"],
    optimistic: ["selectv", "vupdate", "commit"],
    repeatable: ["select", "update", "commit"]
  };
  var SQL = {
    select: "SELECT status … A-12",
    selectfu: "SELECT status … FOR UPDATE",
    selectv: "SELECT status, version …",
    update: "UPDATE … SET status = 'HELD'",
    cupdate: "UPDATE … AND status = 'AVAILABLE'",
    vupdate: "UPDATE … AND version = 7",
    commit: "COMMIT",
    rollback: "ROLLBACK"
  };

  function create(strategy) {
    strategy = STRATS[strategy] ? strategy : "naive";
    return {
      strategy: strategy, rr: strategy === "repeatable", clock: 0,
      row: { status: "AVAILABLE", held: null, version: VERSION, at: 0 }, lock: null,
      tx: FANS.map(function (f) {
        return { fan: f, steps: STRATS[strategy].slice(), pc: 0, waiting: false, done: false, answer: null, pending: null,
          saw: null, snap: null, sent: 0, waits: 0, log: [] };
      })
    };
  }
  function tx(st, fan) { return st.tx[FANS.indexOf(fan)]; }
  function other(st, t) { return st.tx[1 - FANS.indexOf(t.fan)]; }
  function needsLock(op) { return /update|selectfu/.test(op) && op !== "select"; }

  /* run statement op of t now (the lock is free or t holds it); returns a result line */
  function exec(st, t, op, resumed) {
    var row = st.row, r = { fan: t.fan, op: op, sql: SQL[op], resumed: !!resumed };
    if (t.snap === null) t.snap = st.clock;
    if (op === "select" || op === "selectv") {
      /* the first statement takes the snapshot, so both levels see the last committed row here */
      t.saw = { status: row.status, version: row.version };
      r.out = op === "selectv" ? row.status + ", version " + row.version : row.status;
      if (row.status !== "AVAILABLE") { t.steps[t.pc + 1] = "rollback"; t.steps.length = t.pc + 2; r.decide = "taken"; }
    } else if (op === "selectfu") {
      st.lock = t.fan;
      t.saw = { status: row.status, version: row.version };
      r.out = row.status; r.locked = true;
      if (row.status !== "AVAILABLE") { t.steps[t.pc + 1] = "rollback"; t.steps.length = t.pc + 2; r.decide = "taken"; }
    } else if (op === "update") {
      if (st.rr && row.at > t.snap) {
        r.out = "ERROR: could not serialize access due to concurrent update (40001)";
        r.error = true;
        finish(st, t, "40001");
        return r;
      }
      st.lock = t.fan;
      t.pending = { status: "HELD", held: t.fan, version: row.version };
      r.out = "UPDATE 1";
    } else if (op === "cupdate" || op === "vupdate") {
      var match = op === "cupdate" ? row.status === "AVAILABLE" : row.version === t.saw.version;
      if (match) { st.lock = t.fan; t.pending = { status: "HELD", held: t.fan, version: row.version + (op === "vupdate" ? 1 : 0) }; r.out = "UPDATE 1"; }
      else { r.out = "UPDATE 0"; r.zero = true; t.steps[t.pc + 1] = "rollback"; t.steps.length = t.pc + 2; }
    } else if (op === "commit") {
      if (t.pending) {
        st.clock++;
        st.row = { status: t.pending.status, held: t.pending.held, version: t.pending.version, at: st.clock };
        r.out = "COMMIT";
        finish(st, t, "201");
      } else { r.out = "COMMIT"; finish(st, t, "409"); }
    } else if (op === "rollback") {
      r.out = "ROLLBACK";
      finish(st, t, "409");
    }
    return r;
  }

  function finish(st, t, answer) {
    t.done = true; t.answer = answer; t.pending = null;
    if (st.lock === t.fan) st.lock = null;
  }

  /* t sends its next statement: it runs, or waits for the other's row lock */
  function next(st, fan) {
    var t = tx(st, fan), out = [];
    if (t.done) return [{ fan: fan, op: "", sql: "", out: fan + " is done", idle: true }];
    if (t.waiting) return [{ fan: fan, op: t.steps[t.pc], sql: SQL[t.steps[t.pc]], out: "(still waiting for the row lock)", idle: true, wait: true }];
    var op = t.steps[t.pc], o = other(st, t);
    t.sent++;
    if (needsLock(op) && st.lock && st.lock !== fan) {
      t.waiting = true; t.waits++;
      return [{ fan: fan, op: op, sql: SQL[op], out: "(waits: " + o.fan + " holds the row lock)", wait: true }];
    }
    out.push(exec(st, t, op));
    t.pc++;
    /* the other's waiting statement runs as soon as the lock is free */
    if (o.waiting && st.lock !== fan && !(st.lock && st.lock !== o.fan)) {
      o.waiting = false;
      var r = exec(st, o, o.steps[o.pc], true);
      o.pc++;
      out.push(r);
    }
    return out;
  }

  /* who moves at step k of a schedule: interleaved alternates A, B, …; serial runs Alice first */
  function pick(st, schedule, k) {
    var a = st.tx[0], b = st.tx[1];
    function can(t) { return !t.done && !t.waiting; }
    if (schedule === "serial") return can(a) ? "Alice" : can(b) ? "Bob" : null;
    var first = k % 2 === 1 ? a : b, second = first === a ? b : a;
    return can(first) ? first.fan : can(second) ? second.fan : null;
  }
  function done(st) { return st.tx[0].done && st.tx[1].done; }
  /* the whole race under a schedule */
  function race(strategy, schedule) {
    var st = create(strategy), lines = [], k = 0, who;
    while (!done(st) && k < 20 && (who = pick(st, schedule, ++k))) lines = lines.concat(next(st, who));
    return { st: st, lines: lines };
  }
  function outcome(st) {
    var a = st.tx[0].answer, b = st.tx[1].answer;
    return { alice: a, bob: b, held: st.row.held, version: st.row.version, double: a === "201" && b === "201",
      waits: st.tx[0].waits + st.tx[1].waits, sent: [st.tx[0].sent, st.tx[1].sent] };
  }

  var API = { FANS: FANS, VERSION: VERSION, STRATS: STRATS, SQL: SQL, create: create, next: next, pick: pick, race: race, outcome: outcome, done: done, tx: tx };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var COL = { Alice: 8, Bob: 412 }, CW = 220, ROW = { x: 240, y: 46, w: 160, h: 118 };

  var ANSWER = {
    "201": [t("201 — \"seat held\"", "201 — \"assento reservado\""), "ok"],
    "409": [t("409 — \"seat taken\"", "409 — \"assento ocupado\""), "warn"],
    "40001": [t("40001 — retry, then 409", "40001 — repetir, depois 409"), "warn"]
  };
  var NAMES = {
    naive: t("naive (check, then act)", "ingênua (verifica, depois age)"), conditional: t("conditional UPDATE", "UPDATE condicional"),
    "for-update": "SELECT … FOR UPDATE", optimistic: t("optimistic (version)", "otimista (version)"), repeatable: t("naive at repeatable read", "ingênua em repeatable read")
  };

  C.style("seat-race", [
    ".md-typeset .csim-sr-stmt { fill: var(--c-bg); stroke: var(--c-line); }",
    ".md-typeset .csim-sr-stmt.done { fill: var(--c-tint); stroke: var(--c-fg3); }",
    ".md-typeset .csim-sr-stmt.cur { stroke: var(--c-ink); stroke-width: 2; }",
    ".md-typeset .csim-sr-stmt.wait { stroke: var(--c-warn); stroke-width: 2; stroke-dasharray: 4 3; }",
    ".md-typeset .csim-sr-stmt.err { stroke: var(--c-bad); stroke-width: 2; }",
    ".md-typeset .csim-sr-lock { fill: var(--c-accent); }",
    ".md-typeset .csim-log.csim-sr-term li { font-family: var(--md-code-font-family, monospace); font-size: .62rem; white-space: pre-wrap; }"
  ].join("\n"));

  C.register("seat-race", function (root) {
    var o = C.opts(root, { strategy: "naive", schedule: "interleaved" });
    var strategy = STRATS[o.strategy] ? o.strategy : "naive", schedule = o.schedule;
    var st, results = { Alice: [], Bob: [] };

    var svg = s("svg", { viewBox: "0 0 640 236", role: "img", "aria-label": t("Two transactions on one seat", "Duas transações num assento") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(6); term.className += " csim-sr-term";
    var tiles = C.stats([
      { key: "alice", label: t("Alice is told", "Alice ouve") },
      { key: "bob", label: t("Bob is told", "Bob ouve") },
      { key: "held", label: t("held_by at the end", "held_by no fim") },
      { key: "waits", label: t("statements that waited", "comandos que esperaram") }
    ]);
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    var cStrat = C.choice({ label: t("Strategy", "Estratégia"), value: strategy,
      options: Object.keys(STRATS).map(function (k) { return { value: k, label: NAMES[k] }; }), onChange: function (v) { strategy = v; reset(); } });
    var cSched = C.choice({ label: t("Order", "Ordem"), value: schedule, options: [
      { value: "interleaved", label: t("interleaved (A, B, A, B…)", "intercalada (A, B, A, B…)") },
      { value: "serial", label: t("Alice first", "Alice primeiro") }
    ], onChange: function (v) { schedule = v; reset(); } });
    var bA = C.button(t("Alice sends the next statement", "Alice envia o próximo comando"), function () { player.pause(); move("Alice"); });
    var bB = C.button(t("Bob sends the next statement", "Bob envia o próximo comando"), function () { player.pause(); move("Bob"); });

    var player = C.player({
      interval: 1500,
      onTick: function (k) { var who = pick(st, schedule, k); if (!who) return false; move(who); return !done(st); },
      onReset: function () { reset(); }
    });

    function show(r) {
      if (r.wait) return r.idle ? t("still waiting for the row lock", "ainda esperando o lock da linha") : t("waits: " + other(st, tx(st, r.fan)).fan + " holds the row lock", "espera: " + other(st, tx(st, r.fan)).fan + " tem o lock da linha");
      return r.out + (r.locked ? t(" (row locked)", " (linha travada)") : "");
    }
    function move(fan) {
      if (done(st)) return;
      var lines = next(st, fan);
      lines.forEach(function (r) {
        if (!r.idle && !r.wait) results[r.fan].push(r);
        term.add(r.fan + (r.resumed ? t(" (resumes)", " (retoma)") : "") + ": " + r.sql + "\n  → " + show(r), r.error || r.zero || r.decide ? "warn" : r.wait ? "warn" : "");
      });
      explain(lines);
      draw();
    }
    function explain(lines) {
      var last = lines[lines.length - 1], res = outcome(st);
      if (done(st)) {
        if (res.double) say(t("DOUBLE BOOKING: both fans were told the seat is theirs, and held_by is " + res.held + ": " + (res.held === "Bob" ? "Alice" : "Bob") + "'s hold was overwritten (a lost update). The row lock only serialized the two UPDATEs; the decision was made on stale reads.",
          "RESERVA DUPLA: os dois fãs ouviram que o assento é deles e held_by é " + res.held + ": a reserva de " + (res.held === "Bob" ? "Alice" : "Bob") + " foi sobrescrita (um lost update). O lock de linha só serializou os dois UPDATEs; a decisão foi tomada sobre leituras velhas."), "bad");
        else say(t("One seat, one hold: " + res.held + " got 201, the other fan was told the seat is taken." + (res.version !== VERSION ? " Version " + VERSION + " → " + res.version + "." : ""),
          "Um assento, uma reserva: " + res.held + " recebeu 201, o outro fã ouviu que o assento está ocupado." + (res.version !== VERSION ? " Versão " + VERSION + " → " + res.version + "." : "")), "ok");
        return;
      }
      if (last.wait) say(t(last.fan + " waits: the other transaction holds the row lock until it commits. Let it commit.", last.fan + " espera: a outra transação tem o lock da linha até o commit. Deixe-a fazer commit."), "warn");
      else if (last.resumed) say(t(last.fan + "'s statement ran as soon as the lock was released, against the new row version: " + last.out + ".",
        "O comando de " + last.fan + " rodou assim que o lock foi liberado, sobre a nova versão da linha: " + last.out + "."), last.error || last.zero || last.decide ? "warn" : "bad");
      else if (last.decide) say(t(last.fan + " read " + last.out + ": the application rolls back and answers \"taken\".", last.fan + " leu " + last.out + ": a aplicação faz rollback e responde \"ocupado\"."), "");
      else say(last.fan + ": " + show(last), "");
    }
    function reset() {
      st = create(strategy); results = { Alice: [], Bob: [] }; term.clear();
      player.total(0);
      say(t("Seat A-12 is AVAILABLE, version " + VERSION + ". Choose who sends the next statement, or press play to run the order chosen above.",
        "O assento A-12 está AVAILABLE, versão " + VERSION + ". Escolha quem envia o próximo comando, ou aperte play para rodar a ordem escolhida acima."), "");
      draw();
    }

    function column(fan) {
      var x = COL[fan], tr = tx(st, fan), g = s("g", {});
      g.appendChild(s("text", { x: x, y: 16, class: "c-label" }, fan + (fan === "Alice" ? " (T1)" : " (T2)")));
      var ans = tr.answer ? ANSWER[tr.answer] : null;
      g.appendChild(s("text", { x: x + CW, y: 16, "text-anchor": "end", class: "c-small" + (ans ? " c-" + ans[1] : "") }, ans ? ans[0] : tr.waiting ? t("waiting…", "esperando…") : ""));
      tr.steps.forEach(function (op, i) {
        var y = 28 + i * 52, done1 = i < tr.pc, cur = i === tr.pc && !tr.done;
        var res = results[fan][i];
        var cls = "csim-sr-stmt" + (done1 ? " done" : "") + (cur ? (tr.waiting ? " wait" : " cur") : "") + (res && (res.error || res.zero) ? " err" : "");
        g.appendChild(s("rect", { x: x, y: y, width: CW, height: 44, rx: 5, class: cls }));
        g.appendChild(s("text", { x: x + 8, y: y + 17, class: "c-small c-mono" }, SQL[op]));
        var line = res ? "→ " + show(res) : cur && tr.waiting ? t("→ waits for the row lock", "→ espera o lock da linha") : "";
        if (line.length > 40) line = line.slice(0, 39) + "…";
        g.appendChild(s("text", { x: x + 8, y: y + 34, class: "c-small" + (res && (res.error || res.zero || res.decide) ? " c-warn" : cur && tr.waiting ? " c-warn" : "") }, line));
      });
      return g;
    }

    function draw() {
      C.clear(svg);
      svg.appendChild(column("Alice"));
      svg.appendChild(column("Bob"));
      /* the row */
      var r = st.row, double = outcome(st).double;
      svg.appendChild(s("rect", { x: ROW.x, y: ROW.y, width: ROW.w, height: ROW.h, rx: 8, class: "c-box " + (double ? "bad" : r.status === "HELD" ? "ok" : "on") }));
      svg.appendChild(s("text", { x: ROW.x + ROW.w / 2, y: ROW.y + 18, "text-anchor": "middle", class: "c-label" }, t("seat A-12 (committed)", "assento A-12 (commitado)")));
      [["status", r.status], ["held_by", r.held || "NULL"], ["version", String(r.version)]].forEach(function (kv, i) {
        svg.appendChild(s("text", { x: ROW.x + 12, y: ROW.y + 42 + i * 18, class: "c-small c-mono" }, kv[0]));
        svg.appendChild(s("text", { x: ROW.x + ROW.w - 12, y: ROW.y + 42 + i * 18, "text-anchor": "end", class: "c-small c-mono" + (kv[0] === "held_by" && double ? " c-bad" : "") }, kv[1]));
      });
      svg.appendChild(s("text", { x: ROW.x + ROW.w / 2, y: ROW.y + 104, "text-anchor": "middle", class: "c-small" + (st.lock ? " c-warn" : "") },
        st.lock ? "🔒 " + t("locked by ", "travada por ") + st.lock : t("no row lock", "sem lock de linha")));
      /* pending (uncommitted) versions */
      st.tx.forEach(function (tr) {
        if (!tr.pending) return;
        var left = tr.fan === "Alice";
        svg.appendChild(s("text", { x: ROW.x + ROW.w / 2, y: left ? ROW.y + ROW.h + 18 : ROW.y + ROW.h + 34, "text-anchor": "middle", class: "c-small" },
          tr.fan + t(" (uncommitted): HELD, v", " (sem commit): HELD, v") + tr.pending.version));
      });
      var res = outcome(st);
      tiles.set("alice", res.alice || "–", res.alice === "201" ? (res.double ? "bad" : "ok") : res.alice ? "warn" : "");
      tiles.set("bob", res.bob || "–", res.bob === "201" ? (res.double ? "bad" : "ok") : res.bob ? "warn" : "");
      tiles.set("held", r.held || "NULL", res.double ? "bad" : "");
      tiles.set("waits", String(res.waits), res.waits ? "warn" : "");
      bA.disabled = tx(st, "Alice").done; bB.disabled = tx(st, "Bob").done;
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("Two fans, one seat: who is told \"seat held\"?", "Dois fãs, um assento: quem ouve \"assento reservado\"?") }),
      el("p", { class: "csim-sub", text: t("Each column is one transaction; the box in the middle is the committed row. A dashed statement is waiting for the other transaction's row lock.",
        "Cada coluna é uma transação; a caixa do meio é a linha commitada. Um comando tracejado está esperando o lock de linha da outra transação.") }),
      el("div", { class: "csim-row" }, [cStrat]),
      el("div", { class: "csim-row" }, [cSched, bA, bB]),
      el("div", { class: "csim-stage" }, svg),
      note,
      player,
      el("div", { class: "csim-cols" }, [tiles, term])
    ]);
    reset();
    return {};
  });
})();
