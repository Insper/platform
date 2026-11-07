/*
 * Quizzes (2026.2, 2027.1 and the appendix): turns the quiz pages' Markdown into compact quiz boxes.
 *
 * The source stays plain Markdown, readable without JavaScript:
 *
 *   ## Section title
 *
 *   **Q1.** Question text (more paragraphs, code or tables may follow)
 *
 *   - A. option
 *   - B. option
 *
 *   ??? success "Answer"          (pt: "Resposta")
 *       **B — short answer.**
 *
 *       Explanation.
 *
 * Each `##` section becomes one box (the layout of the AI course's quizzes): a header with the section
 * title and the count of answered questions; one row per question, its number in its own column, which
 * turns green, red or amber (unanswered) after Check; options as radio rows with a lettered circle, very
 * short options four per row, short ones two, long ones one; the explanations open after Check, the score
 * replaces the count. A question without options is an open one: it shows its answer after Check and does
 * not count in the score. Choices and checked boxes are remembered in this browser (localStorage,
 * optional). Colors: assets/stylesheets/quiz.css (the page theme; status colors as the simulators').
 */
(function () {
  "use strict";

  var PT = (document.documentElement.lang || "").indexOf("pt") === 0;
  var T = PT
    ? { tag: "Quiz", answered: function (a, n) { return a + " de " + n + (n === 1 ? " respondida" : " respondidas"); },
        hint: "Escolha uma opção por questão e depois clique em Verificar", check: "Verificar respostas", retry: "↺ Refazer",
        explanation: "Explicação:", answer: "Resposta:", great: "🎉 Excelente!", good: "👍 Bom trabalho!", review: "📚 Revise o conteúdo" }
    : { tag: "Quiz", answered: function (a, n) { return a + " of " + n + " answered"; },
        hint: "Pick one option per question, then press Check", check: "Check answers", retry: "↺ Retry",
        explanation: "Explanation:", answer: "Answer:", great: "🎉 Excellent!", good: "👍 Good job!", review: "📚 Review the material" };
  var SHORT = 48;   /* every option at most this long → two per row */
  var TINY = 22;    /* four options at most this long → four per row */

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { return {}; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode: no memory */ }
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function isAnswer(det) {
    var s = det.querySelector("summary");
    return det.classList.contains("success") && s && /^(Answer|Resposta)$/.test(s.textContent.trim());
  }

  /* one question: its nodes in the page, the options, the right letter and the explanation */
  function parse(det) {
    var ul = det.previousElementSibling;
    if (ul && ul.tagName !== "UL") ul = null;
    var parts = [], n = ul ? ul.previousElementSibling : det.previousElementSibling, qid = null;
    while (n && !/^(HR|H2|H3|DETAILS|UL)$/.test(n.tagName)) {
      parts.unshift(n);
      var m = n.tagName === "P" && n.textContent.trim().match(/^Q(\d+)[^.]{0,20}\./);
      if (m) { qid = m[1]; break; }
      n = n.previousElementSibling;
    }
    if (!qid) return null;
    var strong = det.querySelector("p strong");
    var right = strong && (strong.textContent.trim().match(/^([A-H])\b/) || [])[1];
    var opts = [];
    if (ul) {
      Array.prototype.forEach.call(ul.children, function (li) {
        var m = li.textContent.trim().match(/^([A-H])\.\s*/);
        if (m) opts.push({ letter: m[1], html: li.innerHTML.replace(/^\s*[A-H]\.\s*/, ""), len: li.textContent.trim().length - m[0].length });
      });
      if (!opts.length || !right) return null;
    }
    return { qid: qid, parts: parts, ul: ul, det: det, opts: opts, right: right };
  }

  function build(article) {
    var dets = Array.prototype.filter.call(article.querySelectorAll(":scope > details"), isAnswer);
    if (dets.length < 2) return;
    var qs = dets.map(parse).filter(Boolean);
    if (!qs.length) return;
    var key = "quiz2:" + location.pathname;
    var state = load(key);   /* { picks: {qid: letter}, checked: [box index] } */
    state.picks = state.picks || {};
    state.checked = state.checked || [];

    /* the "click Answer" line on top no longer applies */
    var intro = article.querySelector(":scope > p");
    if (intro && /Answer|Resposta/.test(intro.textContent) && intro.compareDocumentPosition(qs[0].parts[0]) & Node.DOCUMENT_POSITION_FOLLOWING) {
      var hr = intro.nextElementSibling;
      intro.remove();
      if (hr && hr.tagName === "HR") hr.remove();
    }

    /* group the questions by their section (the closest h2 before them) */
    var groups = [];
    qs.forEach(function (q) {
      var h = q.parts[0].previousElementSibling;
      while (h && h.tagName !== "H2") h = h.previousElementSibling;
      var g = groups[groups.length - 1];
      if (!g || g.h2 !== h) groups.push(g = { h2: h, qs: [] });
      g.qs.push(q);
    });

    groups.forEach(function (g, gi) {
      var box = el("div", "qz");
      g.qs[0].parts[0].parentNode.insertBefore(box, g.qs[0].parts[0]);
      var head = el("div", "qz-head");
      head.appendChild(el("span", "qz-tag", T.tag));
      if (g.h2) {
        g.h2.classList.add("qz-title");   /* the heading moves into the box: its id and permalink keep working */
        head.appendChild(g.h2);
      } else {
        var h1 = article.querySelector("h1");
        head.appendChild(el("span", "qz-title", h1 ? h1.textContent.replace(/¶$/, "").trim() : T.tag));
      }
      var count = el("span", "qz-count");
      head.appendChild(count);
      box.appendChild(head);

      var cards = [];
      g.qs.forEach(function (q) {
        var card = el("div", "qz-card" + (q.ul ? "" : " is-open"));
        card.id = "q" + q.qid;
        card.appendChild(el("span", "qz-n", q.qid));
        var body = el("div", "qz-body");
        var text = el("div", "qz-q");
        q.parts.forEach(function (p) { text.appendChild(p); });
        /* drop the "Qn." prefix: the number column shows it */
        var first = text.firstElementChild && text.firstElementChild.firstChild;
        if (first && first.nodeType === 1 && /^Q\d+[^.]{0,20}\.$/.test(first.textContent.trim())) {
          var after = first.nextSibling;
          first.remove();
          if (after && after.nodeType === 3) after.textContent = after.textContent.replace(/^\s+/, "");
        }
        body.appendChild(text);

        var inputs = [];
        if (q.ul) {
          var longest = Math.max.apply(null, q.opts.map(function (o) { return o.len; }));
          var grid = el("div", "qz-opts" + (q.opts.length === 4 && longest <= TINY ? " four" : longest <= SHORT ? " two" : ""));
          q.opts.forEach(function (o) {
            var label = el("label", "qz-opt");
            var input = document.createElement("input");
            input.type = "radio";
            input.name = "qz-" + gi + "-" + q.qid;
            input.value = o.letter;
            input.checked = state.picks[q.qid] === o.letter;
            input.addEventListener("change", function () { state.picks[q.qid] = o.letter; save(key, state); answered(); });
            var span = el("span", "qz-o");
            span.innerHTML = o.html;
            label.appendChild(input);
            label.appendChild(el("span", "qz-key", o.letter));
            label.appendChild(span);
            grid.appendChild(label);
            inputs.push({ label: label, input: input });
          });
          q.ul.remove();
          body.appendChild(grid);
        }

        var exp = el("div", "qz-exp");
        exp.appendChild(el("strong", "qz-exp-tag", q.ul ? T.explanation : T.answer));
        Array.prototype.slice.call(q.det.childNodes).forEach(function (c) {
          if (!(c.nodeType === 1 && c.tagName === "SUMMARY")) exp.appendChild(c);
        });
        q.det.remove();
        body.appendChild(exp);
        card.appendChild(body);
        box.appendChild(card);
        cards.push({ q: q, card: card, inputs: inputs });
      });
      var scored = cards.filter(function (c) { return c.q.ul; });
      var foot = el("div", "qz-foot");
      var check = el("button", "qz-btn primary", T.check);
      check.type = "button";
      check.title = T.hint;
      var retry = el("button", "qz-btn", T.retry);
      retry.type = "button";
      var result = el("div", "qz-result");
      foot.appendChild(check);
      foot.appendChild(retry);
      foot.appendChild(result);
      box.appendChild(foot);

      function answered() {
        if (box.classList.contains("locked")) return;
        var a = scored.filter(function (c) { return c.inputs.some(function (i) { return i.input.checked; }); }).length;
        count.textContent = T.answered(a, scored.length);
      }
      function verify(quiet) {
        var score = 0;
        check.disabled = true;
        box.classList.add("locked");
        cards.forEach(function (c) {
          if (!c.q.ul) { c.card.classList.add("is-shown"); return; }
          var sel = c.inputs.filter(function (i) { return i.input.checked; })[0];
          var chosen = sel ? sel.input.value : null;
          if (chosen === c.q.right) score++;
          c.inputs.forEach(function (i) {
            i.input.disabled = true;
            if (i.input.value === c.q.right) i.label.classList.add("is-ok");
            else if (i.input.value === chosen) i.label.classList.add("is-bad");
          });
          c.card.classList.add(chosen === c.q.right ? "is-ok" : chosen ? "is-bad" : "is-none", "is-shown");
        });
        var total = scored.length, pct = total ? Math.round(100 * score / total) : 100;
        var tone = pct >= 80 ? "ok" : pct >= 50 ? "warn" : "bad";
        count.className = "qz-count is-score is-" + tone;
        count.textContent = total ? score + "/" + total : "";
        result.className = "qz-result is-" + tone;
        result.textContent = total ? pct + "% — " + (pct >= 80 ? T.great : pct >= 50 ? T.good : T.review) : "";
        if (!quiet && state.checked.indexOf(gi) < 0) { state.checked.push(gi); save(key, state); }
      }
      check.addEventListener("click", function () { verify(false); });
      retry.addEventListener("click", function () {
        box.classList.remove("locked");
        cards.forEach(function (c) {
          c.card.classList.remove("is-ok", "is-bad", "is-none", "is-shown");
          c.inputs.forEach(function (i) {
            i.label.classList.remove("is-ok", "is-bad");
            i.input.checked = false;
            i.input.disabled = false;
            delete state.picks[c.q.qid];
          });
        });
        state.checked = state.checked.filter(function (x) { return x !== gi; });
        save(key, state);
        check.disabled = false;
        count.className = "qz-count";
        result.className = "qz-result";
        result.textContent = "";
        answered();
      });
      answered();
      if (state.checked.indexOf(gi) >= 0) verify(true);
    });
    article.classList.add("qz-page");
  }

  function init() {
    if (!/\/(2026\.2|2027\.1|appendix)\//.test(location.pathname)) return;
    var article = document.querySelector(".md-content article.md-typeset, .md-content .md-typeset");
    if (article && !article.classList.contains("qz-page")) build(article);
  }

  if (typeof document$ !== "undefined") document$.subscribe(init);
  else document.addEventListener("DOMContentLoaded", init);
})();
