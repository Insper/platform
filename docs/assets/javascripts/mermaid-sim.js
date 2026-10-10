/*
 * Mermaid simulator: renders ``` mermaid-sim blocks and plays them step by
 * step (flowchart edges, sequence messages, state transitions) with
 * play / pause / previous / next controls. Diagrams without a flow (e.g.
 * class diagrams) are rendered statically.
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
        caption: name(e.start) + " → " + name(e.end) + (label ? ": " + label : "")
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
      var caption = useDb
        ? plain(actor(msgs[i].from)) + " → " + plain(actor(msgs[i].to)) + (msgs[i].message ? ": " + plain(msgs[i].message) : "")
        : text(t);
      return { els: [line, t].filter(Boolean), path: line, nodes: [], caption: caption };
    });
  }

  function stateSteps(svg, source) {
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
      var caption = p ? nice(p[1]) + " → " + nice(p[2]) + (p[3] ? ": " + p[3] : "") : text(label);
      return { els: [path, label && label.closest("g.edgeLabel")].filter(Boolean), path: path, nodes: [], caption: caption };
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
    this.rendered = false;
  }

  Sim.prototype.render = function () {
    var self = this;
    self.stop();
    return serial(function () {
      return loadMermaid().then(function (mermaid) {
        var font = getComputedStyle(document.body).fontFamily;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: isDark() ? "dark" : "default", fontFamily: font });
        var id = "msim-" + (++counter);
        return mermaid.render(id, self.source).then(function (out) {
          self.canvas.innerHTML = out.svg;
          var svg = self.canvas.querySelector("svg");
          return mermaid.mermaidAPI.getDiagramFromText(self.source).then(function (diagram) {
            var type = diagram.type || "";
            if (/flowchart|graph/.test(type)) self.steps = flowSteps(svg, diagram.db, id);
            else if (/sequence/.test(type)) self.steps = sequenceSteps(svg, diagram.db);
            else if (/state/.test(type)) self.steps = stateSteps(svg, self.source);
            else self.steps = [];
          });
        });
      });
    }).then(function () {
      self.rendered = true;
      self.svg = self.canvas.querySelector("svg");
      self.buildBar();
      self.idx = -1;
      self.apply();
    }).catch(function (err) {
      self.canvas.innerHTML = '<pre class="msim-error"></pre>';
      self.canvas.firstChild.textContent = self.source;
      console.warn("mermaid-sim:", err);
    });
  };

  Sim.prototype.buildBar = function () {
    var old = this.root.querySelector(".msim-bar");
    if (old) old.remove();
    if (this.steps.length < 2) return;
    var bar = document.createElement("div");
    bar.className = "msim-bar";
    bar.innerHTML =
      '<button type="button" data-msim="reset" title="Restart">' + icon("reset") + "</button>" +
      '<button type="button" data-msim="prev" title="Previous step (←)">' + icon("prev") + "</button>" +
      '<button type="button" data-msim="play" class="msim-play" title="Play / pause (space)">' + icon("play") + "</button>" +
      '<button type="button" data-msim="next" title="Next step (→)">' + icon("next") + "</button>" +
      '<span class="msim-step"></span>' +
      '<span class="msim-caption"></span>' +
      '<button type="button" data-msim="all" title="Show the whole diagram">' + icon("all") + "</button>";
    this.root.appendChild(bar);
    this.bar = bar;
  };

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
        n.classList.toggle("msim-todo", idx >= 0 && !touched.has(n));
        n.classList.toggle("msim-current", idx >= 0 && self.steps[idx].nodes.indexOf(n) >= 0);
      });
    });
    if (self.svg) self.svg.classList.toggle("msim-running", idx >= 0);
    self.dot(idx >= 0 ? self.steps[idx] : null);
    if (!self.bar) return;
    self.bar.querySelector(".msim-step").textContent =
      idx < 0 ? self.steps.length + " steps" : "Step " + (idx + 1) + "/" + self.steps.length;
    self.bar.querySelector(".msim-caption").textContent = idx < 0 ? "Press play to simulate" : self.steps[idx].caption;
    self.bar.querySelector(".msim-play").innerHTML = icon(self.timer ? "pause" : "play");
  };

  /* Moves a dot along the active edge or message. */
  Sim.prototype.dot = function (step) {
    var self = this;
    if (self.raf) cancelAnimationFrame(self.raf);
    if (self.marker) self.marker.remove();
    self.marker = null;
    if (!step || !step.path) return;
    var el = step.path;
    var circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("r", "5");
    circle.setAttribute("class", "msim-dot");
    el.parentNode.appendChild(circle);
    self.marker = circle;
    var point;
    if (el.tagName.toLowerCase() === "line") {
      var x1 = +el.getAttribute("x1"), y1 = +el.getAttribute("y1");
      var x2 = +el.getAttribute("x2"), y2 = +el.getAttribute("y2");
      point = function (t) { return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }; };
    } else {
      var len = el.getTotalLength();
      point = function (t) { return el.getPointAtLength(len * t); };
    }
    var start = performance.now();
    var frame = function (now) {
      var t = Math.min(1, (now - start) / DOT_MS);
      var p = point(1 - Math.pow(1 - t, 2));
      circle.setAttribute("cx", p.x);
      circle.setAttribute("cy", p.y);
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
      if (self.idx >= self.steps.length - 1) return self.stop();
      self.go(self.idx + 1);
    };
    self.timer = setInterval(tick, STEP_MS);
    tick();
  };

  Sim.prototype.stop = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.bar) this.bar.querySelector(".msim-play").innerHTML = icon("play");
  };

  Sim.prototype.action = function (name) {
    if (name === "play") return this.play();
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
