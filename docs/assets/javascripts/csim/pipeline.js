/*
 * CI pipeline as a DAG of jobs (appendix — GitHub Actions):
 *
 *   <div class="csim" data-sim="pipeline" data-cache="off" data-matrix="1" data-fail="none"></div>
 *
 * build → (unit tests, lint, integration tests in parallel) → image → deploy. Each job runs on its own
 * runner once every job in its `needs` succeeded; when a needed job fails, the jobs that need it are
 * skipped and the independent ones still run. The cache shortens the build, the matrix runs the unit
 * tests on 1, 2 or 3 Java versions at once. The player moves the clock; the stats compare the
 * wall-clock time (the critical path) with the runner minutes (the sum of every job).
 */
(function () {
  "use strict";

  /* minutes per job; the cache only saves the dependency download of the build */
  var JOBS = [
    { id: "build", needs: [], dur: 6, cached: 3 },
    { id: "unit", needs: ["build"], dur: 3, matrix: true },
    { id: "lint", needs: ["build"], dur: 1 },
    { id: "integ", needs: ["build"], dur: 5 },
    { id: "image", needs: ["unit", "lint", "integ"], dur: 2 },
    { id: "deploy", needs: ["image"], dur: 1 }
  ];
  var JAVA = { 1: [21], 2: [21, 25], 3: [17, 21, 25] };
  var FAILS = ["none", "build", "unit", "lint", "integ", "image"];

  function job(id) { return JOBS.filter(function (j) { return j.id === id; })[0]; }

  /*
   * plan({cache, matrix, fail}) → {runs, wall, minutes, critical, skipped}
   * runs: one per job (one per Java version for the matrix job):
   *   {job, java, start, end, status: "success" | "failure" | "skipped", decided}
   * A job waits for every job it needs (decided = when the last one finished); it runs if all of them
   * succeeded, else it is skipped at that moment, as GitHub does without `if: always()`.
   */
  function plan(o) {
    o = o || {};
    var matrix = JAVA[o.matrix] ? o.matrix : 1;
    var runs = [], done = {};   /* job id → {end, ok} */
    JOBS.forEach(function (j) {
      var at = 0, ok = true;
      j.needs.forEach(function (n) { at = Math.max(at, done[n].end); if (!done[n].ok) ok = false; });
      var legs = j.matrix ? JAVA[matrix] : [null];
      var dur = j.cached && o.cache ? j.cached : j.dur;
      legs.forEach(function (java) {
        if (ok) runs.push({ job: j.id, java: java, start: at, end: at + dur, decided: at, status: o.fail === j.id ? "failure" : "success" });
        else runs.push({ job: j.id, java: java, start: null, end: null, decided: at, status: "skipped" });
      });
      done[j.id] = ok ? { end: at + dur, ok: o.fail !== j.id } : { end: at, ok: false };
    });
    var wall = 0, minutes = 0;
    runs.forEach(function (r) {
      wall = Math.max(wall, r.end === null ? r.decided : r.end);
      /* GitHub bills each job rounded up to the whole minute */
      if (r.end !== null) minutes += Math.ceil(r.end - r.start);
    });
    return { runs: runs, wall: wall, minutes: minutes, critical: critical(runs),
      skipped: runs.filter(function (r) { return r.status === "skipped"; }).length };
  }

  /* the chain of jobs that sets the wall-clock time: from the last run to finish, back through the need
     that finished last */
  function critical(runs) {
    function endOf(id) {
      var e = -1;
      runs.forEach(function (r) { if (r.job === id && r.end !== null) e = Math.max(e, r.end); });
      return e;
    }
    var last = null, best = -1;
    JOBS.forEach(function (j) { var e = endOf(j.id); if (e >= best && e >= 0) { best = e; last = j.id; } });
    var path = [];
    while (last) {
      path.unshift(last);
      var j = job(last), next = null, e = -1;
      j.needs.forEach(function (n) { var en = endOf(n); if (en > e) { e = en; next = n; } });
      last = next;
    }
    return path;
  }

  /* the state at minute t: each run waiting | running | success | failure | skipped, the runner minutes
     used so far and how many runners are busy */
  function at(p, t) {
    var used = 0, busy = 0;
    var states = p.runs.map(function (r) {
      if (r.status === "skipped") return t >= r.decided ? "skipped" : "waiting";
      used += Math.max(0, Math.min(t, r.end) - r.start);
      if (t < r.start) return "waiting";
      if (t < r.end) { busy++; return "running"; }
      return r.status;
    });
    return { states: states, used: used, busy: busy };
  }

  /* every start, finish and skip, in time order: [{t, i (run index), kind}] */
  function events(p) {
    var out = [];
    p.runs.forEach(function (r, i) {
      if (r.status === "skipped") out.push({ t: r.decided, i: i, kind: "skipped" });
      else { out.push({ t: r.start, i: i, kind: "start" }); out.push({ t: r.end, i: i, kind: r.status }); }
    });
    var order = { failure: 0, success: 0, skipped: 1, start: 2 };
    out.sort(function (a, b) { return a.t - b.t || order[a.kind] - order[b.kind] || a.i - b.i; });
    return out;
  }

  var API = { JOBS: JOBS, JAVA: JAVA, FAILS: FAILS, plan: plan, critical: critical, at: at, events: events };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var STEP = 0.5, SCALE = 15;            /* minutes per tick; minutes shown on the time axis */
  var W = 640, GX = 150, GW = W - GX - 16, ROW = 20, TOP = 150;

  var NAMES = {
    build: t("build", "build"), unit: t("unit tests", "testes unitários"), lint: t("lint", "lint"),
    integ: t("integration tests", "testes de integração"), image: t("image", "imagem"), deploy: t("deploy", "deploy")
  };
  function runName(r) { return NAMES[r.job] + (r.java ? " · Java " + r.java : ""); }
  function num(x) { var v = String(Math.round(x * 10) / 10); return C.PT ? v.replace(".", ",") : v; }
  function x(m) { return GX + GW * m / SCALE; }

  C.style("pipeline", [
    ".md-typeset .csim-pl-bar { transition: width .25s linear; }",
    ".md-typeset .csim-pl-crit { fill: none; stroke: var(--c-fg); stroke-width: 1.6; }",
    ".md-typeset .csim-pl-cursor { stroke: var(--c-accent); stroke-width: 1.5; }",
    ".md-typeset .csim-pl-tick { stroke: var(--c-line); stroke-width: 1; }",
    ".md-typeset .csim-pl-skip { fill: none; stroke: var(--c-fg3); stroke-dasharray: 4 3; }"
  ].join("\n"));

  C.register("pipeline", function (root) {
    var o = C.opts(root, { cache: false, matrix: 1, fail: "none" });
    var cfg = { cache: o.cache, matrix: JAVA[o.matrix] ? o.matrix : 1, fail: FAILS.indexOf(o.fail) >= 0 ? o.fail : "none" };
    var p = plan(cfg), evs = events(p), now = 0;

    var svg = s("svg", { viewBox: "0 0 " + W + " 330", role: "img", "aria-label": t("Workflow jobs and their timeline", "Jobs do workflow e a sua linha do tempo") });
    var note = el("p", { class: "csim-note" });
    var lg = C.log(7);
    var st = C.stats([
      { key: "wall", label: t("wall-clock time", "tempo de relógio"), title: t("what you wait: the critical path", "o que você espera: o caminho crítico") },
      { key: "min", label: t("runner minutes", "minutos de runner"), title: t("what you pay: the sum of every job, each rounded up to the minute", "o que você paga: a soma de todos os jobs, cada um arredondado para cima ao minuto") },
      { key: "busy", label: t("runners busy now", "runners ocupados agora") },
      { key: "skip", label: t("jobs skipped", "jobs pulados") }
    ]);

    var cache = C.toggle({ label: t("cache dependencies", "cache de dependências"), checked: cfg.cache,
      onChange: function (v) { cfg.cache = v; rebuild(); } });
    var matrix = C.choice({ label: t("Java versions (matrix)", "Versões do Java (matriz)"), value: cfg.matrix,
      options: [1, 2, 3].map(function (n) { return { value: n, label: String(n), title: JAVA[n].join(", ") }; }),
      onChange: function (v) { cfg.matrix = v; rebuild(); } });
    var fail = C.choice({ label: t("Fail a job", "Falhar um job"), value: cfg.fail,
      options: FAILS.map(function (f) { return { value: f, label: f === "none" ? t("none", "nenhum") : NAMES[f] }; }),
      onChange: function (v) { cfg.fail = v; rebuild(); } });

    var bar = C.player({
      interval: 450,
      onTick: function (n) { show(n * STEP); },
      onPrev: function (n) { show(n * STEP); },
      onReset: function () { show(0); },
      label: function () { return "t = " + num(now) + " / " + num(p.wall) + " min"; }
    });

    function rebuild() {
      p = plan(cfg); evs = events(p);
      bar.total(Math.ceil(p.wall / STEP));
      bar.reset();
    }

    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    function eventText(e) {
      var r = p.runs[e.i], n = runName(r);
      if (e.kind === "start") return ["▶ " + n + t(": starts on a runner", ": começa num runner"), ""];
      if (e.kind === "success") return ["✓ " + n + t(": succeeded", ": passou") + " (" + num(r.end - r.start) + " min)", "ok"];
      if (e.kind === "failure") return ["✗ " + n + t(": failed", ": falhou"), "bad"];
      return ["– " + n + t(": skipped, a job it needs did not succeed", ": pulado, um job de que ele precisa não passou"), "warn"];
    }

    function show(tt) {
      now = Math.min(tt, p.wall);
      lg.clear();
      evs.forEach(function (e) {
        if (e.t > now) return;
        var ev = eventText(e);
        lg.add(num(e.t) + " min · " + ev[0], ev[1]);
      });
      var a = at(p, now);
      st.set("wall", num(now) + " / " + num(p.wall) + " min", now >= p.wall ? "info" : "");
      st.set("min", num(a.used) + " / " + p.minutes + " min", now >= p.wall && p.minutes > p.wall ? "warn" : "");
      st.set("busy", String(a.busy), a.busy > 1 ? "ok" : "");
      var sk = a.states.filter(function (v) { return v === "skipped"; }).length;
      st.set("skip", String(sk), sk ? "warn" : "");
      narrate(a);
      draw(a);
      bar.refresh();
    }

    function narrate(a) {
      if (now <= 0) {
        say(t("Press play. Jobs with no needs start at once; the others wait for every job they need.",
          "Aperte o play. Jobs sem needs começam na hora; os outros esperam todos os jobs de que precisam."), "");
        return;
      }
      if (now < p.wall) {
        say(a.busy > 1
          ? t(a.busy + " runners work at the same time: the runner minutes grow " + a.busy + "× faster than the clock.",
              a.busy + " runners trabalham ao mesmo tempo: os minutos de runner crescem " + a.busy + "× mais rápido que o relógio.")
          : t("One runner busy: the clock and the runner minutes advance together.",
              "Um runner ocupado: o relógio e os minutos de runner avançam juntos."), "");
        return;
      }
      var path = p.critical.map(function (id) { return NAMES[id]; }).join(" → ");
      var sum = p.critical.map(function (id) { var r = p.runs.filter(function (x) { return x.job === id; })[0]; return num(r.end - r.start); }).join(" + ");
      if (cfg.fail === "none") {
        say(t("Done in " + num(p.wall) + " min, the critical path " + path + " (" + sum + "). The runners worked " + p.minutes +
          " min in total. Shortening a job off this path (lint) would not finish any sooner.",
          "Pronto em " + num(p.wall) + " min, o caminho crítico " + path + " (" + sum + "). Os runners trabalharam " + p.minutes +
          " min no total. Encurtar um job fora desse caminho (lint) não terminaria antes."), "ok");
      } else {
        var skipped = p.runs.filter(function (r) { return r.status === "skipped"; }).map(function (r) { return NAMES[r.job]; });
        var up = {}, todo = [cfg.fail];     /* the failed job's ancestors ran before it, not "anyway" */
        while (todo.length) job(todo.pop()).needs.forEach(function (n) { if (!up[n]) { up[n] = true; todo.push(n); } });
        var ran = p.runs.filter(function (r) { return r.status === "success" && !up[r.job]; }).map(function (r) { return NAMES[r.job]; });
        var uniq = function (l) { return l.filter(function (v, i) { return l.indexOf(v) === i; }); };
        var sk = uniq(skipped).join(", "), rn = uniq(ran).join(", ");
        say(t("The job “" + NAMES[cfg.fail] + "” failed. " + (sk ? "Skipped, because they need it (directly or not): " + sk + ". " : "") +
          (rn ? "Still ran, because they do not need it: " + rn + ". " : "") + "The run ends at " + num(p.wall) + " min.",
          "O job “" + NAMES[cfg.fail] + "” falhou. " + (sk ? "Pulados, porque precisam dele (direta ou indiretamente): " + sk + ". " : "") +
          (rn ? "Rodaram mesmo assim, porque não precisam dele: " + rn + ". " : "") + "A execução termina em " + num(p.wall) + " min."), "bad");
      }
    }

    /* the job state of the DAG node: the worst of its runs */
    function jobState(a, id) {
      var list = [];
      p.runs.forEach(function (r, i) { if (r.job === id) list.push(a.states[i]); });
      ["failure", "running", "skipped", "waiting", "success"].some(function (k) { if (list.indexOf(k) >= 0) { list = k; return true; } return false; });
      return list;
    }
    var BOX = { waiting: "c-box", running: "c-box on", success: "c-box ok", failure: "c-box bad", skipped: "c-box down" };
    var MARK = { waiting: "", running: "…", success: "✓", failure: "✗", skipped: "–" };

    function draw(a) {
      C.clear(svg);
      /* DAG */
      var pos = { build: [20, 52], unit: [210, 12], lint: [210, 52], integ: [210, 92], image: [410, 52], deploy: [530, 52] };
      var wd = { build: 110, unit: 150, lint: 150, integ: 150, image: 90, deploy: 90 }, H = 30;
      JOBS.forEach(function (j) {
        j.needs.forEach(function (n) {
          var from = pos[n], to = pos[j.id], ok = jobState(a, n) === "success";
          svg.appendChild(s("path", { class: "c-wire" + (ok ? " on" : jobState(a, n) === "failure" || jobState(a, n) === "skipped" ? " cut" : ""),
            d: "M" + (from[0] + wd[n]) + "," + (from[1] + H / 2) + " C" + (from[0] + wd[n] + 30) + "," + (from[1] + H / 2) + " " +
              (to[0] - 30) + "," + (to[1] + H / 2) + " " + to[0] + "," + (to[1] + H / 2) }));
        });
      });
      JOBS.forEach(function (j) {
        var q = pos[j.id], js = jobState(a, j.id);
        var label = NAMES[j.id] + (j.matrix && cfg.matrix > 1 ? " ×" + cfg.matrix : "") + (MARK[js] ? " " + MARK[js] : "");
        var g = s("g", {}, [
          s("rect", { x: q[0], y: q[1], width: wd[j.id], height: H, rx: 6, class: BOX[js] + " c-anim" }),
          s("text", { x: q[0] + wd[j.id] / 2, y: q[1] + H / 2 + 4, "text-anchor": "middle", class: "c-label" }, label)
        ]);
        g.appendChild(s("title", {}, "needs: [" + j.needs.join(", ") + "]"));
        svg.appendChild(g);
      });
      /* timeline */
      var rows = p.runs.length, bottom = TOP + rows * ROW;
      for (var m = 0; m <= SCALE; m++) {
        svg.appendChild(s("line", { x1: x(m), x2: x(m), y1: TOP - 4, y2: bottom, class: "csim-pl-tick" }));
        if (m % 3 === 0) svg.appendChild(s("text", { x: x(m), y: bottom + 13, "text-anchor": "middle", class: "c-small" }, m + (m === SCALE ? " min" : "")));
      }
      var done = now >= p.wall;
      p.runs.forEach(function (r, i) {
        var y = TOP + i * ROW, state = a.states[i];
        svg.appendChild(s("text", { x: GX - 8, y: y + 13, "text-anchor": "end", class: "c-small" }, runName(r)));
        if (r.status === "skipped") {
          if (state === "skipped") {
            svg.appendChild(s("rect", { x: x(r.decided), y: y + 3, width: 60, height: ROW - 6, rx: 3, class: "csim-pl-skip" }));
            svg.appendChild(s("text", { x: x(r.decided) + 30, y: y + 13, "text-anchor": "middle", class: "c-small" }, t("skipped", "pulado")));
          }
          return;
        }
        svg.appendChild(s("rect", { x: x(r.start), y: y + 3, width: x(r.end) - x(r.start), height: ROW - 6, rx: 3, class: "c-fill-mute" }));
        var upto = Math.max(r.start, Math.min(now, r.end));
        var cls = state === "running" ? "c-fill-ink" : state === "failure" ? "c-fill-bad" : state === "success" ? "c-fill-ok" : "";
        if (upto > r.start) svg.appendChild(s("rect", { x: x(r.start), y: y + 3, width: x(upto) - x(r.start), height: ROW - 6, rx: 3, class: "csim-pl-bar " + cls }));
        if (done && p.critical.indexOf(r.job) >= 0 && (r.java === null || r.end === Math.max.apply(null, p.runs.filter(function (z) { return z.job === r.job; }).map(function (z) { return z.end; }))))
          svg.appendChild(s("rect", { x: x(r.start), y: y + 2, width: x(r.end) - x(r.start), height: ROW - 4, rx: 3, class: "csim-pl-crit" }));
        svg.appendChild(s("text", { x: x(r.end) + 4, y: y + 13, class: "c-small" }, num(r.end - r.start) + " min"));
      });
      svg.appendChild(s("line", { x1: x(now), x2: x(now), y1: TOP - 8, y2: bottom, class: "csim-pl-cursor" }));
      svg.appendChild(s("text", { x: GX - 8, y: TOP - 10, "text-anchor": "end", class: "c-label" }, t("runners", "runners")));
      if (done) svg.appendChild(s("text", { x: W - 16, y: TOP - 10, "text-anchor": "end", class: "c-small" },
        t("outlined: the critical path", "contornado: o caminho crítico")));
      svg.setAttribute("viewBox", "0 0 " + W + " " + (bottom + 20));
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("CI pipeline: what decides how long it takes, and what runs when a job fails?",
        "Pipeline de CI: o que decide quanto tempo ela leva, e o que roda quando um job falha?") }),
      el("p", { class: "csim-sub", text: t("Top: the jobs and their needs. Bottom: one row per runner over time (faint = planned).",
        "Em cima: os jobs e os seus needs. Embaixo: uma linha por runner ao longo do tempo (claro = planejado).") }),
      el("div", { class: "csim-row" }, [cache, matrix]),
      el("div", { class: "csim-row" }, [fail]),
      el("div", { class: "csim-stage" }, svg),
      st,
      note,
      lg,
      bar
    ]);
    rebuild();
    return {};
  });
})();
