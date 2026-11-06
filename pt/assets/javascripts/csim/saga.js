/*
 * Saga vs two-phase commit (2027.1, distributed — transactions):
 *
 *   <div class="csim" data-sim="saga" data-mode="saga" data-fail="declined"></div>
 *
 * The BoxOffice checkout across order, inventory, payment and ticket. As a saga (orchestrated by
 * order), each step is a local transaction; the student picks where it fails and watches the
 * compensations run in reverse (refund, release the seat, cancel the order), or the retries after
 * the pivot. As 2PC, participants prepare and hold row locks; if the coordinator crashes after
 * the votes, they stay in doubt, the seat stays locked and other fans queue behind it.
 */
(function () {
  "use strict";

  var SVC = ["order", "inventory", "payment", "ticket"];
  var FAILS = { saga: ["none", "reserve", "declined", "timeout", "ticket"], "2pc": ["none", "vote-no", "crash"] };

  /* one step: a message from → to (or a local step when from === to), the states it sets, the locks */
  function S(from, to, en, pt, dt, o) {
    o = o || {};
    return { from: from, to: to, en: en, pt: pt, dt: dt, set: o.set || {}, locks: o.locks || {}, log: o.log || null,
      note: o.note || null, tone: o.tone || "", outcome: o.outcome || null, crash: !!o.crash };
  }

  function sagaPlan(fail) {
    var p = [];
    p.push(S(0, 0, "T1: order 981 PENDING", "T1: pedido 981 PENDING", 5, { set: { 0: "981 PENDING" }, log: ["T1 order PENDING ✓", "T1 pedido PENDING ✓", "ok"] }));
    p.push(S(0, 1, "T2: reserve A-12 for payment", "T2: reservar A-12 para pagamento", 20));
    if (fail === "reserve") {
      p.push(S(1, 0, "refused: the hold on A-12 expired", "recusado: a reserva de A-12 expirou", 20, { set: { 1: "A-12 FREE" }, log: ["T2 reserve ✗", "T2 reservar ✗", "bad"], tone: "bad",
        note: ["T2 failed. Only T1 is done, so only C1 is needed.", "T2 falhou. Só T1 foi feito, então só C1 é necessária."] }));
      p.push(S(0, 0, "C1: order 981 CANCELLED", "C1: pedido 981 CANCELLED", 5, { set: { 0: "981 CANCELLED" }, log: ["C1 cancel order ✓", "C1 cancelar pedido ✓", "warn"], tone: "warn", outcome: "compensated" }));
      return p;
    }
    p.push(S(1, 0, "reserved", "reservado", 20, { set: { 1: "A-12 RESERVED" }, log: ["T2 reserve A-12 ✓", "T2 reservar A-12 ✓", "ok"],
      note: ["T2 committed in inventory's own database. No lock is held: RESERVED is a semantic lock — another fan asking for A-12 gets 'unavailable' at once.",
        "T2 confirmada no banco do próprio inventory. Nenhum lock fica preso: RESERVED é um lock semântico — outro fã que pede A-12 recebe 'indisponível' na hora."] }));
    p.push(S(0, 2, "T3: charge R$ 450 (key 981)", "T3: cobrar R$ 450 (chave 981)", 20));
    if (fail === "declined" || fail === "timeout") {
      if (fail === "declined") {
        p.push(S(2, 0, "declined (card limit)", "recusado (limite do cartão)", 800, { set: { 2: "DECLINED" }, log: ["T3 charge ✗ declined", "T3 cobrança ✗ recusada", "bad"], tone: "bad",
          note: ["T3 failed. The orchestrator compensates the steps already done, in reverse order: C2, then C1.", "T3 falhou. O orquestrador compensa os passos já feitos, em ordem inversa: C2, depois C1."] }));
      } else {
        p.push(S(2, 2, "charged R$ 450 — the reply is lost", "cobrado R$ 450 — a resposta se perde", 800, { set: { 2: "CHARGED R$ 450" } }));
        p.push(S(0, 0, "no answer after 5 s: timeout", "sem resposta após 5 s: timeout", 5000, { log: ["T3 charge ✗ timeout", "T3 cobrança ✗ timeout", "bad"], tone: "bad",
          note: ["The orchestrator does not know whether the card was charged, so it compensates T3 too: a refund with the same idempotency key is safe either way.",
            "O orquestrador não sabe se o cartão foi cobrado, então compensa T3 também: um estorno com a mesma chave de idempotência é seguro nos dois casos."] }));
        p.push(S(0, 2, "C3: refund (key 981)", "C3: estornar (chave 981)", 20));
        p.push(S(2, 0, "refunded R$ 450", "estornado R$ 450", 600, { set: { 2: "REFUNDED R$ 450" }, log: ["C3 refund ✓", "C3 estorno ✓", "warn"], tone: "warn" }));
      }
      p.push(S(0, 1, "C2: release A-12", "C2: liberar A-12", 20));
      p.push(S(1, 0, "released", "liberado", 20, { set: { 1: "A-12 FREE" }, log: ["C2 release A-12 ✓", "C2 liberar A-12 ✓", "warn"], tone: "warn" }));
      p.push(S(0, 0, "C1: order 981 CANCELLED, tell the fan", "C1: pedido 981 CANCELLED, avisar o fã", 5, { set: { 0: "981 CANCELLED" }, log: ["C1 cancel order ✓", "C1 cancelar pedido ✓", "warn"], tone: "warn",
        outcome: fail === "timeout" ? "refunded" : "compensated" }));
      return p;
    }
    p.push(S(2, 0, "charged — the pivot", "cobrado — o pivô", 800, { set: { 2: "CHARGED R$ 450" }, log: ["T3 charge ✓ (pivot)", "T3 cobrança ✓ (pivô)", "ok"],
      note: ["T3 is the pivot: from here on the saga only goes forward. Later steps are retried until they succeed, never compensated.",
        "T3 é o pivô: daqui em diante a saga só avança. Os passos seguintes são repetidos até dar certo, nunca compensados."] }));
    p.push(S(0, 1, "T4: mark A-12 SOLD", "T4: marcar A-12 SOLD", 20));
    p.push(S(1, 0, "sold", "vendido", 20, { set: { 1: "A-12 SOLD" }, log: ["T4 seat SOLD ✓", "T4 assento SOLD ✓", "ok"] }));
    p.push(S(0, 3, "T4: issue the ticket", "T4: emitir o ingresso", 20));
    if (fail === "ticket") {
      p.push(S(3, 0, "503: ticket is down", "503: ticket fora do ar", 20, { set: { 3: "DOWN" }, log: ["T4 ticket ✗ 503, retry", "T4 ingresso ✗ 503, repetir", "bad"], tone: "bad",
        note: ["After the pivot a failure is not compensated: the orchestrator retries with backoff (same idempotency key).", "Depois do pivô uma falha não é compensada: o orquestrador repete com backoff (mesma chave de idempotência)."] }));
      p.push(S(0, 3, "retry 1 s later", "nova tentativa 1 s depois", 1000));
      p.push(S(3, 0, "503 again", "503 de novo", 20, { log: ["T4 ticket ✗ 503, retry", "T4 ingresso ✗ 503, repetir", "bad"], tone: "bad" }));
      p.push(S(0, 3, "retry 2 s later", "nova tentativa 2 s depois", 2000));
    }
    p.push(S(3, 0, "ticket T-5521 issued", "ingresso T-5521 emitido", 20, { set: { 3: "T-5521 ISSUED" }, log: ["T4 ticket ✓", "T4 ingresso ✓", "ok"] }));
    p.push(S(0, 0, "order 981 CONFIRMED, notify the fan", "pedido 981 CONFIRMED, notificar o fã", 5, { set: { 0: "981 CONFIRMED" }, log: ["saga done ✓", "saga concluída ✓", "ok"], tone: "ok", outcome: "committed" }));
    return p;
  }

  function tpcPlan(fail) {
    var p = [];
    p.push(S(0, 0, "coordinator: begin tx 981", "coordenador: begin tx 981", 5, { set: { 0: "tx 981 ACTIVE" }, log: ["begin tx 981", "begin tx 981", ""] }));
    var parts = [[1, "A-12 → SOLD", "A-12 PREPARED"], [2, "debit R$ 450", "R$ 450 PREPARED"], [3, "ticket T-5521", "T-5521 PREPARED"]];
    for (var k = 0; k < parts.length; k++) {
      var q = parts[k][0];
      p.push(S(0, q, "PREPARE (" + parts[k][1] + ")", "PREPARE (" + parts[k][1] + ")", 20));
      if (fail === "vote-no" && q === 3) {
        p.push(S(3, 0, "NO (seat map changed)", "NÃO (mapa de assentos mudou)", 20, { set: { 3: "ABORTED" }, log: ["ticket votes NO", "ticket vota NÃO", "bad"], tone: "bad",
          note: ["One NO is enough: the coordinator decides ABORT for everyone. Nobody committed, so nothing needs compensating.", "Um NÃO basta: o coordenador decide ABORT para todos. Ninguém confirmou, então nada precisa ser compensado."] }));
        p.push(S(0, 0, "write ABORT to the coordinator log", "gravar ABORT no log do coordenador", 5, { log: ["decision: ABORT", "decisão: ABORT", "warn"] }));
        p.push(S(0, 1, "ROLLBACK PREPARED", "ROLLBACK PREPARED", 20, { set: { 1: "A-12 HELD" }, locks: { 1: false } }));
        p.push(S(0, 2, "ROLLBACK PREPARED", "ROLLBACK PREPARED", 20, { set: { 2: "—" }, locks: { 2: false } }));
        p.push(S(0, 0, "order 981 CANCELLED", "pedido 981 CANCELLED", 5, { set: { 0: "981 CANCELLED" }, outcome: "aborted", tone: "warn" }));
        return p;
      }
      var lk = {}; lk[q] = true;
      var st = {}; st[q] = parts[k][2];
      p.push(S(q, 0, "YES (row locked)", "SIM (linha travada)", 20, { set: st, locks: lk, log: [SVC[q] + " votes YES, holds the lock", SVC[q] + " vota SIM, segura o lock", ""],
        note: k === 0 ? ["inventory wrote the change and a 'prepared' record and now holds the row lock on A-12: it promised to commit if asked, and can no longer decide alone.",
          "inventory gravou a mudança e um registro 'prepared' e agora segura o lock da linha A-12: prometeu confirmar se pedirem, e não pode mais decidir sozinho."] : null }));
    }
    if (fail === "crash") {
      p.push(S(0, 0, "coordinator crashes before deciding", "o coordenador cai antes de decidir", 5, { set: { 0: "DOWN" }, crash: true, tone: "bad", log: ["coordinator crashed: no decision logged", "coordenador caiu: nenhuma decisão no log", "bad"],
        note: ["Every participant voted YES and is now in doubt: it cannot commit (maybe someone voted NO) nor abort (maybe the decision was COMMIT). Locks stay held; fans asking for A-12 wait.",
          "Todos votaram SIM e agora estão em dúvida: não podem confirmar (talvez alguém tenha votado NÃO) nem abortar (talvez a decisão tenha sido COMMIT). Os locks ficam presos; fãs que pedem A-12 esperam."] }));
      return p;
    }
    p.push(S(0, 0, "all YES: write COMMIT to the coordinator log", "todos SIM: gravar COMMIT no log do coordenador", 5, { log: ["decision: COMMIT", "decisão: COMMIT", "ok"] }));
    p.push(S(0, 1, "COMMIT PREPARED", "COMMIT PREPARED", 20, { set: { 1: "A-12 SOLD" }, locks: { 1: false } }));
    p.push(S(0, 2, "COMMIT PREPARED", "COMMIT PREPARED", 20, { set: { 2: "CHARGED R$ 450" }, locks: { 2: false } }));
    p.push(S(0, 3, "COMMIT PREPARED", "COMMIT PREPARED", 20, { set: { 3: "T-5521 ISSUED" }, locks: { 3: false } }));
    p.push(S(0, 0, "order 981 CONFIRMED", "pedido 981 CONFIRMED", 5, { set: { 0: "981 CONFIRMED" }, outcome: "committed", tone: "ok", log: ["all committed", "todos confirmaram", "ok"] }));
    return p;
  }

  /* recovery after a coordinator crash: no decision in its log → presumed abort */
  function recoveryPlan() {
    return [
      S(0, 0, "coordinator restarts: no decision in its log → ABORT", "coordenador volta: nenhuma decisão no log → ABORT", 5, { set: { 0: "tx 981 ABORTING" }, log: ["recovered: presumed abort", "recuperado: aborto presumido", "warn"],
        note: ["Back up, the coordinator finds no decision in its log, so it aborts (presumed abort) and frees the participants.", "De volta, o coordenador não encontra decisão no log, então aborta (aborto presumido) e libera os participantes."] }),
      S(0, 1, "ROLLBACK PREPARED", "ROLLBACK PREPARED", 20, { set: { 1: "A-12 HELD" }, locks: { 1: false } }),
      S(0, 2, "ROLLBACK PREPARED", "ROLLBACK PREPARED", 20, { set: { 2: "—" }, locks: { 2: false } }),
      S(0, 3, "ROLLBACK PREPARED", "ROLLBACK PREPARED", 20, { set: { 3: "—" }, locks: { 3: false } }),
      S(0, 0, "order 981 CANCELLED", "pedido 981 CANCELLED", 5, { set: { 0: "981 CANCELLED" }, outcome: "aborted", tone: "warn" })
    ];
  }

  function create(mode, fail) {
    mode = mode === "2pc" ? "2pc" : "saga";
    if (FAILS[mode].indexOf(fail) < 0) fail = "none";
    return { mode: mode, fail: fail, steps: mode === "saga" ? sagaPlan(fail) : tpcPlan(fail), i: 0, now: 0,
      svc: ["—", "A-12 HELD", "—", "—"], locks: [false, false, false, false], log: [], lockMs: 0, waiting: 0,
      down: false, recovered: false, outcome: null, last: null };
  }
  function anyLock(st) { return st.locks.some(Boolean); }

  /* one tick: the next step, or (coordinator down) one second in doubt; false when finished */
  function step(st) {
    if (st.i >= st.steps.length) {
      if (!st.down) return false;
      st.now += 1000; st.lockMs += 1000; st.waiting++;
      st.last = { from: 1, to: 1, en: "in doubt, A-12 locked: a fan waits", pt: "em dúvida, A-12 travado: um fã espera", wait: true, tone: "bad" };
      return true;
    }
    var x = st.steps[st.i++];
    if (anyLock(st)) st.lockMs += x.dt;
    st.now += x.dt;
    Object.keys(x.set).forEach(function (k) { st.svc[k] = x.set[k]; });
    Object.keys(x.locks).forEach(function (k) { st.locks[k] = x.locks[k]; });
    if (x.log) st.log.push(x.log);
    if (x.crash) st.down = true;
    if (x.outcome) st.outcome = x.outcome;
    st.last = x;
    return true;
  }
  function recover(st) {
    if (!st.down || st.i < st.steps.length) return false;
    st.down = false; st.recovered = true;
    st.steps = st.steps.concat(recoveryPlan());
    return true;
  }
  /* rebuild the state after k ticks (for the previous-step button) */
  function replay(mode, fail, k, recoverAt) {
    var st = create(mode, fail);
    for (var n = 0; n < k; n++) { if (recoverAt === n) recover(st); step(st); }
    if (recoverAt === k) recover(st);
    return st;
  }
  function finished(st) { return st.i >= st.steps.length && !st.down; }

  var API = { SVC: SVC, FAILS: FAILS, create: create, step: step, recover: recover, replay: replay, finished: finished, anyLock: anyLock };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var BX = [16, 162, 308, 454], BY = 120, BW = 130, BH = 66;
  var FAIL_LABEL = {
    none: ["none", "nenhuma"], reserve: ["reserve", "reserva"], declined: ["charge declined", "cobrança recusada"],
    timeout: ["charge timeout", "timeout na cobrança"], ticket: ["ticket down", "ticket fora"],
    "vote-no": ["a NO vote", "um voto NÃO"], crash: ["coordinator crash", "queda do coordenador"]
  };
  var OUT = {
    committed: [["all done", "tudo feito"], "ok"], compensated: [["compensated", "compensado"], "warn"], refunded: [["refunded", "estornado"], "warn"],
    aborted: [["aborted", "abortado"], "warn"]
  };

  C.style("saga", [
    ".md-typeset .csim-sg-arc { fill: none; stroke: var(--c-accent); stroke-width: 1.8; }",
    ".md-typeset .csim-sg-arc.back { stroke: var(--c-fg2); }",
    ".md-typeset .csim-sg-arc.bad { stroke: var(--c-bad); }",
    ".md-typeset .csim-sg-arc.warn { stroke: var(--c-warn); }",
    ".md-typeset .csim-sg-arc.ok { stroke: var(--c-ok); }",
    ".md-typeset .csim-sg-state { font-family: var(--md-code-font-family); font-size: 10.5px; font-weight: 700; }",
    ".md-typeset .csim-sg-lock { fill: var(--c-bad); }",
    ".md-typeset .csim-sg-shackle { fill: none; stroke: var(--c-bad); stroke-width: 1.5; }",
    ".md-typeset .csim-sg-lock-t { fill: var(--c-bad); font-size: 9px; font-weight: 700; }",
    ".md-typeset .csim-sg-cols { display: flex; flex-wrap: wrap; gap: .8rem; }",
    ".md-typeset .csim-sg-cols > * { flex: 1 1 14rem; min-width: 0; }"
  ].join("\n"));

  C.register("saga", function (root) {
    var o = C.opts(root, { mode: "saga", fail: "declined" });
    var st, recoverAt = null;
    var svg = s("svg", { viewBox: "0 0 600 210", role: "img", "aria-label": t("Checkout across four services", "Checkout em quatro serviços") });
    var note = el("p", { class: "csim-note" });
    var log = C.log(12);
    var stt = C.stats([
      { key: "time", label: t("checkout time", "tempo do checkout") },
      { key: "lock", label: t("time holding DB locks", "tempo segurando locks") },
      { key: "wait", label: t("fans waiting on A-12", "fãs esperando A-12") },
      { key: "out", label: t("outcome", "resultado") }
    ]);
    var failWrap = el("span");
    var failCtl;
    var mode = C.choice({
      label: t("Protocol", "Protocolo"), value: o.mode === "2pc" ? "2pc" : "saga",
      options: [{ value: "saga", label: t("saga (orchestrated)", "saga (orquestrada)") }, { value: "2pc", label: "2PC" }],
      onChange: function (v) { buildFail(v, v === "saga" ? "declined" : "crash"); start(); }
    });
    var bRecover = C.button(t("restart the coordinator", "reiniciar o coordenador"), function () {
      if (recover(st)) { recoverAt = bar.count(); say(t("Restarting the coordinator…", "Reiniciando o coordenador…"), ""); draw(); if (!bar.running()) bar.play(); }
    }, { tone: "ok" });

    function buildFail(m, value) {
      failCtl = C.choice({ label: t("Failure", "Falha"), value: value,
        options: FAILS[m].map(function (f) { return { value: f, label: t(FAIL_LABEL[f][0], FAIL_LABEL[f][1]) }; }),
        onChange: function () { start(); } });
      C.clear(failWrap).appendChild(failCtl);
    }

    var bar = C.player({ interval: 900,
      onTick: function () { var more = step(st); if (more && st.last.log) addLog(st.last.log); draw(); return more; },
      onPrev: function (k) { st = replay(mode.get(), failCtl.get(), k, recoverAt !== null && recoverAt <= k ? recoverAt : null); if (recoverAt !== null && recoverAt > k) recoverAt = null; rebuildLog(); draw(); },
      onReset: function () { start(); } });

    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    function addLog(x) { log.add(t(x[0], x[1]), x[2]); }
    function rebuildLog() { log.clear(); st.log.forEach(addLog); }

    function start() {
      st = create(mode.get(), failCtl.get()); recoverAt = null;
      log.clear();
      say(st.mode === "saga"
        ? t("Seat A-12 is HELD for the fan, who taps Pay R$ 450. Press play: order orchestrates the saga, one local transaction per service.",
          "O assento A-12 está HELD para o fã, que toca em Pagar R$ 450. Aperte play: order orquestra a saga, uma transação local por serviço.")
        : t("The same checkout with two-phase commit: order is the coordinator; inventory, payment and ticket prepare and vote. (A real card provider would never join a 2PC: here payment is BoxOffice's own ledger.)",
          "O mesmo checkout com two-phase commit: order é o coordenador; inventory, payment e ticket preparam e votam. (Um provedor de cartão real nunca entraria num 2PC: aqui payment é o razão do próprio BoxOffice.)"), "");
      draw();
    }

    function boxTone(k) {
      if (k === 0 && st.down) return "down";
      if (st.locks[k]) return "bad";
      var v = st.svc[k];
      if (/CANCELLED|FREE|REFUNDED|DECLINED|ABORT|DOWN/.test(v)) return "warn";
      if (/CONFIRMED|SOLD|CHARGED|ISSUED/.test(v)) return "ok";
      return v === "—" ? "" : "on";
    }

    function draw() {
      C.clear(svg);
      var names = st.mode === "saga" ? ["order · " + t("orchestrator", "orquestrador"), "inventory", "payment", "ticket"]
        : ["order · " + t("coordinator", "coordenador"), "inventory", "payment", "ticket"];
      for (var k = 0; k < 4; k++) {
        svg.appendChild(s("rect", { x: BX[k], y: BY, width: BW, height: BH, rx: 8, class: "c-box " + boxTone(k) }));
        svg.appendChild(s("text", { x: BX[k] + BW / 2, y: BY + 17, "text-anchor": "middle", class: "c-small" }, names[k]));
        svg.appendChild(s("text", { x: BX[k] + BW / 2, y: BY + 38, "text-anchor": "middle", class: "csim-sg-state" }, k === 0 && st.down ? "DOWN" : st.svc[k]));
        if (st.locks[k]) {
          var lx = BX[k] + BW / 2 - 26, ly = BY + 48;
          svg.appendChild(s("rect", { x: lx, y: ly + 3, width: 9, height: 7, rx: 1, class: "csim-sg-lock" }));
          svg.appendChild(s("path", { d: "M" + (lx + 2) + "," + (ly + 3) + " v-2 a2.5,2.5 0 0 1 5,0 v2", class: "csim-sg-shackle" }));
          svg.appendChild(s("text", { x: lx + 14, y: ly + 10, class: "csim-sg-lock-t" }, t("row locked", "linha travada")));
        }
      }
      /* the current message: an arc above the boxes, from → to */
      var x = st.last;
      if (x) {
        var cx = function (k) { return BX[k] + BW / 2; };
        var cls = "csim-sg-arc " + (x.tone || (x.from > x.to ? "back" : ""));
        if (x.from === x.to) {
          var c0 = cx(x.from);
          svg.appendChild(s("path", { d: "M" + (c0 - 22) + "," + BY + " C" + (c0 - 22) + "," + (BY - 34) + " " + (c0 + 22) + "," + (BY - 34) + " " + (c0 + 22) + "," + BY, class: cls }));
          svg.appendChild(s("circle", { cx: c0 + 22, cy: BY - 2, r: 4.5, class: "c-dot " + (x.tone === "bad" ? "bad" : x.tone === "ok" ? "ok" : "") }));
        } else {
          var a = cx(x.from), b = cx(x.to), h = 30 + Math.abs(x.to - x.from) * 18;
          svg.appendChild(s("path", { d: "M" + a + "," + BY + " C" + a + "," + (BY - h) + " " + b + "," + (BY - h) + " " + b + "," + BY, class: cls }));
          svg.appendChild(s("circle", { cx: b, cy: BY - 2, r: 4.5, class: "c-dot " + (x.tone === "bad" ? "bad" : x.tone === "ok" ? "ok" : x.from > x.to ? "mute" : "") }));
        }
        svg.appendChild(s("text", { x: 300, y: 22, "text-anchor": "middle", class: "c-label" + (x.tone ? " c-" + x.tone : "") }, t(x.en, x.pt)));
        if (x.note) say(t(x.note[0], x.note[1]), x.tone);
        else if (x.wait) say(t("In doubt for " + st.waiting + " s: seat A-12 is locked in inventory and " + st.waiting + " fan request(s) are queued behind the lock. Only the coordinator can end this.",
          "Em dúvida há " + st.waiting + " s: o assento A-12 está travado no inventory e " + st.waiting + " pedido(s) de fãs estão na fila atrás do lock. Só o coordenador pode encerrar isso."), "bad");
        else if (x.outcome) say(outcomeText(), OUT[x.outcome][1]);
      }
      svg.appendChild(s("text", { x: 300, y: 204, "text-anchor": "middle", class: "c-small" }, "seat A-12 · order 981 · R$ 450"));
      stt.set("time", (st.now / 1000).toFixed(st.now < 1000 ? 2 : 1).replace(".", C.PT ? "," : ".") + " s", st.now > 4000 ? "warn" : "");
      stt.set("lock", st.lockMs < 1000 ? st.lockMs + " ms" : (st.lockMs / 1000).toFixed(1).replace(".", C.PT ? "," : ".") + " s", st.lockMs === 0 ? "ok" : st.lockMs > 1000 ? "bad" : "warn");
      stt.set("wait", String(st.waiting), st.waiting ? "bad" : "ok");
      var out = st.down && st.i >= st.steps.length ? [[t("blocked", "bloqueado"), "bad"]] : null;
      if (out) stt.set("out", out[0][0], "bad");
      else if (st.outcome) stt.set("out", t(OUT[st.outcome][0][0], OUT[st.outcome][0][1]), OUT[st.outcome][1]);
      else stt.set("out", t("in progress", "em andamento"), "");
      bRecover.disabled = !(st.down && st.i >= st.steps.length);
      bRecover.style.display = st.mode === "2pc" ? "" : "none";
    }

    function outcomeText() {
      if (st.mode === "2pc") return st.outcome === "committed"
        ? t("Committed everywhere, atomically and isolated — but the seat row was locked for " + st.lockMs + " ms, waiting on the slowest participant.",
          "Confirmado em todos, de forma atômica e isolada — mas a linha do assento ficou travada por " + st.lockMs + " ms, esperando o participante mais lento.")
        : t("Aborted everywhere: all or nothing holds. The locks were held for " + (st.lockMs / 1000).toFixed(1) + " s" + (st.recovered ? ", most of it waiting for the coordinator to come back." : "."),
          "Abortado em todos: o tudo-ou-nada se mantém. Os locks ficaram presos por " + (st.lockMs / 1000).toFixed(1).replace(".", ",") + " s" + (st.recovered ? ", quase todo o tempo esperando o coordenador voltar." : "."));
      if (st.outcome === "committed") return t("Only local transactions, no lock held across services. In between, others saw intermediate states (PENDING, RESERVED): sagas give up isolation.",
        "Só transações locais, nenhum lock entre serviços. No meio do caminho, outros viram estados intermediários (PENDING, RESERVED): sagas abrem mão do isolamento.");
      return t("The saga ended consistent by compensation, not by rollback: the saga log shows each undo, in reverse order. The fan saw a 'payment failed' message, never a sold seat without payment.",
        "A saga terminou consistente por compensação, não por rollback: o log da saga mostra cada desfazer, em ordem inversa. O fã viu 'pagamento falhou', nunca um assento vendido sem pagamento.");
    }

    buildFail(mode.get(), FAILS[mode.get()].indexOf(o.fail) >= 0 ? o.fail : mode.get() === "saga" ? "declined" : "crash");
    C.add(root, [
      el("p", { class: "csim-title", text: t("Saga or 2PC: what happens when the checkout fails halfway?", "Saga ou 2PC: o que acontece quando o checkout falha no meio?") }),
      el("p", { class: "csim-sub", text: t("Pick the protocol and where it fails, then play. Each box is a service's own database; red means a row lock is held.",
        "Escolha o protocolo e onde falha, depois aperte play. Cada caixa é o banco de um serviço; vermelho indica um lock de linha preso.") }),
      el("div", { class: "csim-row" }, [mode, failWrap, bRecover]),
      el("div", { class: "csim-stage" }, svg),
      stt,
      note,
      el("div", { class: "csim-sg-cols" }, [el("div", {}, [el("span", { class: "csim-lbl", text: t("Saga / coordinator log", "Log da saga / do coordenador") }), log])]),
      bar
    ]);
    start();
    return { destroy: function () { bar.pause(); } };
  });
})();
