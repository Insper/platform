/*
 * The Jenkins of hands-on 4 (2026.2), as a lab twin:
 *
 *   <div class="csim" data-sim="jenkins-pipeline" data-script="executors"></div>
 *
 * The Built-In Node with its executors, the build queue and the stage view of the lab's jobs: account
 * (the Jenkinsfile with one Build stage) and account-service (Dependencies → Build → Build & Push Image,
 * where Dependencies runs `build job: 'account', wait: true`). auth and auth-service are the same two
 * Jenkinsfiles for the modules of hands-on 3 (auth-service waits for account, then auth). A build holds
 * its executor from start to end, also while it waits for a dependency; a job already waiting in the
 * queue is not queued twice (the second request joins the first), as Jenkins does.
 *
 * A script (data-script) replays a case step by step, 5 s of build time per step: "lab" (account,
 * then account-service, with 10 executors), "executors" (two services at once with the default 2: both
 * hold an executor waiting for account, which never gets one; then 10) and "failure" (account does not
 * compile, then a wrong credentials ID); "free" leaves only the buttons. The durations are illustrative.
 */
(function () {
  "use strict";

  var DT = 5;                       /* seconds of build time per step */
  var DEFAULT_EXECUTORS = 2, LAB_EXECUTORS = 10;
  var CRED = "dockerhub-credential", REPO = "humbertosandmann";
  var PLATFORMS = "linux/arm64,linux/amd64";
  /* the lab's Jenkinsfiles (account, account-service) and the same files for the modules of hands-on 3 */
  function lib(dur) { return [{ name: "Build", sh: "mvn -B -DskipTests clean install", dur: dur }]; }
  function service(svc, deps) {
    return [{ name: "Dependencies", jobs: deps }, { name: "Build", sh: "mvn -B -DskipTests clean package", dur: 30 }, { name: "Build & Push Image", push: true, dur: 60, svc: svc }];
  }
  var JOBS = {
    account: { stages: lib(20) },
    "account-service": { stages: service("account", ["account"]) },
    auth: { stages: lib(15) },
    "auth-service": { stages: service("auth", ["account", "auth"]) }
  };
  var ORDER = ["account", "account-service", "auth", "auth-service"];

  function create(executors) {
    return { t: 0, executors: executors || DEFAULT_EXECUTORS, queue: [], builds: [], next: {}, failure: "none", log: [], stuck: false };
  }
  function say(st, b, line, tone) { st.log.push({ t: st.t, build: b ? b.job + " #" + b.num : "", line: line, tone: tone || "" }); }
  function slots(st) {
    var used = {};
    st.builds.forEach(function (b) { if (b.status === "running") used[b.exec] = b; });
    return used;
  }
  function busy(st) { return st.builds.filter(function (b) { return b.status === "running"; }).length; }

  /* Build Now, or `build job:` from a pipeline (by = the waiting build) */
  function trigger(st, job, by) {
    if (st.failure === "nojob" && job === "account") {
      if (by) say(st, by, "ERROR: No item named account found", "bad");
      else say(st, null, "No job named account: it was never created (New Item → Pipeline).", "bad");
      return null;
    }
    var queued = st.queue.filter(function (b) { return b.job === job; })[0];
    if (queued) {
      if (by) say(st, by, "Scheduling project: " + job + " (already in the queue: " + job + " #" + queued.num + ")");
      return queued;
    }
    st.next[job] = (st.next[job] || 0) + 1;
    var b = { job: job, num: st.next[job], status: "queued", exec: null, stage: 0, left: 0, dep: 0, wait: null, queuedAt: st.t, by: by ? by.job + " #" + by.num : null,
      stages: JOBS[job].stages.map(function () { return ""; }) };
    st.builds.push(b);
    st.queue.push(b);
    if (by) say(st, by, "Scheduling project: " + job);
    say(st, b, by ? "Started by upstream project \"" + by.job + "\" build number " + by.num : "Started by user admin");
    return b;
  }

  function startStage(st, b) {
    var s = JOBS[b.job].stages[b.stage];
    b.stages[b.stage] = "running";
    say(st, b, "[Pipeline] stage (" + s.name + ")");
    if (s.sh) { b.left = s.dur; say(st, b, "+ " + s.sh); }
    if (s.push) {
      if (st.failure === "creds") return fail(st, b, "ERROR: Could not find credentials entry with ID '" + CRED + "'");
      b.left = s.dur;
      say(st, b, "+ docker login -u **** --password-stdin");
      say(st, b, "+ docker buildx build --platform=" + PLATFORMS + " --push --tag " + REPO + "/" + s.svc + ":latest --tag " + REPO + "/" + s.svc + ":" + b.num + " -f Dockerfile .");
    }
    if (s.jobs) b.dep = 0;
  }
  function finish(st, b, status) {
    b.status = status; b.exec = null; b.end = st.t;
    say(st, b, "Finished: " + status, status === "SUCCESS" ? "ok" : "bad");
  }
  function fail(st, b, line) {
    b.stages[b.stage] = "failed";
    if (line) say(st, b, line, "bad");
    for (var i = b.stage + 1; i < b.stages.length; i++) {
      b.stages[i] = "skipped";
      say(st, b, "Stage \"" + JOBS[b.job].stages[i].name + "\" skipped due to earlier failure(s)", "warn");
    }
    finish(st, b, "FAILURE");
  }
  function nextStage(st, b) {
    b.stages[b.stage] = "ok";
    b.stage++;
    if (b.stage >= b.stages.length) {
      var s = JOBS[b.job].stages;
      if (s[s.length - 1].push) b.tags = [REPO + "/" + s[s.length - 1].svc + ":latest", REPO + "/" + s[s.length - 1].svc + ":" + b.num];
      return finish(st, b, "SUCCESS");
    }
    startStage(st, b);
  }

  function assign(st) {
    var used = slots(st);
    while (st.queue.length) {
      var free = -1;
      for (var i = 0; i < st.executors; i++) if (!used[i]) { free = i; break; }
      if (free < 0) break;
      var b = st.queue.shift();
      b.status = "running"; b.exec = free; b.start = st.t; used[free] = b;
      say(st, b, "Running on Built-In Node in /var/jenkins_home/workspace/" + b.job + " (executor " + (free + 1) + ")");
      startStage(st, b);
    }
    st.queue.forEach(function (b) {
      if (!b.waitSaid) { b.waitSaid = true; say(st, b, "Waiting for next available executor", "warn"); }
    });
  }

  /* one step: assign the queue, then DT seconds of work for every running build (events at the end of the step) */
  function tick(st) {
    assign(st);
    st.t += DT;
    st.builds.filter(function (b) { return b.status === "running"; }).forEach(function (b) {
      if (b.status !== "running") return;
      var s = JOBS[b.job].stages[b.stage];
      if (s.jobs) {
        while (b.status === "running" && b.stage < b.stages.length && JOBS[b.job].stages[b.stage].jobs) {
          var deps = JOBS[b.job].stages[b.stage].jobs;
          if (!b.wait) {
            var d = trigger(st, deps[b.dep], b);
            if (!d) return fail(st, b);
            b.wait = d;
            say(st, b, "Starting building: " + d.job + " #" + d.num);
          }
          if (b.wait.status === "SUCCESS") {
            say(st, b, "Build " + b.wait.job + " #" + b.wait.num + " completed: SUCCESS", "ok");
            b.wait = null; b.dep++;
            if (b.dep >= deps.length) nextStage(st, b);
            continue;
          }
          if (b.wait.status === "FAILURE") {
            var w = b.wait; b.wait = null;
            return fail(st, b, "ERROR: " + w.job + " #" + w.num + " completed with status FAILURE (propagate: false to ignore)");
          }
          b.stages[b.stage] = b.wait.status === "queued" ? "waiting" : "running";
          return;
        }
        return;
      }
      b.left -= DT;
      if (b.left > 0) return;
      if (s.sh && st.failure === "compile" && b.job === "account") {
        say(st, b, "[ERROR] COMPILATION ERROR", "bad");
        say(st, b, "[INFO] BUILD FAILURE", "bad");
        return fail(st, b, "ERROR: script returned exit code 1");
      }
      if (s.sh) say(st, b, "[INFO] BUILD SUCCESS", "ok");
      if (s.push) say(st, b, "+ docker buildx rm --force multi-platform-builder-" + s.svc);
      nextStage(st, b);
    });
    assign(st);
    var running = st.builds.filter(function (b) { return b.status === "running"; });
    st.stuck = st.queue.length > 0 && running.length >= st.executors &&
      running.every(function (b) { return b.wait && b.wait.status === "queued"; });
    return st;
  }
  function idle(st) { return !st.builds.some(function (b) { return b.status === "running" || b.status === "queued"; }); }
  function settled(st) { return idle(st) || st.stuck; }

  function setExecutors(st, n) {
    st.executors = n;
    say(st, null, "Manage Jenkins → Nodes → Built-In Node → Number of executors = " + n);
    assign(st);
    st.stuck = false;
  }
  function setFailure(st, f) { st.failure = f; }

  /* the cases, phase by phase: a phase applies its operations, then runs until nothing is running or the
     queue is stuck; each step of the player is one tick */
  var SCRIPTS = {
    lab: [
      { ops: [["executors", LAB_EXECUTORS], ["build", "account"]], en: "Build Now on account: one Build stage, mvn -B -DskipTests clean install.", pt: "Build Now em account: um estágio Build, mvn -B -DskipTests clean install." },
      { ops: [["build", "account-service"]], en: "Build Now on account-service: Dependencies starts account #2 and waits, then Build, then Build & Push Image.", pt: "Build Now em account-service: Dependencies inicia account #2 e espera, depois Build e depois Build & Push Image." }
    ],
    executors: [
      { ops: [["executors", DEFAULT_EXECUTORS], ["build", "account-service"], ["build", "auth-service"]], en: "Two services at once with the default 2 executors: each one holds an executor and waits for account.", pt: "Dois serviços ao mesmo tempo com os 2 executors padrão: cada um segura um executor e espera account." },
      { ops: [["executors", LAB_EXECUTORS]], en: "Raise the executors to 10, as the lab does: account leaves the queue and both pipelines finish.", pt: "Suba os executors para 10, como o lab faz: account sai da fila e os dois pipelines terminam." }
    ],
    failure: [
      { ops: [["executors", LAB_EXECUTORS], ["failure", "compile"], ["build", "account-service"]], en: "account does not compile: its failure fails Dependencies, and the later stages are skipped.", pt: "account não compila: a falha dele derruba Dependencies e os estágios seguintes são pulados." },
      { ops: [["failure", "creds"], ["build", "account-service"]], en: "account compiles, but the credential was saved under another ID: Build & Push Image fails.", pt: "account compila, mas a credencial foi salva com outro ID: Build & Push Image falha." }
    ]
  };
  function apply(st, op) {
    if (op[0] === "executors") setExecutors(st, op[1]);
    else if (op[0] === "failure") setFailure(st, op[1]);
    else if (op[0] === "build") trigger(st, op[1]);
  }
  /* a script as a list of steps: the phase index each step starts (or -1) */
  function plan(name, max) {
    var st = create(), steps = [], phases = SCRIPTS[name];
    for (var p = 0; p < phases.length; p++) {
      phases[p].ops.forEach(function (op) { apply(st, op); });
      steps.push(p);
      tick(st);
      var guard = 0;
      while (!settled(st) && guard++ < (max || 200)) { tick(st); steps.push(-1); }
      if (st.stuck) for (var k = 0; k < 2; k++) { tick(st); steps.push(-1); }   /* let the hang last a moment */
    }
    return { st: st, steps: steps };
  }
  /* the state after n steps of a script */
  function play(name, n) {
    var st = create(), steps = plan(name).steps, phases = SCRIPTS[name];
    steps.slice(0, n === undefined ? Infinity : n).forEach(function (p) {
      if (p >= 0) phases[p].ops.forEach(function (op) { apply(st, op); });
      tick(st);
    });
    return st;
  }
  /* jobs triggered together on n executors: when everything ends (or null when stuck) */
  function race(n, jobs, failure) {
    var st = create(n);
    if (failure) st.failure = failure;
    jobs.forEach(function (j) { trigger(st, j); });
    var guard = 0;
    do { tick(st); } while (!settled(st) && guard++ < 500);
    return { st: st, end: st.stuck ? null : st.t, stuckAt: st.stuck ? st.t : null };
  }
  function build(st, job, num) { return st.builds.filter(function (b) { return b.job === job && (!num || b.num === num); }).pop(); }

  var API = { DT: DT, DEFAULT_EXECUTORS: DEFAULT_EXECUTORS, LAB_EXECUTORS: LAB_EXECUTORS, CRED: CRED, REPO: REPO, PLATFORMS: PLATFORMS, JOBS: JOBS, SCRIPTS: SCRIPTS,
    create: create, trigger: trigger, tick: tick, idle: idle, settled: settled, setExecutors: setExecutors, setFailure: setFailure, plan: plan, play: play, race: race, build: build, busy: busy };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;

  C.style("jenkins-pipeline", [
    ".md-typeset .csim-jk-term li { font-family: var(--md-code-font-family, monospace); font-size: .62rem; white-space: pre-wrap; word-break: break-all; }",
    ".md-typeset .csim-jk-jobs .csim-btn { font-family: var(--md-code-font-family, monospace); }"
  ].join("\n"));

  var STAGE_W = 128, ROW_H = 26, TOP = 118;
  var TONE = { "": "on", running: "hot", waiting: "warn", ok: "ok", failed: "bad", skipped: "down" };

  C.register("jenkins-pipeline", function (root) {
    var o = C.opts(root, { script: "lab" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st, steps = [], logAt = 0;

    var svg = s("svg", { viewBox: "0 0 640 280", role: "img", "aria-label": t("Jenkins: executors, queue and stage view", "Jenkins: executors, fila e visão de estágios") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(8); term.className += " csim-jk-term";
    var tiles = C.stats([
      { key: "t", label: t("build time", "tempo de build") },
      { key: "busy", label: t("executors busy", "executors ocupados") },
      { key: "queue", label: t("in the queue", "na fila") },
      { key: "last", label: t("last result", "último resultado") }
    ]);
    function tell(pair, tone) { note.textContent = pair ? (C.PT ? pair[1] : pair[0]) : ""; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    function flush() {
      st.log.slice(logAt).forEach(function (e) { term.add("t=" + e.t + "s " + (e.build ? e.build + ": " : "") + e.line, e.tone); });
      logAt = st.log.length;
    }

    var cScript = C.choice({ label: t("Case", "Caso"), value: script, options: [
      { value: "lab", label: t("the lab's jobs", "os jobs do lab") },
      { value: "executors", label: t("too few executors", "poucos executors") },
      { value: "failure", label: t("a failing stage", "um estágio que falha") },
      { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; reset(); } });
    var cExec = C.choice({ label: t("Number of executors", "Número de executors"), value: DEFAULT_EXECUTORS, options: [2, 3, 10].map(function (n) { return { value: n, label: String(n) }; }),
      onChange: function (v) { player.pause(); setExecutors(st, v); flush(); draw(); } });
    var cFail = C.choice({ label: t("Inject", "Injetar"), value: "none", options: [
      { value: "none", label: t("nothing", "nada") },
      { value: "compile", label: t("account does not compile", "account não compila") },
      { value: "nojob", label: t("no job named account", "sem job account") },
      { value: "creds", label: t("wrong credentials ID", "ID de credencial errado") }
    ], onChange: function (v) { setFailure(st, v); } });
    var jobs = el("div", { class: "csim-row csim-jk-jobs" }, [el("span", { class: "csim-lbl", text: "Build Now:" })].concat(ORDER.map(function (j) {
      return C.button(j, function () { player.pause(); trigger(st, j); flush(); draw(); }, { tone: j.indexOf("-") > 0 ? "ok" : "" });
    })).concat([C.button(t("+5 s", "+5 s"), function () { player.pause(); tick(st); flush(); draw(); })]));

    var player = C.player({ interval: 700, onTick: function (k) { return step(k); }, onPrev: function (k) { replay(k); }, onReset: function () { reset(); } });
    function step(k) {
      if (script === "free") { tick(st); flush(); draw(); return settled(st) ? false : undefined; }
      if (k > steps.length) return false;
      var p = steps[k - 1], ph = SCRIPTS[script];
      if (p >= 0) {
        ph[p].ops.forEach(function (op) { apply(st, op); if (op[0] === "executors") cExec.set(op[1]); if (op[0] === "failure") cFail.set(op[1]); });
        tell([ph[p].en, ph[p].pt], "");
      }
      tick(st);
      flush();
      if (st.stuck) tell(["Stuck: every executor is held by a build waiting for account, and account waits in the queue for an executor. Jenkins waits forever — raise the executors.",
        "Travado: todo executor está preso a um build que espera account e account espera na fila por um executor. O Jenkins espera para sempre — suba os executors."], "bad");
      draw();
    }
    function replay(k) {
      st = create(); term.clear(); logAt = 0; cExec.set(DEFAULT_EXECUTORS); cFail.set("none");
      for (var i = 1; i <= k; i++) step(i);
      if (!k) intro();
      draw();
    }
    function intro() {
      tell(script === "free"
        ? ["Click Build Now on a job; play runs the clock (5 s of build time per step). Change the executors or inject a failure at any time.", "Clique em Build Now num job; o play roda o relógio (5 s de build por passo). Mude os executors ou injete uma falha a qualquer momento."]
        : ["Press play or → to run the case, 5 s of build time per step. The controls work at any time.", "Aperte play ou → para rodar o caso, 5 s de build por passo. Os controles funcionam a qualquer momento."], "");
    }
    function reset() {
      st = create(); term.clear(); logAt = 0;
      cExec.set(DEFAULT_EXECUTORS); cFail.set("none");
      steps = SCRIPTS[script] ? plan(script).steps : [];
      player.total(steps.length);
      intro();
      draw();
    }

    function draw() {
      C.clear(svg);
      var used = slots(st), n = Math.max(st.executors, Object.keys(used).length ? Math.max.apply(null, Object.keys(used).map(Number)) + 1 : 0);
      /* the node and its executors */
      svg.appendChild(s("rect", { x: 4, y: 4, width: 404, height: 100, rx: 8, class: "c-box on" }));
      svg.appendChild(s("text", { x: 14, y: 20, class: "c-label" }, t("Built-In Node · executors: ", "Built-In Node · executors: ") + st.executors));
      for (var i = 0; i < n; i++) {
        var b = used[i], col = i % 5, row = Math.floor(i / 5);
        var x = 12 + col * 79, y = 28 + row * 37;
        var tone = !b ? "on" : b.wait && b.wait.status === "queued" ? "warn" : "hot";
        svg.appendChild(s("rect", { x: x, y: y, width: 75, height: 32, rx: 5, class: "c-box " + tone + (i >= st.executors ? " down" : "") }));
        svg.appendChild(s("text", { x: x + 37.5, y: y + 13, "text-anchor": "middle", class: "c-small" }, b ? b.job : "#" + (i + 1) + t(" idle", " livre")));
        svg.appendChild(s("text", { x: x + 37.5, y: y + 25, "text-anchor": "middle", class: "c-small" + (b && b.wait ? " c-warn" : "") },
          b ? "#" + b.num + (b.wait ? t(" waits ", " espera ") + b.wait.job : "") : ""));
      }
      /* the queue */
      svg.appendChild(s("rect", { x: 418, y: 4, width: 218, height: 100, rx: 8, class: "c-box " + (st.stuck ? "bad" : st.queue.length ? "warn" : "on") }));
      svg.appendChild(s("text", { x: 428, y: 20, class: "c-label" }, t("Build queue", "Fila de builds")));
      if (!st.queue.length) svg.appendChild(s("text", { x: 428, y: 40, class: "c-small" }, t("(empty)", "(vazia)")));
      st.queue.slice(0, 4).forEach(function (q, k) {
        svg.appendChild(s("text", { x: 428, y: 40 + k * 16, class: "c-small c-mono" }, q.job + " #" + q.num));
        svg.appendChild(s("text", { x: 628, y: 40 + k * 16, "text-anchor": "end", class: "c-small c-warn" }, t("waiting for an executor", "esperando executor")));
      });
      if (st.stuck) svg.appendChild(s("text", { x: 428, y: 96, class: "c-small c-bad" }, t("stuck: nobody will free an executor", "travado: ninguém vai liberar um executor")));
      /* the stage view of the last builds */
      var rows = st.builds.slice(-6);
      svg.appendChild(s("text", { x: 6, y: TOP - 2, class: "c-small" }, t("Stage view", "Visão de estágios")));
      rows.forEach(function (b, r) {
        var y = TOP + 6 + r * ROW_H;
        svg.appendChild(s("text", { x: 6, y: y + 16, class: "c-small c-mono" + (b.status === "FAILURE" ? " c-bad" : b.status === "SUCCESS" ? " c-ok" : "") }, b.job + " #" + b.num));
        b.stages.forEach(function (stg, k) {
          var x = 120 + k * (STAGE_W + 4);
          svg.appendChild(s("rect", { x: x, y: y, width: STAGE_W, height: ROW_H - 4, rx: 4, class: "c-box " + TONE[stg] }));
          var label = JOBS[b.job].stages[k].name + (stg === "waiting" ? t(" · waits", " · espera") : stg === "skipped" ? t(" · skipped", " · pulado") : "");
          svg.appendChild(s("text", { x: x + STAGE_W / 2, y: y + 15, "text-anchor": "middle", class: "c-small" }, label));
        });
        if (b.tags) svg.appendChild(s("text", { x: 120 + 3 * (STAGE_W + 4) - 2, y: y + 15, "text-anchor": "start", class: "c-small c-ok" }, ":" + b.num));
      });
      tiles.set("t", st.t + " s", "");
      tiles.set("busy", busy(st) + "/" + st.executors, busy(st) >= st.executors ? "warn" : "");
      tiles.set("queue", String(st.queue.length), st.stuck ? "bad" : st.queue.length ? "warn" : "");
      var done = st.builds.filter(function (b) { return b.end !== undefined; }).sort(function (a, b) { return a.end - b.end; }).pop();
      tiles.set("last", done ? done.job + " #" + done.num + " " + done.status : "–", done ? (done.status === "SUCCESS" ? "ok" : "bad") : "");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's Jenkins, without Docker: executors, the queue and the stages of each pipeline",
        "O Jenkins do lab, sem Docker: executors, a fila e os estágios de cada pipeline") }),
      el("p", { class: "csim-sub", text: t("account and account-service run the lab's Jenkinsfiles; auth and auth-service are the same files for the modules of hands-on 3. A build holds its executor until it ends, also while it waits for a dependency. Durations are illustrative.",
        "account e account-service rodam os Jenkinsfiles do lab; auth e auth-service são os mesmos arquivos para os módulos do hands-on 3. Um build segura o executor até terminar, também enquanto espera uma dependência. As durações são ilustrativas.") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-stage" }, svg),
      jobs,
      el("div", { class: "csim-row" }, [cExec, cFail]),
      note,
      player,
      el("div", { class: "csim-cols" }, [tiles, term])
    ]);
    reset();
    return {};
  });
})();
