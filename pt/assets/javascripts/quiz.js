/*
 * Quizzes (2027.1 and the appendix): turns the quiz pages' Markdown into compact question cards.
 *
 * The source stays plain Markdown, readable without JavaScript:
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
 * Each question becomes a card: the options are buttons; picking one marks it right or wrong, shows
 * the correct one and opens the explanation. A bar on top counts answered and correct questions,
 * and the choices are remembered in this browser (localStorage, optional). Colors: theme only
 * (assets/stylesheets/quiz.css).
 */
(function () {
  "use strict";

  var PT = (document.documentElement.lang || "").indexOf("pt") === 0;
  var T = PT
    ? { answered: "respondidas", correct: "certas", reset: "Recomeçar", show: "ver resposta", right: "Certo", wrong: "Não é essa", hint: "Escolha uma alternativa: a explicação aparece logo abaixo." }
    : { answered: "answered", correct: "correct", reset: "Start over", show: "show answer", right: "Correct", wrong: "Not this one", hint: "Pick an option: the explanation appears right below." };

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { return {}; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode: no memory */ }
  }

  function isAnswer(det) {
    var s = det.querySelector("summary");
    return det.classList.contains("success") && s && /^(Answer|Resposta)$/.test(s.textContent.trim());
  }

  function build(article) {
    var dets = Array.prototype.filter.call(article.querySelectorAll(":scope > details"), isAnswer);
    if (dets.length < 2) return;
    var key = "quiz:" + location.pathname;
    var state = load(key);
    var cards = [];

    dets.forEach(function (det) {
      var ul = det.previousElementSibling;
      if (!ul || ul.tagName !== "UL") return;
      /* the question: the paragraphs (and code, tables…) back to the one that starts with **Qn.** */
      var parts = [], n = ul.previousElementSibling, qid = null, label = null;
      while (n && !/^(HR|H2|H3|DETAILS|UL)$/.test(n.tagName)) {
        parts.unshift(n);
        var m = n.tagName === "P" && n.textContent.trim().match(/^(Q(\d+)[^.]{0,20})\./);
        if (m) { qid = m[2]; label = m[1]; break; }
        n = n.previousElementSibling;
      }
      if (!qid) return;
      var strong = det.querySelector("p strong");
      var right = strong && (strong.textContent.trim().match(/^([A-E])\b/) || [])[1];
      if (!right) return;

      var card = document.createElement("section");
      card.className = "qz-card";
      card.id = "q" + qid;
      ul.parentNode.insertBefore(card, parts[0]);
      var head = document.createElement("div");
      head.className = "qz-q";
      var badge = document.createElement("span");
      badge.className = "qz-n";
      badge.textContent = label;
      head.appendChild(badge);
      var body = document.createElement("div");
      body.className = "qz-text";
      parts.forEach(function (p) { body.appendChild(p); });
      /* drop the "Qn." prefix, the badge shows it */
      var first = body.firstElementChild && body.firstElementChild.firstChild;
      if (first && first.nodeType === 1 && /^Q\d+[^.]{0,20}\.$/.test(first.textContent.trim())) {
        var after = first.nextSibling;
        first.remove();
        if (after && after.nodeType === 3) after.textContent = after.textContent.replace(/^\s+/, "");
      }
      head.appendChild(body);
      card.appendChild(head);

      var opts = document.createElement("div");
      opts.className = "qz-opts";
      var buttons = [];
      Array.prototype.forEach.call(ul.children, function (li) {
        var m = li.textContent.trim().match(/^([A-E])\.\s*/);
        if (!m) return;
        var b = document.createElement("button");
        b.type = "button";
        b.className = "qz-opt";
        b.setAttribute("data-letter", m[1]);
        var letter = document.createElement("span");
        letter.className = "qz-l";
        letter.textContent = m[1];
        var text = document.createElement("span");
        text.className = "qz-o";
        text.innerHTML = li.innerHTML.replace(/^\s*[A-E]\.\s*/, "");
        b.appendChild(letter);
        b.appendChild(text);
        opts.appendChild(b);
        buttons.push(b);
      });
      ul.remove();
      card.appendChild(opts);

      det.classList.add("qz-exp");
      det.removeAttribute("open");
      var foot = document.createElement("div");
      foot.className = "qz-foot";
      var verdict = document.createElement("span");
      verdict.className = "qz-verdict";
      var show = document.createElement("button");
      show.type = "button";
      show.className = "qz-show";
      show.textContent = T.show;
      foot.appendChild(verdict);
      foot.appendChild(show);
      card.appendChild(foot);
      card.appendChild(det);

      var c = { id: qid, right: right, card: card, buttons: buttons, det: det, verdict: verdict };
      function choose(letter, quiet) {
        c.choice = letter;
        card.classList.add("qz-done");
        card.classList.toggle("qz-ok", letter === right);
        card.classList.toggle("qz-ko", !!letter && letter !== right);
        buttons.forEach(function (b) {
          var l = b.getAttribute("data-letter");
          b.classList.toggle("is-right", l === right);
          b.classList.toggle("is-wrong", !!letter && l === letter && l !== right);
          b.setAttribute("aria-pressed", String(l === letter));
        });
        verdict.textContent = !letter ? "" : letter === right ? "✓ " + T.right : "✗ " + T.wrong + " — " + right;
        det.open = true;
        show.hidden = true;
        if (!quiet) {
          if (letter) state[qid] = letter;
          save(key, state);
          tally();
        }
      }
      c.choose = choose;
      buttons.forEach(function (b) {
        b.addEventListener("click", function () { if (!c.choice) choose(b.getAttribute("data-letter")); });
      });
      show.addEventListener("click", function () { choose(null); tally(); });
      cards.push(c);
    });
    if (!cards.length) return;

    /* the score bar replaces the "click Answer" intro line */
    var intro = article.querySelector(":scope > p");
    var bar = document.createElement("div");
    bar.className = "qz-bar";
    bar.innerHTML = '<span class="qz-hint"></span><span class="qz-score"></span><span class="qz-track"><i></i></span><button type="button" class="qz-reset"></button>';
    bar.querySelector(".qz-hint").textContent = T.hint;
    bar.querySelector(".qz-reset").textContent = T.reset;
    if (intro && /Answer|Resposta/.test(intro.textContent) && intro.compareDocumentPosition(cards[0].card) & Node.DOCUMENT_POSITION_FOLLOWING) intro.replaceWith(bar);
    else cards[0].card.parentNode.insertBefore(bar, cards[0].card);

    function tally() {
      var done = 0, ok = 0;
      cards.forEach(function (c) { if (c.choice !== undefined) done++; if (c.choice === c.right) ok++; });
      bar.querySelector(".qz-score").innerHTML = "<b>" + done + "/" + cards.length + "</b> " + T.answered + " · <b>" + ok + "</b> " + T.correct;
      bar.querySelector(".qz-track i").style.width = (100 * done / cards.length) + "%";
      bar.classList.toggle("qz-started", done > 0);
    }
    bar.querySelector(".qz-reset").addEventListener("click", function () {
      state = {};
      save(key, state);
      cards.forEach(function (c) {
        c.choice = undefined;
        c.card.classList.remove("qz-done", "qz-ok", "qz-ko");
        c.buttons.forEach(function (b) { b.classList.remove("is-right", "is-wrong"); b.removeAttribute("aria-pressed"); });
        c.verdict.textContent = "";
        c.det.open = false;
        c.card.querySelector(".qz-show").hidden = false;
      });
      tally();
      bar.scrollIntoView({ block: "nearest" });
    });

    cards.forEach(function (c) { if (state[c.id]) c.choose(state[c.id], true); });
    tally();
    article.classList.add("qz-page");
  }

  function init() {
    if (!/\/(2027\.1|appendix)\//.test(location.pathname)) return;
    var article = document.querySelector(".md-content article.md-typeset, .md-content .md-typeset");
    if (article && !article.classList.contains("qz-page")) build(article);
  }

  if (typeof document$ !== "undefined") document$.subscribe(init);
  else document.addEventListener("DOMContentLoaded", init);
})();
