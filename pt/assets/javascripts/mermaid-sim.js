/*
 * Mermaid simulator: renders ``` mermaid-sim blocks and plays them step by
 * step (flowchart edges, sequence messages, state transitions) with
 * play / pause / previous / next / speed controls, a clickable progress bar
 * and a caption that names who talks to whom. Diagrams without a flow (e.g.
 * class diagrams) are rendered statically.
 *
 * Colors follow the page theme: Mermaid's "base" theme gets its variables
 * from Material's CSS variables (resolved to hex, which Mermaid requires),
 * and the diagram is re-rendered when the palette changes.
 *
 * Zensical renders ``` mermaid into a closed shadow root, which page scripts
 * cannot reach, so these blocks use their own fence and are rendered here.
 */
(function () {
  var MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
  var STEP_MS = 1600;
  var DOT_MS = 900;
  var counter = 0;
  var loading = null;
  var queue = Promise.resolve();
  var sims = [];
  var observer = null;

  /* Interface strings follow the page language (<html lang>). */
  var T = (document.documentElement.lang || "").indexOf("pt") === 0 ? {
    steps: "passos", step: "Passo", hint: "Aperte play para simular",
    reset: "Recomeçar", prev: "Passo anterior (←)", play: "Reproduzir / pausar (espaço)",
    next: "Próximo passo (→)", all: "Ver o diagrama inteiro", speed: "Velocidade", goto: "Ir para o passo "
  } : {
    steps: "steps", step: "Step", hint: "Press play to simulate",
    reset: "Restart", prev: "Previous step (←)", play: "Play / pause (space)",
    next: "Next step (→)", all: "Show the whole diagram", speed: "Speed", goto: "Go to step "
  };
  var SPEEDS = [1, 2, 0.5];

  var ICONS = {
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    prev: '<path d="m15 18-6-6 6-6"/>',
    play: '<path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
    all: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
  };

  function icon(name) {
    return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      ICONS[name] + "</svg>";
  }

  function loadMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (!loading) {
      loading = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = MERMAID_URL;
        s.onload = function () { resolve(window.mermaid); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  function isDark() {
    return document.body.getAttribute("data-md-color-scheme") === "slate";
  }

  /* ─── Theme ─── */

  /* A CSS color (any syntax, maybe translucent) as [r, g, b, a], via the browser. */
  var probe = null;
  function rgba(css, scope) {
    if (!probe) { probe = document.createElement("span"); probe.style.display = "none"; }
    (scope || document.body).appendChild(probe);
    probe.style.color = "";
    probe.style.color = css;
    var m = getComputedStyle(probe).color.match(/[\d.]+/g) || [0, 0, 0];
    probe.remove();
    return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]];
  }
  /* c over bg (both [r, g, b, a]) mixed at weight w of c, as #rrggbb */
  function mix(c, bg, w) {
    var a = c[3] * (w === undefined ? 1 : w);
    return "#" + [0, 1, 2].map(function (i) {
      var v = Math.round(c[i] * a + bg[i] * (1 - a));
      return ("0" + v.toString(16)).slice(-2);
    }).join("");
  }

  /* Mermaid "base" theme variables from the page palette. */
  function themeVars() {
    var scope = document.querySelector(".md-typeset") || document.body;
    var v = function (name) { return rgba("var(" + name + ")", scope); };
    var bg = v("--md-default-bg-color");
    bg[3] = 1;
    var ink = v("--md-typeset-a-color"), accent = v("--md-accent-fg-color");
    var fg = v("--md-default-fg-color"), fg2 = v("--md-default-fg-color--light");
    var code = v("--md-code-bg-color");
    var c = {
      bg: mix(bg, bg), fg: mix(fg, bg), fg2: mix(fg2, bg), line: mix(fg, bg, 0.3), faint: mix(fg, bg, 0.12),
      ink: mix(ink, bg), node: mix(ink, bg, isDark() ? 0.2 : 0.09), accent: mix(accent, bg),
      note: mix(accent, bg, isDark() ? 0.22 : 0.1), act: mix(ink, bg, isDark() ? 0.35 : 0.18), code: mix(code, bg)
    };
    return {
      darkMode: isDark(), fontSize: "14px", background: c.bg,
      primaryColor: c.node, primaryBorderColor: c.ink, primaryTextColor: c.fg,
      secondaryColor: c.note, secondaryBorderColor: c.accent, secondaryTextColor: c.fg,
      tertiaryColor: c.code, tertiaryBorderColor: c.line, tertiaryTextColor: c.fg,
      mainBkg: c.node, nodeBorder: c.ink, nodeTextColor: c.fg, textColor: c.fg, titleColor: c.fg,
      lineColor: c.fg2, defaultLinkColor: c.fg2, edgeLabelBackground: c.bg,
      clusterBkg: c.code, clusterBorder: c.line,
      actorBkg: c.node, actorBorder: c.ink, actorTextColor: c.fg, actorLineColor: c.line,
      signalColor: c.fg2, signalTextColor: c.fg, labelBoxBkgColor: c.code, labelBoxBorderColor: c.line,
      labelTextColor: c.fg, loopTextColor: c.fg, noteBkgColor: c.note, noteBorderColor: c.accent, noteTextColor: c.fg,
      activationBkgColor: c.act, activationBorderColor: c.ink, sequenceNumberColor: c.bg,
      labelBackgroundColor: c.bg, compositeBackground: c.code, altBackground: c.faint, compositeTitleBackground: c.code,
      stateLabelColor: c.fg, stateBkg: c.node, transitionColor: c.fg2, transitionLabelColor: c.fg, specialStateColor: c.fg,
      innerEndBackground: c.fg, errorBkgColor: c.note, errorTextColor: c.fg,
      classText: c.fg
    };
  }

  /* mermaid.render is not re-entrant: run renders one at a time. */
  function serial(fn) {
    var run = queue.then(fn, fn);
    queue = run.catch(function () {});
    return run;
  }

  function text(el) {
    return el ? plain(el.textContent) : "";
  }

  /* Label source may carry HTML (<br>) or quotes: keep readable text only. */
  function plain(s) {
    return String(s || "").replace(/<[^>]*>/g, " ").replace(/\\n/g, " ").replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim();
  }

  /* ─── Step extraction ─── */

  function flowSteps(svg, db, id) {
    var vertices = db.getVertices();
    var get = function (k) { return vertices.get ? vertices.get(k) : vertices[k]; };
    var nodes = {};
    svg.querySelectorAll("g.node").forEach(function (n) {
      var m = n.id.match(new RegExp("^" + id + "-flowchart-(.+)-\\d+$"));
      if (m) nodes[m[1]] = n;
    });
    var labels = {};
    svg.querySelectorAll("g.edgeLabel [data-id]").forEach(function (l) {
      labels[l.getAttribute("data-id")] = l.closest("g.edgeLabel");
    });
    var name = function (k) { var v = get(k); return (v && v.text) ? plain(v.text) : k; };
    return db.getEdges().map(function (e) {
      var path = svg.querySelector('path[data-id="' + e.id + '"]');
      if (!path) return null;
      var label = plain(e.text);
      return {
        els: [path, labels[e.id]].filter(Boolean),
        path: path,
        nodes: [nodes[e.start], nodes[e.end]].filter(Boolean),
        who: name(e.start) + " → " + name(e.end), what: label
      };
    }).filter(Boolean);
  }

  function sequenceSteps(svg, db) {
    var lines = svg.querySelectorAll(".messageLine0, .messageLine1");
    var texts = svg.querySelectorAll(".messageText");
    var actors = db.getActors();
    var actor = function (k) { var a = actors.get ? actors.get(k) : actors[k]; return (a && a.description) || k; };
    var msgs = db.getMessages().filter(function (m) { return m.from && m.to && m.type !== 2; });
    var useDb = msgs.length === lines.length;
    return Array.prototype.map.call(lines, function (line, i) {
      var t = texts[i];
      var who = useDb ? plain(actor(msgs[i].from)) + " → " + plain(actor(msgs[i].to)) : "";
      var what = useDb ? plain(msgs[i].message) : text(t);
      var boxes = useDb ? [msgs[i].from, msgs[i].to].reduce(function (acc, a) {
        return acc.concat(Array.prototype.slice.call(svg.querySelectorAll('rect.actor[name="' + cssq(a) + '"]')));
      }, []) : [];
      return { els: [line, t].filter(Boolean), path: line, nodes: boxes, who: who, what: what };
    });
  }

  function cssq(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  function stateSteps(svg, source, id) {
    var nodes = {};
    svg.querySelectorAll("g.node").forEach(function (n) {
      var m = n.id.match(new RegExp("^" + id + "-state-(.+)-\\d+$"));
      if (m) nodes[m[1]] = n;
    });
    var pairs = [];
    source.split("\n").forEach(function (line) {
      var m = line.match(/^\s*([^\s:]+)\s*-->\s*([^\s:]+)\s*(?::\s*(.*))?$/);
      if (m) pairs.push(m);
    });
    var paths = svg.querySelectorAll("path.transition");
    var nice = function (s) { return s === "[*]" ? "●" : s; };
    return Array.prototype.map.call(paths, function (path, i) {
      var id = path.getAttribute("data-id");
      var label = id && svg.querySelector('g.edgeLabel [data-id="' + id + '"]');
      var p = pairs.length === paths.length ? pairs[i] : null;
      return {
        els: [path, label && label.closest("g.edgeLabel")].filter(Boolean), path: path,
        nodes: p ? [nodes[p[1]], nodes[p[2]]].filter(Boolean) : [],
        who: p ? nice(p[1]) + " → " + nice(p[2]) : "", what: p ? plain(p[3] || "") : text(label)
      };
    });
  }

  /* ─── Simulator ─── */

  function Sim(pre) {
    this.source = pre.textContent;
    this.root = document.createElement("div");
    this.root.className = "msim";
    this.root.tabIndex = 0;
    this.canvas = document.createElement("div");
    this.canvas.className = "msim-canvas";
    this.root.appendChild(this.canvas);
    pre.replaceWith(this.root);
    this.steps = [];
    this.idx = -1;      // -1: whole diagram, no simulation
    this.timer = null;
    this.raf = null;
    this.speed = 1;
    this.rendered = false;
  }

  Sim.prototype.render = function () {
    var self = this;
    self.stop();
    return serial(function () {
      return loadMermaid().then(function (mermaid) {
        var font = getComputedStyle(document.body).fontFamily;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: themeVars(), fontFamily: font });
        var id = "msim-" + (++counter);
        return mermaid.render(id, self.source).then(function (out) {
          self.canvas.innerHTML = out.svg;
          var svg = self.canvas.querySelector("svg");
          return mermaid.mermaidAPI.getDiagramFromText(self.source).then(function (diagram) {
            var type = diagram.type || "";
            if (/flowchart|graph/.test(type)) self.steps = flowSteps(svg, diagram.db, id);
            else if (/sequence/.test(type)) self.steps = sequenceSteps(svg, diagram.db);
            else if (/state/.test(type)) self.steps = stateSteps(svg, self.source, id);
            else self.steps = [];
          });
        });
      });
    }).then(function () {
      self.rendered = true;
      self.svg = self.canvas.querySelector("svg");
      var keep = self.idx;
      self.buildBar();
      self.idx = Math.min(keep === undefined ? -1 : keep, self.steps.length - 1);
      self.apply();
    }).catch(function (err) {
      self.canvas.innerHTML = '<pre class="msim-error"></pre>';
      self.canvas.firstChild.textContent = self.source;
      console.warn("mermaid-sim:", err);
    });
  };

  Sim.prototype.buildBar = function () {
    var self = this;
    ["msim-bar", "msim-caption"].forEach(function (c) {
      var old = self.root.querySelector("." + c);
      if (old) old.remove();
    });
    this.bar = null;
    if (this.steps.length < 2) return;
    var bar = document.createElement("div");
    bar.className = "msim-bar";
    var dots = this.steps.map(function (st, i) {
      return '<button type="button" data-msim-go="' + i + '" title="' + T.goto + (i + 1) + (st.what ? ": " + esc(st.what) : "") + '"></button>';
    }).join("");
    bar.innerHTML =
      '<button type="button" data-msim="reset" title="' + T.reset + '">' + icon("reset") + "</button>" +
      '<button type="button" data-msim="prev" title="' + T.prev + '">' + icon("prev") + "</button>" +
      '<button type="button" data-msim="play" class="msim-play" title="' + T.play + '">' + icon("play") + "</button>" +
      '<button type="button" data-msim="next" title="' + T.next + '">' + icon("next") + "</button>" +
      '<span class="msim-step"></span>' +
      '<span class="msim-progress">' + dots + "</span>" +
      '<button type="button" data-msim="speed" class="msim-speed" title="' + T.speed + '">' + this.speed + "×</button>" +
      '<button type="button" data-msim="all" title="' + T.all + '">' + icon("all") + "</button>";
    var cap = document.createElement("div");
    cap.className = "msim-caption";
    cap.setAttribute("aria-live", "polite");
    this.root.appendChild(bar);
    this.root.appendChild(cap);
    this.bar = bar;
    this.cap = cap;
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  Sim.prototype.apply = function () {
    var self = this;
    var idx = self.idx;
    var touched = new Set();
    self.steps.forEach(function (s, i) {
      var state = idx < 0 ? "" : i < idx ? "msim-done" : i === idx ? "msim-active" : "msim-todo";
      s.els.forEach(function (el) {
        el.classList.remove("msim-done", "msim-active", "msim-todo");
        if (state) el.classList.add(state);
      });
      if (idx >= 0 && i <= idx) s.nodes.forEach(function (n) { touched.add(n); });
    });
    self.steps.forEach(function (s) {
      s.nodes.forEach(function (n) {
        var current = idx >= 0 && self.steps[idx].nodes.indexOf(n) >= 0;
        n.classList.toggle("msim-todo", idx >= 0 && !touched.has(n) && !n.classList.contains("actor"));
        n.classList.toggle("msim-seen", idx >= 0 && touched.has(n) && !current);
        n.classList.toggle("msim-current", current);
      });
    });
    if (self.svg) self.svg.classList.toggle("msim-running", idx >= 0);
    self.dot(idx >= 0 ? self.steps[idx] : null);
    if (!self.bar) return;
    self.bar.querySelector(".msim-step").textContent =
      idx < 0 ? self.steps.length + " " + T.steps : (idx + 1) + "/" + self.steps.length;
    self.bar.querySelectorAll("[data-msim-go]").forEach(function (b, i) {
      b.className = idx < 0 ? "" : i < idx ? "done" : i === idx ? "cur" : "";
    });
    self.bar.querySelector(".msim-play").innerHTML = icon(self.timer ? "pause" : "play");
    var st = idx >= 0 ? self.steps[idx] : null;
    self.cap.innerHTML = st
      ? '<span class="msim-num">' + (idx + 1) + "</span>" +
        (st.who ? '<span class="msim-who">' + esc(st.who) + "</span>" : "") +
        (st.what ? '<span class="msim-what">' + esc(st.what) + "</span>" : "")
      : '<span class="msim-hint">' + T.hint + " ▶</span>";
  };

  /* Moves a dot (with a halo) along the active edge or message. */
  Sim.prototype.dot = function (step) {
    var self = this;
    if (self.raf) cancelAnimationFrame(self.raf);
    (self.marker || []).forEach(function (m) { m.remove(); });
    self.marker = null;
    if (!step || !step.path) return;
    var el = step.path;
    var mk = function (r, cls) {
      var c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("r", r);
      c.setAttribute("class", cls);
      el.parentNode.appendChild(c);
      return c;
    };
    var halo = mk(11, "msim-halo"), circle = mk(5, "msim-dot");
    self.marker = [halo, circle];
    var point;
    if (el.tagName.toLowerCase() === "line") {
      var x1 = +el.getAttribute("x1"), y1 = +el.getAttribute("y1");
      var x2 = +el.getAttribute("x2"), y2 = +el.getAttribute("y2");
      point = function (t) { return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }; };
    } else {
      var len = el.getTotalLength();
      point = function (t) { return el.getPointAtLength(len * t); };
    }
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var ms = DOT_MS / self.speed;
    var start = performance.now();
    var frame = function (now) {
      var t = reduce ? 1 : Math.min(1, (now - start) / ms);
      var p = point(1 - Math.pow(1 - t, 2));
      [halo, circle].forEach(function (c) { c.setAttribute("cx", p.x); c.setAttribute("cy", p.y); });
      if (t < 1) self.raf = requestAnimationFrame(frame);
    };
    self.raf = requestAnimationFrame(frame);
  };

  Sim.prototype.go = function (idx) {
    this.idx = Math.max(-1, Math.min(this.steps.length - 1, idx));
    this.apply();
  };

  Sim.prototype.play = function () {
    var self = this;
    if (self.timer) return self.stop();
    if (self.idx < 0 || self.idx >= self.steps.length - 1) self.idx = -1;
    var tick = function () {
      if (!document.contains(self.root) || self.idx >= self.steps.length - 1) return self.stop();
      self.go(self.idx + 1);
    };
    self.timer = setInterval(tick, STEP_MS / self.speed);
    tick();
  };

  Sim.prototype.stop = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.bar) this.bar.querySelector(".msim-play").innerHTML = icon("play");
  };

  Sim.prototype.action = function (name) {
    if (name === "play") return this.play();
    if (name === "speed") {
      this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length];
      this.bar.querySelector(".msim-speed").textContent = this.speed + "×";
      if (this.timer) { this.stop(); this.play(); }
      return;
    }
    this.stop();
    if (name === "next") this.go(this.idx + 1);
    else if (name === "prev") this.go(this.idx - 1);
    else if (name === "reset") this.go(0);
    else if (name === "all") this.go(-1);
  };

  function find(el) {
    for (var i = 0; i < sims.length; i++) if (sims[i].root === el) return sims[i];
    return null;
  }

  /* ─── Wiring ─── */

  document.addEventListener("click", function (ev) {
    var go = ev.target.closest && ev.target.closest(".msim [data-msim-go]");
    if (go) {
      var s = find(go.closest(".msim"));
      if (s) { s.stop(); s.go(+go.getAttribute("data-msim-go")); }
      return;
    }
    var btn = ev.target.closest && ev.target.closest(".msim [data-msim]");
    if (!btn) return;
    var sim = find(btn.closest(".msim"));
    if (sim) sim.action(btn.getAttribute("data-msim"));
  });

  document.addEventListener("keydown", function (ev) {
    var sim = ev.target.classList && ev.target.classList.contains("msim") ? find(ev.target) : null;
    if (!sim || sim.steps.length < 2) return;
    var map = { ArrowRight: "next", ArrowLeft: "prev", " ": "play" };
    if (!map[ev.key]) return;
    ev.preventDefault();
    sim.action(map[ev.key]);
  });

  /* document$ can emit more than once per page: keep simulators that are still
     in the document and only set up blocks that are new. */
  function init() {
    sims = sims.filter(function (s) {
      var alive = document.contains(s.root);
      if (!alive) s.stop();
      return alive;
    });
    var blocks = document.querySelectorAll("pre.mermaid-sim");
    if (!blocks.length) return;
    /* Render lazily: diagrams inside closed tabs or collapsed blocks have no
       size until they become visible. */
    observer = observer || new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        var sim = find(entry.target);
        if (sim && !sim.rendered && !sim.pending) { sim.pending = true; sim.render(); }
      });
    }, { rootMargin: "200px" });
    blocks.forEach(function (pre) {
      var sim = new Sim(pre);
      sims.push(sim);
      observer.observe(sim.root);
    });
    sweep();
  }

  /* Render every diagram that is laid out (not inside a closed tab or a
     collapsed block). The IntersectionObserver alone is not enough: it does
     not fire while the browser tab is in the background. */
  function sweep() {
    sims.forEach(function (s) {
      if (!s.rendered && !s.pending && s.root.offsetParent !== null) {
        s.pending = true;
        s.render();
      }
    });
  }

  /* Opening a content tab or a collapsible block reveals hidden diagrams. */
  document.addEventListener("click", function () { setTimeout(sweep, 50); });
  document.addEventListener("toggle", sweep, true);

  /* Re-render with the matching Mermaid theme when the palette changes. */
  new MutationObserver(function () {
    sims.forEach(function (s) { if (s.rendered) s.render(); });
  }).observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme"] });

  document$.subscribe(init);
})();
