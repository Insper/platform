/*
 * The AI reviewer of hands-on 12 (2026.2), as a lab twin:
 *
 *   <div class="csim" data-sim="ai-pr-review" data-script="lab"></div>
 *
 * The lab's workflow, .github/workflows/ai-review.yml, on a pull request of the student project:
 * the event must be one of its types (opened, synchronize), the optional paths filter of 5.1 must
 * match a changed file, the job ai-review runs its four steps, and ai_review.py sends the diff to
 * the Claude API and posts the review. The diff is built as get_pr_diff builds it: file by file,
 * counting the newlines of each patch, and it stops before the next file once more than 3 000 lines
 * were added. The mode switches between the lab (a comment that never blocks the merge) and 5.4 (a
 * check run that branch protection requires, failing on a 🔴 Critical finding).
 *
 * The model reviewer finds the issues of the files it was sent, no more and no less: the hardcoded
 * secret of the page's test PR, a fake secret in a test resource (a false positive: it cannot tell),
 * nothing in a file cut by the truncation (a false negative). The API can work, lack its key (the
 * secret of 2.1 not set), or answer 529 Overloaded once (the anthropic library retries twice by default) or every
 * time. Each scenario shows which stage ran, the comment or check, and whether the merge is allowed.
 */
(function () {
  "use strict";

  var WORKFLOW = ".github/workflows/ai-review.yml", SCRIPT = ".github/scripts/ai_review.py";
  var TYPES = ["opened", "synchronize"];
  var PATHS = ["**/*.java", "**/*.yaml", "**/*.yml", "**/pom.xml", "**/Dockerfile"];
  var MAX_LINES = 3000, MAX_TOKENS = 1024, MODEL = "claude-sonnet-4-6", RETRIES = 2;
  var STEPS = ["Checkout", "Set up Python", "Install dependencies", "Run AI review"];
  var SEV = { critical: "🔴 Critical", warning: "🟠 Warning", suggestion: "🟡 Suggestion" };

  var J = "order-service/src/main/java/store/order/", PJ = "product-service/src/main/java/store/product/";
  var PRS = {
    endpoint: { number: 12, branch: "feature/add-order-endpoint", files: [
      { name: "order-service/src/main/resources/application.yaml", lines: 6, issue: { sev: "critical", fixable: true,
        en: "`application.yaml` contains a hardcoded JWT secret (`jwt.secret: mysecretkey123`)", pt: "`application.yaml` contém um segredo JWT fixo no código (`jwt.secret: mysecretkey123`)" } },
      { name: J + "OrderResource.java", lines: 42, issue: { sev: "suggestion",
        en: "`POST /orders` returns `200 OK`: resource creation is `201 Created` with a `Location` header", pt: "`POST /orders` retorna `200 OK`: criação de recurso é `201 Created` com um cabeçalho `Location`" } }
    ] },
    docs: { number: 13, branch: "docs/readme", files: [{ name: "README.md", lines: 14 }] },
    fixture: { number: 14, branch: "test/order-it", files: [
      { name: "order-service/src/test/resources/application-test.yaml", lines: 5, issue: { sev: "critical", falsePositive: true,
        en: "`application-test.yaml` contains a hardcoded JWT secret (`jwt.secret: test-only-secret`)", pt: "`application-test.yaml` contém um segredo JWT fixo no código (`jwt.secret: test-only-secret`)" } },
      { name: "order-service/src/test/java/store/order/OrderResourceIT.java", lines: 60 }
    ] },
    large: { number: 15, branch: "feature/product-catalog", files: [
      { name: PJ + "ProductMapper.java", lines: 1800 },
      { name: PJ + "ProductService.java", lines: 1400 },
      { name: "product-service/src/main/resources/application.yaml", lines: 6, issue: { sev: "critical", fixable: true,
        en: "`application.yaml` contains a hardcoded database password (`spring.datasource.password: store123`)", pt: "`application.yaml` contém uma senha de banco fixa no código (`spring.datasource.password: store123`)" } }
    ] }
  };

  /* a paths glob of GitHub Actions: ** spans directories (also none), * stays inside one */
  function glob(p) {
    var re = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, "(?:.*/)?");
    return new RegExp("^" + re + "$");
  }
  function matches(name) { return PATHS.some(function (p) { return glob(p).test(name); }); }

  /* get_pr_diff of ai_review.py: stop before the next file once more than MAX_LINES newlines were added */
  function diff(files) {
    var sent = [], cut = [], total = 0, truncated = false;
    files.forEach(function (f) {
      if (truncated || total > MAX_LINES) { truncated = true; cut.push(f); return; }
      sent.push(f);
      total += f.lines - 1;
    });
    return { sent: sent, cut: cut, total: total, all: files.reduce(function (a, f) { return a + f.lines - 1; }, 0), truncated: truncated };
  }

  function create() { return { cfg: { mode: "comment", paths: false, api: "ok" }, pr: null, fixed: false, comments: 0, runs: 0, check: null, last: null, head: 0 }; }
  function files(st) {
    return PRS[st.pr].files.map(function (f) {
      return f.issue && f.issue.fixable && st.fixed ? { name: f.name, lines: f.lines, fixed: true } : f;
    });
  }
  function set(st, patch) { Object.keys(patch).forEach(function (k) { st.cfg[k] = patch[k]; }); return st; }

  /* one pull_request event (or a re-run of the last run) */
  function event(st, ev, rerun) {
    var pr = PRS[st.pr], fs = files(st), cfg = st.cfg, gate = cfg.mode === "gate";
    var r = { event: ev, rerun: !!rerun, pr: st.pr, number: pr.number, files: fs, log: [], gate: gate };
    r.typeOk = TYPES.indexOf(ev) >= 0;
    r.pathOk = !cfg.paths || fs.some(function (f) { return matches(f.name); });
    r.ran = r.typeOk && r.pathOk;
    var label = "pull_request (" + ev + ")";
    if (!r.typeOk) r.log.push(label + ": not in types [" + TYPES.join(", ") + "] → no run");
    else if (!r.pathOk) r.log.push(label + ": no changed file matches paths → workflow skipped");
    if (ev !== "edited" && !rerun) st.head++;               /* opened and synchronize bring a new head commit */
    if (!r.ran) {
      /* edited keeps the head, and its checks; a skipped workflow leaves a required check waiting */
      if (r.typeOk) st.check = gate ? "expected" : null;
      return finish(st, r);
    }
    st.runs++;
    r.diff = diff(fs);
    r.log.push((rerun ? "re-run · " : "") + "AI Code Review · ai-review (" + label + ")");
    r.log.push("✓ " + STEPS.slice(0, 3).join(" · ✓ "));
    var tries = cfg.api === "overloaded" ? RETRIES + 1 : cfg.api === "flaky" ? 1 : 0;
    r.api = cfg.api; r.retried = tries;
    for (var i = 1; i <= tries; i++) r.log.push("POST /v1/messages → 529 Overloaded (attempt " + i + " of " + (RETRIES + 1) + ")");
    if (cfg.api === "nokey" || cfg.api === "overloaded") {
      r.job = "failure";
      r.log.push(cfg.api === "nokey" ? "✗ Run AI review: ANTHROPIC_API_KEY is empty (the secret of step 2.1 is not set)" : "✗ Run AI review: the API stayed overloaded after " + RETRIES + " retries");
      r.log.push("Error: Process completed with exit code 1.");
      st.check = "failure";
      return finish(st, r);
    }
    r.job = "success";
    r.log.push("POST /v1/messages → 200 OK (" + MODEL + ", max_tokens=" + MAX_TOKENS + ", " + r.diff.total + " diff lines)");
    var found = r.diff.sent.filter(function (f) { return f.issue; }).map(function (f) { return f.issue; });
    r.review = { issues: found, critical: found.filter(function (x) { return x.sev === "critical"; }).length, trivial: !r.diff.sent.some(function (f) { return /\.(java|ya?ml|xml)$|Dockerfile$/.test(f.name); }) };
    if (gate) {
      st.check = r.review.critical ? "failure" : "success";
      r.log.push("check run \"AI review\": " + st.check + (r.review.critical ? " (" + r.review.critical + " 🔴 Critical)" : ""));
    } else {
      st.comments++;
      st.check = "success";
      r.log.push("Review posted to PR #" + pr.number);
    }
    return finish(st, r);
  }
  function finish(st, r) {
    var gate = r.gate, c = st.check;
    r.check = c;
    r.merge = gate ? c === "success" : true;
    r.status = !c ? "no checks" : c === "expected" ? "Expected — Waiting for status to be reported" : c === "failure" ? (gate ? "Required check failed" : "1 failing check (not required)") : "All checks have passed";
    /* the truth the reviewer may miss: a real critical issue still in the PR */
    r.risk = r.files.some(function (f) { return f.issue && f.issue.sev === "critical" && !f.issue.falsePositive; });
    r.verdict = r.merge && r.risk ? "risk" : !r.merge && !r.risk && c === "failure" && r.review ? "false-block" : !r.merge ? "blocked" : "ok";
    r.comments = st.comments;
    if (r.ran) st.last = r;
    return r;
  }

  function open(st, key) { st.pr = key; st.fixed = false; st.comments = 0; st.check = null; st.last = null; return event(st, "opened"); }
  function push(st) { st.fixed = true; return event(st, "synchronize"); }
  function edit(st) { return event(st, "edited"); }
  function rerun(st) { var ev = st.last && st.last.ran ? st.last.event : null; return ev ? event(st, ev, true) : null; }

  /* the comment ai_review.py posts (or the check run's summary in 5.4) */
  function comment(r, pt) {
    if (!r.review) return "";
    var v = r.review, L = function (x) { return pt ? x.pt : x.en; };
    var sum = v.trivial ? (pt ? "Este PR só muda documentação: nada a revisar." : "This PR only changes documentation: nothing to review.")
      : v.critical ? (pt ? "Há um problema crítico de segurança a resolver antes do merge." : "There is a critical security issue to resolve before merging.")
      : v.issues.length ? (pt ? "Nenhum problema crítico; uma sugestão abaixo." : "No critical issue; one suggestion below.")
      : (pt ? "Nenhum problema encontrado no diff enviado." : "No issue found in the diff that was sent.");
    var out = ["## 🤖 AI Code Review", "", "## Summary", sum];
    if (v.issues.length) out = out.concat(["", "## Issues Found"], v.issues.map(function (x) { return SEV[x.sev] + " — " + L(x); }));
    if (r.diff.truncated) out.push("", "... (diff truncated — too large for single review)");
    if (!r.gate) out.push("", "*Powered by Claude · Non-blocking · For guidance only*");
    return out.join("\n");
  }

  var SCRIPTS = {
    lab: [
      { ops: [["open", "endpoint"]], en: "The page's test PR (4.1): opened is in types, the workflow runs. The comment flags 🔴 the hardcoded JWT secret and 🟡 the 200 OK, and the merge stays allowed: the check is not required.",
        pt: "O PR de teste da página (4.1): opened está em types e o workflow roda. O comentário aponta 🔴 o segredo JWT fixo e 🟡 o 200 OK, e o merge continua liberado: o check não é obrigatório." },
      { ops: [["edit"]], en: "Edit the PR description: edited is not in types, nothing runs.", pt: "Edite a descrição do PR: edited não está em types, nada roda." },
      { ops: [["push"]], en: "Push the fix (synchronize): a second run and a second comment, now with the 🟡 only. The script never edits the first comment.",
        pt: "Faça push da correção (synchronize): uma segunda execução e um segundo comentário, agora só com o 🟡. O script nunca edita o primeiro comentário." },
      { ops: [["set", { paths: true }], ["open", "docs"]], en: "With the paths filter of 5.1, a README-only PR does not start the workflow at all.",
        pt: "Com o filtro paths de 5.1, um PR só de README nem inicia o workflow." }
    ],
    gate: [
      { ops: [["set", { mode: "gate" }], ["open", "endpoint"]], en: "5.4: the review becomes a required check. The 🔴 fails it: the merge is blocked.",
        pt: "5.4: a revisão vira um check obrigatório. O 🔴 o reprova: o merge fica bloqueado." },
      { ops: [["push"]], en: "The fix passes the check: the merge is allowed.", pt: "A correção passa no check: o merge é liberado." },
      { ops: [["open", "fixture"]], en: "A fake secret in a test resource: the model flags it 🔴 and the check blocks a safe PR, a false positive.",
        pt: "Um segredo falso num recurso de teste: o modelo o marca 🔴 e o check bloqueia um PR seguro, um falso positivo." },
      { ops: [["open", "large"]], en: "3 203 diff lines: the script stops after 3 198, before application.yaml. The hardcoded password is never sent and the check passes, a false negative.",
        pt: "3 203 linhas de diff: o script para depois de 3 198, antes do application.yaml. A senha fixa nunca é enviada e o check passa, um falso negativo." },
      { ops: [["set", { paths: true }], ["open", "docs"]], en: "paths filter plus a required check: the workflow never starts, the check stays \"Expected — Waiting for status to be reported\" and the PR cannot merge.",
        pt: "Filtro paths com um check obrigatório: o workflow nunca inicia, o check fica em \"Expected — Waiting for status to be reported\" e o PR não pode ser mergeado." }
    ],
    failures: [
      { ops: [["set", { api: "nokey" }], ["open", "endpoint"]], en: "No ANTHROPIC_API_KEY secret (step 2.1 skipped): the job fails with exit code 1. The check is not required, so the merge is still allowed, with a red ✗.",
        pt: "Sem o secret ANTHROPIC_API_KEY (passo 2.1 pulado): o job falha com exit code 1. O check não é obrigatório, então o merge continua liberado, com um ✗ vermelho." },
      { ops: [["set", { api: "flaky" }], ["rerun"]], en: "Re-run with the API overloaded once: 529, the anthropic library retries by itself and the review is posted.",
        pt: "Nova execução com a API sobrecarregada uma vez: 529, a biblioteca anthropic tenta de novo sozinha e a revisão é publicada." },
      { ops: [["set", { api: "overloaded" }], ["push"]], en: "529 on all 3 attempts: the job fails. The failure says nothing about the code: re-run the job.",
        pt: "529 nas 3 tentativas: o job falha. A falha não diz nada sobre o código: rode o job de novo." },
      { ops: [["set", { api: "ok" }], ["rerun"]], en: "Re-run with the API back: the review is posted.", pt: "Nova execução com a API de volta: a revisão é publicada." },
      { ops: [["set", { mode: "gate", api: "nokey" }], ["rerun"]], en: "The same missing secret with a required check: now nobody merges until someone fixes the secret.",
        pt: "O mesmo secret ausente com um check obrigatório: agora ninguém faz merge até alguém corrigir o secret." }
    ]
  };
  var OPS = { open: open, push: push, edit: edit, rerun: rerun, set: set };
  function run(st, op) { var r = OPS[op[0]].apply(null, [st].concat(op.slice(1))); return r && r.event ? r : null; }
  function play(name, n) {
    var st = create(), out = [];
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (s) { s.ops.forEach(function (op) { var r = run(st, op); if (r) out.push(r); }); });
    return { st: st, out: out, last: out[out.length - 1] };
  }

  var API = { WORKFLOW: WORKFLOW, SCRIPT: SCRIPT, TYPES: TYPES, PATHS: PATHS, MAX_LINES: MAX_LINES, MAX_TOKENS: MAX_TOKENS, MODEL: MODEL, RETRIES: RETRIES,
    STEPS: STEPS, SEV: SEV, PRS: PRS, SCRIPTS: SCRIPTS, glob: glob, matches: matches, diff: diff, create: create, files: files, set: set, event: event,
    open: open, push: push, edit: edit, rerun: rerun, comment: comment, run: run, play: play };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var VW = 720, BW = 94, BH = 58, GAP = 10, Y = 6;
  function num(v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }

  C.style("ai-pr-review", [
    ".md-typeset .csim-ai-cmt { margin: .3rem 0 0; padding: .4rem .55rem; border: .05rem solid var(--c-line); border-radius: .35rem; background: var(--c-panel);",
    "  font-family: var(--md-code-font-family); font-size: .58rem; white-space: pre-wrap; min-height: 3rem; }",
    ".md-typeset .csim-log.csim-ai-term li { white-space: pre-wrap; font-size: .58rem; }",
    ".md-typeset .csim-ai-h { font-weight: 600; margin: .4rem 0 0; font-size: .64rem; }",
    ".md-typeset .csim .csim-ai-dot { fill: var(--c-line); }",
    ".md-typeset .csim .csim-ai-dot.ok { fill: var(--c-ok); }",
    ".md-typeset .csim .csim-ai-dot.bad { fill: var(--c-bad); }"
  ].join("\n"));

  C.register("ai-pr-review", function (root) {
    var o = C.opts(root, { script: "lab" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st, last = null;
    function L(pair) { return C.PT ? pair[1] : pair[0]; }

    var svg = s("svg", { viewBox: "0 0 720 160", role: "img", "aria-label": t("The pull request pipeline", "O pipeline do pull request") });
    var note = el("p", { class: "csim-note" });
    var cmt = el("div", { class: "csim-ai-cmt" });
    var term = C.log(6); term.className += " csim-ai-term";
    var tiles = C.stats([
      { key: "runs", label: t("workflow runs", "execuções do workflow") },
      { key: "lines", label: t("diff lines sent / in the PR", "linhas de diff enviadas / no PR") },
      { key: "found", label: t("findings", "achados") },
      { key: "merge", label: "merge" }
    ]);
    function say(text, tone) { note.textContent = text || ""; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    function show(r) {
      if (!r) return;
      last = r;
      /* one entry per event, its lines in order */
      term.add(r.log.join("\n"), !r.ran ? "" : r.job === "failure" ? "bad" : r.retried ? "warn" : "ok");
    }

    var cScript = C.choice({ label: t("Lab page", "Página do lab"), value: script, options: [
      { value: "lab", label: "4 · 5.1" }, { value: "gate", label: t("5.4 gate", "5.4 trava") },
      { value: "failures", label: t("failures", "falhas") }, { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; reset(); } });
    var cPR = C.choice({ label: t("Open a PR", "Abrir um PR"), value: "", options: [
      { value: "endpoint", label: t("test PR (4.1)", "PR de teste (4.1)") }, { value: "docs", label: "README" },
      { value: "fixture", label: t("test fixture", "fixture de teste") }, { value: "large", label: t("large PR", "PR grande") }
    ], onChange: function (v) { act(function () { return open(st, v); })(); } });
    var bPush = C.button(t("push a fix (synchronize)", "push da correção (synchronize)"), null, { tone: "ok" });
    var bEdit = C.button(t("edit description (edited)", "editar descrição (edited)"), null);
    var bRerun = C.button(t("re-run job", "rodar o job de novo"), null);
    var cMode = C.choice({ label: t("Mode", "Modo"), value: "comment", options: [
      { value: "comment", label: t("comment (the lab)", "comentário (o lab)") }, { value: "gate", label: t("required check (5.4)", "check obrigatório (5.4)") }
    ], onChange: function (v) { set(st, { mode: v }); draw(); } });
    var tPaths = C.toggle({ label: t("paths filter (5.1)", "filtro paths (5.1)"), onChange: function (v) { set(st, { paths: v }); draw(); } });
    var cApi = C.choice({ label: "Claude API", value: "ok", options: [
      { value: "ok", label: "200 OK" }, { value: "nokey", label: t("no secret", "sem secret") }, { value: "flaky", label: t("529 once", "529 uma vez") }, { value: "overloaded", label: t("529 always", "529 sempre") }
    ], onChange: function (v) { set(st, { api: v }); draw(); } });

    function act(fn) {
      return function () {
        player.pause();
        var r = fn();
        if (r) { show(r); explain(r); }
        draw();
      };
    }
    bPush.onclick = act(function () { return st.pr ? push(st) : null; });
    bEdit.onclick = act(function () { return st.pr ? edit(st) : null; });
    bRerun.onclick = act(function () { return rerun(st); });

    var player = C.player({ interval: 2800, onTick: function (k) { return tick(k); }, onPrev: function (k) { replay(k); }, onReset: function () { reset(); } });
    function sync() { cMode.set(st.cfg.mode); tPaths.set(st.cfg.paths); cApi.set(st.cfg.api); cPR.set(st.pr || ""); }
    function tick(k) {
      var sc = SCRIPTS[script];
      if (!sc || k > sc.length) return false;
      sc[k - 1].ops.forEach(function (op) { show(run(st, op)); });
      sync(); draw();
      say(L([sc[k - 1].en, sc[k - 1].pt]), last ? tone(last) : "");
    }
    function replay(k) {
      st = create(); term.clear(); last = null;
      for (var i = 1; i <= k; i++) SCRIPTS[script][i - 1].ops.forEach(function (op) { show(run(st, op)); });
      sync(); draw();
      if (k) say(L([SCRIPTS[script][k - 1].en, SCRIPTS[script][k - 1].pt]), last ? tone(last) : ""); else intro();
    }
    function intro() {
      say(script === "free" ? t("Open a PR, then push, edit or re-run. Mode, paths filter and API apply to the next event.", "Abra um PR e depois faça push, edite ou rode de novo. Modo, filtro paths e API valem para o próximo evento.")
        : t("No PR yet. Press play or → to replay the page; the buttons work at any time, and mode, paths filter and API apply to the next event.",
            "Nenhum PR ainda. Aperte play ou → para repetir a página; os botões funcionam a qualquer momento e modo, filtro paths e API valem para o próximo evento."), "");
    }
    function reset() {
      st = create(); term.clear(); last = null; sync();
      player.total(SCRIPTS[script] ? SCRIPTS[script].length : 0);
      player.style.display = SCRIPTS[script] ? "" : "none";
      draw(); intro();
    }
    /* allowed with a critical issue the review flagged: someone must read it (warn); one nobody saw, or a safe PR blocked: bad */
    function tone(r) {
      if (r.verdict === "risk") return r.review && r.review.critical ? "warn" : "bad";
      return r.verdict === "false-block" ? "bad" : r.verdict === "blocked" || r.job === "failure" ? "warn" : r.ran ? "ok" : "";
    }
    function explain(r) {
      var txt = !r.typeOk ? t(r.event + " is not in types: nothing runs.", r.event + " não está em types: nada roda.")
        : !r.pathOk ? t("No changed file matches the paths filter: the workflow is skipped.", "Nenhum arquivo alterado casa com o filtro paths: o workflow é pulado.")
        : r.job === "failure" ? t("The job failed: no review.", "O job falhou: sem revisão.")
        : r.review.critical ? t("The review found " + r.review.critical + " 🔴 Critical.", "A revisão achou " + r.review.critical + " 🔴 Critical.")
        : t("The review found no critical issue.", "A revisão não achou problema crítico.");
      if (r.diff && r.diff.truncated) txt += t(" The diff was cut after " + num(r.diff.total) + " lines: " + r.diff.cut.length + " file(s) never sent.", " O diff foi cortado depois de " + num(r.diff.total) + " linhas: " + r.diff.cut.length + " arquivo(s) nunca enviado(s).");
      if (r.verdict === "risk") txt += t(" The merge is allowed with a real critical issue in the PR.", " O merge está liberado com um problema crítico real no PR.");
      if (r.verdict === "false-block") txt += t(" The merge is blocked, yet the PR is safe.", " O merge está bloqueado e mesmo assim o PR é seguro.");
      if (r.check === "expected") txt += t(" The required check waits for a status that will never come.", " O check obrigatório espera um status que nunca virá.");
      say(txt, tone(r));
    }

    function box(i, title, sub, cls, y) {
      var x = 4 + i * (BW + GAP);
      svg.appendChild(s("rect", { x: x, y: y || Y, width: BW, height: BH, rx: 6, class: "c-box " + cls }));
      svg.appendChild(s("text", { x: x + BW / 2, y: (y || Y) + 18, "text-anchor": "middle", class: "c-label" }, title));
      (Array.isArray(sub) ? sub : [sub]).forEach(function (line, j) {
        svg.appendChild(s("text", { x: x + BW / 2, y: (y || Y) + 33 + j * 12, "text-anchor": "middle", class: "c-small" }, line));
      });
      if (i) svg.appendChild(s("line", { x1: x - GAP, y1: (y || Y) + BH / 2, x2: x, y2: (y || Y) + BH / 2, class: "c-wire" + (cls === "down" ? "" : " on") }));
      return x;
    }
    function draw() {
      C.clear(svg);
      var r = last, gate = st.cfg.mode === "gate";
      var ev = r ? r.event : "–";
      box(0, "pull_request", r ? (r.rerun ? "re-run" : ev) : t("no PR yet", "nenhum PR"), r ? "on" : "down");
      box(1, "types", r ? [(r.typeOk ? "✓ " : "✗ ") + ev, r.typeOk ? t("in types", "em types") : t("not in types", "fora de types")] : ["opened", "synchronize"], !r ? "" : r.typeOk ? "ok" : "bad");
      box(2, "paths", st.cfg.paths ? (r && r.typeOk ? (r.pathOk ? "✓ match" : "✗ no match") : "5.1") : t("no filter", "sem filtro"), !r || !r.typeOk ? "down" : !st.cfg.paths ? "" : r.pathOk ? "ok" : "bad");
      var jx = box(3, "ai-review", [r && r.ran ? (r.job === "success" ? "✓ success" : "✗ failure") : t("not run", "não rodou")], !r || !r.ran ? "down" : r.job === "success" ? "ok" : "bad");
      STEPS.forEach(function (n, i) {
        var cls = !r || !r.ran ? "" : i < 3 || r.job === "success" ? "ok" : "bad";
        svg.appendChild(s("circle", { cx: jx + 16 + i * 16, cy: Y + 46, r: 4.5, class: "csim-ai-dot " + cls }, [s("title", {}, n)]));
      });
      var api = !r || !r.ran ? "down" : r.job === "success" ? (r.retried ? "warn" : "ok") : "bad";
      box(4, "Claude API", [MODEL, r && r.ran ? (r.job === "success" ? (r.retried ? "529 → 200 OK" : "200 OK") : r.api === "nokey" ? t("no key", "sem chave") : "529 × " + (RETRIES + 1)) : ""], api);
      var out = r && r.review ? (r.gate ? (r.check === "failure" ? "✗ failure" : "✓ success") : ["PR #" + r.number, r.comments + t(" comment(s)", " comentário(s)")]) : "–";
      box(5, gate ? "check run" : t("PR comment", "comentário"), out, !r || !r.review ? "down" : r.gate && r.check === "failure" ? "bad" : "ok");
      var m = r ? (r.merge ? t("allowed", "liberado") : t("blocked", "bloqueado")) : "–";
      box(6, "merge", [m, r ? (r.check === "expected" ? "Expected…" : r.check === "failure" ? (gate ? t("required ✗", "obrigatório ✗") : "✗ (" + t("not required", "não obrig.") + ")") : r.check ? "✓" : t("no checks", "sem checks")) : ""],
        !r ? "down" : tone(r) === "bad" || tone(r) === "warn" ? tone(r) : r.merge ? "ok" : "warn");
      /* the files of the PR: sent, cut by the truncation, or a fixed issue */
      var fs = st.pr ? files(st) : [], d = st.pr ? diff(fs) : null;
      svg.appendChild(s("text", { x: 4, y: 86, class: "c-label" }, st.pr ? "PR #" + PRS[st.pr].number + " · " + PRS[st.pr].branch : t("Files of the PR", "Arquivos do PR")));
      fs.forEach(function (f, i) {
        var y = 102 + i * 15, sent = d.sent.indexOf(f) >= 0;
        var tag = !sent ? t("cut: after " + num(MAX_LINES) + " lines, never sent", "cortado: depois de " + num(MAX_LINES) + " linhas, nunca enviado")
          : f.issue ? SEV[f.issue.sev] + (f.issue.falsePositive ? t(" (a test value: safe)", " (valor de teste: seguro)") : "") : f.fixed ? t("fixed", "corrigido") : "";
        svg.appendChild(s("text", { x: 10, y: y, class: "c-small c-mono" }, f.name + "  +" + f.lines));
        svg.appendChild(s("text", { x: VW - 4, y: y, "text-anchor": "end", class: "c-small" + (!sent ? " c-bad" : f.issue && f.issue.sev === "critical" ? (f.issue.falsePositive ? " c-warn" : " c-bad") : f.fixed ? " c-ok" : "") }, tag));
      });
      svg.setAttribute("viewBox", "0 0 " + VW + " " + (102 + Math.max(1, fs.length) * 15));
      cmt.textContent = r && r.review ? comment(r, C.PT) : r && r.job === "failure" ? t("(no review: the job failed)", "(sem revisão: o job falhou)") : t("(no review)", "(sem revisão)");
      tiles.set("runs", String(st.runs), "");
      tiles.set("lines", d ? num(d.total) + " / " + num(d.all) : "–", d && d.truncated ? "bad" : "");
      tiles.set("found", r && r.review ? (r.review.issues.length ? r.review.issues.map(function (x) { return SEV[x.sev].slice(0, 2); }).join(" ") : "0") : "–", r && r.review && r.review.critical ? "bad" : "");
      tiles.set("merge", m, !r ? "" : tone(r) === "bad" || tone(r) === "warn" ? tone(r) : r.merge ? "ok" : "warn");
      bPush.disabled = !st.pr; bEdit.disabled = !st.pr; bRerun.disabled = !(st.last && st.last.ran);
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's AI reviewer on a pull request: what runs, what it sees, what gates the merge",
        "O revisor de IA do lab num pull request: o que roda, o que ele vê, o que segura o merge") }),
      el("p", { class: "csim-sub", text: t("ai-review.yml and ai_review.py as in the page. Open a PR, push, edit or re-run; switch to the required check of 5.4 to see the gate.",
        "ai-review.yml e ai_review.py como na página. Abra um PR, faça push, edite ou rode de novo; troque para o check obrigatório de 5.4 para ver a trava.") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-row" }, [cPR]),
      el("div", { class: "csim-row" }, [bPush, bEdit, bRerun]),
      el("div", { class: "csim-row" }, [cMode, tPaths, cApi]),
      el("div", { class: "csim-stage" }, svg),
      note,
      player,
      el("div", { class: "csim-cols" }, [
        el("div", {}, [tiles, el("p", { class: "csim-ai-h", text: t("Actions log", "Log do Actions") }), term]),
        el("div", {}, [el("p", { class: "csim-ai-h", text: t("The comment (or the check run's summary)", "O comentário (ou o resumo do check run)") }), cmt])
      ])
    ]);
    reset();
    return {};
  });
})();
