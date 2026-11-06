/*
 * Delivery semantics: at-most-once, at-least-once, effectively-once (2027.1, class 9 — delivery semantics):
 *
 *   <div class="csim" data-sim="delivery" data-commit="after" data-crash="charge" data-at="2"></div>
 *
 * The payment consumer reads "charge order N" records from a partition. For each record it polls,
 * then either commits the offset and charges (at-most-once) or charges and commits (at-least-once).
 * A crash right after the charge or right after the commit, on record `at`, restarts the consumer
 * from the committed offset. With the idempotency switch, the charge and the row in
 * processed_events commit in one transaction, and a redelivered record is skipped.
 * data-commit: before | after; data-crash: none | charge | commit; data-idem: on | off.
 */
(function () {
  "use strict";

  var AMOUNTS = [180, 95, 240, 120, 60, 310];

  /*
   * The whole run as a list of steps (each a snapshot), so the player can go back and forth.
   * plan: {commit: "before"|"after", crash: "none"|"charge"|"commit", at: offset, idem: bool, n: records}
   */
  function run(plan) {
    var n = plan.n || 6, ops = plan.commit === "before" ? ["commit", "charge"] : ["charge", "commit"];
    var committed = 0, pos = 0, charges = [], processed = [], crashed = false, steps = [];
    for (var i = 0; i < n; i++) { charges.push(0); processed.push(false); }
    function snap(kind, offset, alive) {
      var lost = 0, twice = 0;
      for (var k = 0; k < n; k++) {
        if (k < committed && charges[k] === 0 && !(alive && k === offset)) lost++;
        if (charges[k] > 1) twice++;
      }
      steps.push({ kind: kind, offset: offset, committed: committed, alive: alive,
        charges: charges.slice(), processed: processed.slice(), lost: lost, twice: twice });
    }
    var guard = 0;
    while (pos < n && guard++ < 4 * n) {
      snap("poll", pos, true);
      var crash = false;
      for (var j = 0; j < 2; j++) {
        if (ops[j] === "commit") { committed = pos + 1; snap("commit", pos, true); }
        else if (plan.idem && processed[pos]) snap("skip", pos, true);
        else { charges[pos]++; processed[pos] = true; snap("charge", pos, true); }
        if (!crashed && pos === plan.at && plan.crash === ops[j]) { crash = true; break; }
      }
      if (crash) {
        crashed = true;
        snap("crash", pos, false);
        pos = committed;
        snap("restart", pos, true);
      } else pos++;
    }
    snap("done", n, true);
    return steps;
  }

  /* the end result of a plan: lost records, orders charged twice, total charges */
  function outcome(plan) {
    var last = run(plan).slice(-1)[0];
    return { lost: last.lost, twice: last.twice, charges: last.charges.reduce(function (a, b) { return a + b; }, 0) };
  }

  var API = { run: run, outcome: outcome, AMOUNTS: AMOUNTS };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var W = 92, X0 = 46;

  C.style("delivery", [
    ".md-typeset .csim-dl-cons { transition: transform .35s ease; }",
    ".md-typeset .csim-dl-arrow { stroke: var(--c-ink); stroke-width: 1.6; fill: none; marker-end: url(#csim-dl-tip); }",
    ".md-typeset .csim-dl-tip { fill: var(--c-ink); }",
    ".md-typeset .csim-dl-commit { fill: var(--c-ink); }",
    ".md-typeset .csim-dl-boom { animation: csim-pulse .6s ease-in-out 3; }"
  ].join("\n"));

  C.register("delivery", function (root) {
    var o = C.opts(root, { commit: "after", crash: "charge", at: 2, idem: false });
    var plan = { commit: o.commit, crash: o.crash, at: o.at, idem: o.idem, n: AMOUNTS.length };
    var steps = [], i = 0;
    var svg = s("svg", { viewBox: "0 0 640 270", role: "img", "aria-label": t("Consumer, log and charges", "Consumidor, log e cobranças") });
    var note = el("p", { class: "csim-note" });
    var lg = C.log(7);
    var st = C.stats([
      { key: "lost", label: t("orders never charged (lost)", "pedidos nunca cobrados (perdidos)") },
      { key: "twice", label: t("customers charged twice", "clientes cobrados duas vezes") },
      { key: "charges", label: t("charges made", "cobranças feitas") },
      { key: "off", label: t("committed offset", "offset confirmado") }
    ]);
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    function order(k) { return "o-" + (1001 + k); }
    function money(k) { return "R$ " + AMOUNTS[k]; }
    function cx(k) { return X0 + k * W + W / 2; }

    function describe(step) {
      var k = step.offset;
      switch (step.kind) {
        case "poll": return [t("poll offset " + k + ": charge " + order(k), "poll do offset " + k + ": cobrar " + order(k)), ""];
        case "commit": return [t("commit offset " + step.committed + " (\"done up to " + k + "\")", "commit do offset " + step.committed + " (\"pronto até o " + k + "\")"), "info"];
        case "charge": return [t("charge " + order(k) + " " + money(k) + (step.charges[k] > 1 ? " — AGAIN" : ""), "cobrar " + order(k) + " " + money(k) + (step.charges[k] > 1 ? " — DE NOVO" : "")), step.charges[k] > 1 ? "bad" : "ok"];
        case "skip": return [t(order(k) + " already in processed_events: skip", order(k) + " já está em processed_events: pula"), "ok"];
        case "crash": return [t("✗ consumer crashes (deploy, OOM kill…)", "✗ o consumidor cai (deploy, OOM kill…)"), "bad"];
        case "restart": return [t("restart: resume from committed offset " + step.committed, "reinício: retoma do offset confirmado " + step.committed), "warn"];
        default: return [t("end of the partition", "fim da partição"), ""];
      }
    }

    function status(step) {
      return { poll: t("polling ", "lendo ") + order(step.offset), commit: t("committing ", "commit ") + step.committed,
        charge: t("charging ", "cobrando ") + order(step.offset), skip: t("skipping duplicate", "pulando duplicata"),
        crash: t("process killed", "processo morto"), restart: t("starting at offset ", "começando no offset ") + step.committed }[step.kind] || "";
    }

    function finalNote(step) {
      if (step.lost) return [t("Lost: " + order(plan.at) + " was committed, then the consumer died before charging. On restart it resumed after it — nobody will ever charge that order. That is at-most-once: commit first, and a crash loses the record." + (plan.idem ? " The idempotency key cannot help: it removes repeats, not losses." : ""),
        "Perdido: o " + order(plan.at) + " foi confirmado e o consumidor morreu antes de cobrar. No reinício ele retomou depois dele — ninguém vai cobrar esse pedido. Isso é at-most-once: commit primeiro, e uma queda perde o registro." + (plan.idem ? " A chave de idempotência não ajuda: ela elimina repetições, não perdas." : "")), "bad"];
      if (step.twice) return [t("Charged twice: " + order(plan.at) + " was charged, the consumer died before committing, and the restart read the record again. That is at-least-once: nothing is lost, but the customer pays " + money(plan.at) + " twice. Turn on the idempotency key.",
        "Cobrado duas vezes: o " + order(plan.at) + " foi cobrado, o consumidor morreu antes do commit e o reinício leu o registro de novo. Isso é at-least-once: nada se perde, mas o cliente paga " + money(plan.at) + " duas vezes. Ligue a chave de idempotência."), "bad"];
      if (plan.crash !== "none" && plan.idem && plan.commit === "after") return [t("Effectively-once: the record was delivered twice, but the second time processed_events already had it, so the charge was skipped. At-least-once delivery + idempotent processing.",
        "Efetivamente uma vez: o registro foi entregue duas vezes, mas na segunda processed_events já o tinha, e a cobrança foi pulada. Entrega at-least-once + processamento idempotente."), "ok"];
      if (plan.crash !== "none") return [t("This crash happened at a harmless point for this order of steps: the record was both charged and committed. Try the other crash point.",
        "Esta queda aconteceu num ponto inofensivo para essa ordem de passos: o registro foi cobrado e confirmado. Experimente o outro ponto de queda."), "ok"];
      return [t("No crash: every strategy charges each order once. The difference only shows up when the consumer dies between the two steps.",
        "Sem queda: toda estratégia cobra cada pedido uma vez. A diferença só aparece quando o consumidor morre entre os dois passos."), ""];
    }

    function draw() {
      var step = steps[i], n = plan.n;
      C.clear(svg);
      var defs = s("defs");
      var mk = s("marker", { id: "csim-dl-tip", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto" });
      mk.appendChild(s("path", { d: "M0,0 L10,5 L0,10 z", class: "csim-dl-tip" }));
      defs.appendChild(mk); svg.appendChild(defs);
      svg.appendChild(s("text", { x: 4, y: 14, class: "c-small" }, t("Kafka · partition 0 of payment-requests", "Kafka · partição 0 de payment-requests")));
      svg.appendChild(s("text", { x: 4, y: 214, class: "c-small" }, t("payment provider · charges per order", "provedor de pagamento · cobranças por pedido")));
      for (var k = 0; k < n; k++) {
        var x = X0 + k * W;
        svg.appendChild(s("rect", { x: x + 3, y: 22, width: W - 6, height: 42, rx: 5, class: "c-box" + (k < step.committed ? " on" : "") }));
        svg.appendChild(s("text", { x: x + W / 2, y: 38, "text-anchor": "middle", class: "c-small" }, "offset " + k));
        svg.appendChild(s("text", { x: x + W / 2, y: 54, "text-anchor": "middle", class: "c-mono" }, order(k)));
        var c = step.charges[k], lost = k < step.committed && c === 0 && !(step.alive && k === step.offset);
        var tone = c > 1 ? " bad" : c === 1 ? " ok" : lost ? " bad" : "";
        svg.appendChild(s("rect", { x: x + 3, y: 220, width: W - 6, height: 34, rx: 5, class: "c-box" + tone + (lost ? " down" : "") }));
        svg.appendChild(s("text", { x: x + W / 2, y: 235, "text-anchor": "middle", class: "c-mono" + (c > 1 || lost ? " c-bad" : "") },
          c ? c + " × " + money(k) : lost ? t("LOST", "PERDIDO") : "–"));
        if (plan.idem) svg.appendChild(s("text", { x: x + W / 2, y: 249, "text-anchor": "middle", class: "c-small" }, step.processed[k] ? "processed ✓" : ""));
      }
      if (plan.idem) svg.appendChild(s("text", { x: 636, y: 214, "text-anchor": "end", class: "c-small" }, "+ processed_events"));
      /* committed offset: a marker under the log at the boundary */
      var bx = X0 + step.committed * W;
      svg.appendChild(s("path", { d: "M" + bx + ",68 l-6,9 h12 z", class: "csim-dl-commit" }));
      svg.appendChild(s("text", { x: bx, y: 89, "text-anchor": "middle", class: "c-label c-ink" }, t("committed = ", "confirmado = ") + step.committed));
      /* the consumer, under the record it is working on */
      if (step.kind !== "done") {
        var g = s("g", { class: "csim-dl-cons", transform: "translate(" + (cx(Math.min(step.offset, n - 1)) - 60) + ",0)" });
        g.appendChild(s("rect", { x: -10, y: 118, width: 140, height: 44, rx: 6, class: step.alive ? "c-box hot" : "c-box bad csim-dl-boom" }));
        g.appendChild(s("text", { x: 60, y: 135, "text-anchor": "middle", class: "c-label" }, step.alive ? t("payment consumer", "consumidor payment") : t("✗ crashed", "✗ caiu")));
        g.appendChild(s("text", { x: 60, y: 152, "text-anchor": "middle", class: "c-small" }, status(step)));
        svg.appendChild(g);
        var ax = cx(Math.min(step.offset, n - 1));
        if (step.kind === "poll") svg.appendChild(s("path", { class: "csim-dl-arrow", d: "M" + ax + ",66 V116" }));
        if (step.kind === "commit") svg.appendChild(s("path", { class: "csim-dl-arrow", d: "M" + (ax + 30) + ",116 V96" }));
        if (step.kind === "charge" || step.kind === "skip") svg.appendChild(s("path", { class: "csim-dl-arrow" + (step.kind === "skip" ? " dashed" : ""), d: "M" + ax + ",164 V218" }));
      }
      st.set("lost", String(step.lost), step.lost ? "bad" : "ok");
      st.set("twice", String(step.twice), step.twice ? "bad" : "ok");
      st.set("charges", step.charges.reduce(function (a, b) { return a + b; }, 0) + " / " + n, "");
      st.set("off", String(step.committed), "info");
      var d = describe(step);
      if (step.kind === "done") { var f = finalNote(step); say(f[0], f[1]); }
      else if (step.kind === "crash") say(plan.commit === "before" && plan.crash === "commit"
        ? t("The offset says " + order(step.offset) + " is done, but it was never charged…", "O offset diz que o " + order(step.offset) + " está pronto, mas ele nunca foi cobrado…")
        : plan.commit === "after" && plan.crash === "charge"
          ? t(order(step.offset) + " was charged, but the commit never happened: Kafka still thinks it is unread…", "O " + order(step.offset) + " foi cobrado, mas o commit não aconteceu: o Kafka ainda o considera não lido…")
          : t("Crash — but both steps of this record were already done.", "Queda — mas os dois passos deste registro já tinham sido feitos."), "bad");
      else if (step.kind === "restart") say(t("A new instance joins and asks Kafka for the committed offset: " + step.committed + ". Everything before it is considered done; everything from it on is read again.",
        "Uma nova instância entra e pede ao Kafka o offset confirmado: " + step.committed + ". Tudo antes dele é considerado pronto; tudo a partir dele é lido de novo."), "warn");
      else if (step.kind === "charge" && step.charges[step.offset] > 1) say(t("Redelivered, and the consumer has no memory of the first time: " + order(step.offset) + " is charged " + money(step.offset) + " again.",
        "Reentregue, e o consumidor não lembra da primeira vez: o " + order(step.offset) + " é cobrado " + money(step.offset) + " de novo."), "bad");
      else if (step.kind === "skip") say(t("Redelivered, but INSERT INTO processed_events finds the event id already there (it was committed with the first charge): the charge is skipped.",
        "Reentregue, mas o INSERT INTO processed_events encontra o id do evento (gravado junto com a primeira cobrança): a cobrança é pulada."), "ok");
      else say(d[0], d[1] === "info" ? "" : d[1]);
      player.refresh();
    }

    function rebuild() {
      steps = run(plan); i = 0;
      player.total(steps.length - 1);
      player.jump(0);
      lg.clear();
      lg.add(describe(steps[0])[0], "");
      draw();
      say(t("Strategy: " + (plan.commit === "before" ? "commit, then charge (at-most-once)" : "charge, then commit (at-least-once)") +
        (plan.crash === "none" ? "; no crash." : "; the consumer will crash right after the " + (plan.crash === "charge" ? "charge" : "commit") + " of " + order(plan.at) + ".") + " Press play.",
        "Estratégia: " + (plan.commit === "before" ? "commit, depois cobra (at-most-once)" : "cobra, depois commit (at-least-once)") +
        (plan.crash === "none" ? "; sem queda." : "; o consumidor vai cair logo depois " + (plan.crash === "charge" ? "da cobrança" : "do commit") + " do " + order(plan.at) + ".") + " Dê play."), "");
    }

    var cMode = C.choice({ label: t("Consumer", "Consumidor"), value: plan.commit, options: [
      { value: "before", label: t("commit → charge", "commit → cobra"), title: "at-most-once" },
      { value: "after", label: t("charge → commit", "cobra → commit"), title: "at-least-once" }],
      onChange: function (v) { plan.commit = v; rebuild(); } });
    var cCrash = C.choice({ label: t("Crash on " + order(plan.at), "Queda no " + order(plan.at)), value: plan.crash, options: [
      { value: "none", label: t("none", "nenhuma") },
      { value: "charge", label: t("after the charge", "após a cobrança") },
      { value: "commit", label: t("after the commit", "após o commit") }],
      onChange: function (v) { plan.crash = v; rebuild(); } });
    var tIdem = C.toggle({ label: t("idempotency key (processed_events)", "chave de idempotência (processed_events)"), checked: plan.idem,
      onChange: function (v) { plan.idem = v; rebuild(); } });

    var player = C.player({ interval: 900,
      label: function (c, n) { return t("step ", "passo ") + c + "/" + n; },
      onTick: function (c) { i = c; var d = describe(steps[i]); lg.add(d[0], d[1]); draw(); if (i >= steps.length - 1) return false; },
      onPrev: function (c) { i = c; draw(); },
      onReset: function () { i = 0; lg.clear(); lg.add(describe(steps[0])[0], ""); draw(); } });

    C.add(root, [
      el("p", { class: "csim-title", text: t("Delivery semantics: does a crash lose the charge or repeat it?", "Semântica de entrega: uma queda perde a cobrança ou a repete?") }),
      el("p", { class: "csim-sub", text: t("The payment consumer reads one record per order and charges the card. Choose the order of its two steps, where it crashes, and whether it deduplicates.",
        "O consumidor payment lê um registro por pedido e cobra o cartão. Escolha a ordem dos dois passos, onde ele cai e se ele deduplica.") }),
      el("div", { class: "csim-row" }, [cMode, cCrash, tIdem]),
      el("div", { class: "csim-stage" }, svg),
      st,
      lg,
      note,
      player
    ]);
    rebuild();
    return { destroy: function () { player.pause(); } };
  });
})();
