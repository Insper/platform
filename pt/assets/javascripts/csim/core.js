/*
 * Concept simulators (2027.1): the shared core. Each simulator is a module in this folder,
 * <name>.js, placed on a page with
 *
 *   <div class="csim" data-sim="<name>" data-…="…"></div>
 *
 * Only the core is listed in zensical.toml: on each page load (Zensical's document$) it loads the
 * modules that the page uses, once, and each module calls CSim.register(name, mount) and
 * CSim.style(name, css) for its own rules. The core mounts every block, gives the modules small
 * DOM/SVG helpers and the same controls everywhere (a player with play/pause/step/restart and
 * speed, sliders, segmented choices, switches, stat tiles, an event log, a live chart), and
 * picks the interface language from <html lang>. Colors are never written in JavaScript: every
 * element gets a class, and assets/stylesheets/csim.css maps the classes to the page theme
 * (Material's CSS variables), so a palette switch restyles the simulators with no re-render.
 *
 * Modules keep their model in pure functions, exported with module.exports so that
 * node scripts/csim/test.mjs can test them without a browser.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;

  var PT = (document.documentElement.lang || "").indexOf("pt") === 0;
  var SVGNS = "http://www.w3.org/2000/svg";
  var registry = {};
  var mounted = [];
  var requested = {};
  /* the modules sit next to this file */
  var BASE = ((document.currentScript && document.currentScript.src) || "").replace(/core\.js(\?.*)?$/, "");

  function t(en, pt) { return PT ? pt : en; }

  /* el("div", {class: "x", onclick: fn}, [child, "text"]) */
  function build(ns, tag, attrs, kids) {
    var n = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k.slice(0, 2) === "on" && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else n.setAttribute(k, v === true ? "" : v);
    });
    add(n, kids);
    return n;
  }
  function add(n, kids) {
    if (kids === null || kids === undefined || kids === false) return n;
    if (!Array.isArray(kids)) kids = [kids];
    kids.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
    });
    return n;
  }
  function el(tag, attrs, kids) { return build(null, tag, attrs, kids); }
  function s(tag, attrs, kids) { return build(SVGNS, tag, attrs, kids); }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }

  var ICONS = {
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    play: '<path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
    prev: '<path d="m15 18-6-6 6-6"/>'
  };
  function icon(name) {
    return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + "</svg>";
  }

  /* ------------------------------------------------------------------ controls */

  /* A labelled range input; fmt turns the value into the text shown next to it. */
  function slider(o) {
    var out = el("output", { class: "csim-val" });
    var input = el("input", { type: "range", min: o.min, max: o.max, step: o.step || 1, value: o.value, "aria-label": o.label });
    var fmt = o.fmt || String;
    function show() { out.textContent = fmt(+input.value); }
    input.addEventListener("input", function () { show(); if (o.onInput) o.onInput(+input.value); });
    show();
    var wrap = el("label", { class: "csim-ctl csim-slider" }, [el("span", { class: "csim-lbl", text: o.label }), input, out]);
    wrap.get = function () { return +input.value; };
    wrap.set = function (v) { input.value = v; show(); };
    /* change the bounds later (e.g. W and R never above N); the value is clamped */
    wrap.range = function (min, max) {
      if (min !== undefined && min !== null) input.min = min;
      if (max !== undefined && max !== null) input.max = max;
      input.value = Math.min(+input.max, Math.max(+input.min, +input.value));
      show();
    };
    return wrap;
  }

  /* Segmented buttons: one of a few options. */
  function choice(o) {
    var value = o.value;
    var btns = o.options.map(function (opt) {
      return el("button", {
        type: "button", class: "csim-seg-b", "aria-pressed": String(opt.value === value), title: opt.title,
        onclick: function () { wrap.set(opt.value); if (o.onChange) o.onChange(opt.value); }
      }, opt.label);
    });
    var wrap = el("div", { class: "csim-ctl" }, [
      o.label ? el("span", { class: "csim-lbl", text: o.label }) : null,
      el("span", { class: "csim-seg", role: "group" }, btns)
    ]);
    wrap.get = function () { return value; };
    wrap.set = function (v) {
      value = v;
      btns.forEach(function (b, i) { b.setAttribute("aria-pressed", String(o.options[i].value === v)); });
    };
    return wrap;
  }

  /* A switch (checkbox). */
  function toggle(o) {
    var input = el("input", { type: "checkbox", checked: !!o.checked });
    input.addEventListener("change", function () { if (o.onChange) o.onChange(input.checked); });
    var wrap = el("label", { class: "csim-ctl csim-switch", title: o.title }, [input, el("span", { class: "csim-knob" }), el("span", { text: o.label })]);
    wrap.get = function () { return input.checked; };
    wrap.set = function (v) { input.checked = !!v; };
    return wrap;
  }

  /* A plain action button. */
  function button(label, onclick, o) {
    o = o || {};
    return el("button", { type: "button", class: "csim-btn" + (o.tone ? " csim-btn-" + o.tone : ""), title: o.title, onclick: onclick }, label);
  }

  /* Stat tiles: stats([{key, label}]).set(key, value, tone) with tone ok | warn | bad | "" */
  function stats(items) {
    var tiles = {};
    var wrap = el("div", { class: "csim-stats" }, items.map(function (it) {
      var v = el("b", { text: "–" });
      var tile = el("div", { class: "csim-stat", title: it.title }, [v, el("span", { text: it.label })]);
      tiles[it.key] = { tile: tile, v: v };
      return tile;
    }));
    wrap.set = function (key, value, tone) {
      var x = tiles[key];
      if (!x) return;
      x.v.textContent = value;
      x.tile.className = "csim-stat" + (tone ? " csim-" + tone : "");
    };
    return wrap;
  }

  /* An event log, newest first; add(text or node, tone). */
  function log(max) {
    var list = el("ol", { class: "csim-log", "aria-live": "polite" });
    list.add = function (content, tone) {
      var li = el("li", { class: tone ? "csim-" + tone : null }, content);
      list.insertBefore(li, list.firstChild);
      while (list.children.length > (max || 8)) list.removeChild(list.lastChild);
      return li;
    };
    list.clear = function () { clear(list); };
    return list;
  }

  /* A live line chart: chart({series: [{label, cls}], max, len, unit}).push([v1, v2, …]) */
  function chart(o) {
    var W = 320, H = 110, P = { l: 30, r: 6, t: 8, b: 16 };
    var len = o.len || 60;
    var data = o.series.map(function () { return []; });
    var svg = s("svg", { class: "csim-chart", viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": o.title || "" });
    var grid = s("g", { class: "csim-grid" });
    var lines = o.series.map(function (se) { return s("polyline", { class: "csim-line " + (se.cls || "") }); });
    svg.appendChild(grid);
    lines.forEach(function (l) { svg.appendChild(l); });
    var legend = el("div", { class: "csim-legend" }, o.series.map(function (se) {
      return el("span", { class: se.cls || "" }, [el("i"), se.label]);
    }));
    var wrap = el("figure", { class: "csim-fig" }, [o.title ? el("figcaption", { text: o.title }) : null, svg, legend]);
    function max() {
      if (o.max) return o.max;
      var m = 0;
      data.forEach(function (d) { d.forEach(function (v) { if (v > m) m = v; }); });
      return m > 0 ? niceCeil(m) : 1;
    }
    function draw() {
      var m = max();
      clear(grid);
      [0, 0.5, 1].forEach(function (f) {
        var y = P.t + (H - P.t - P.b) * (1 - f);
        grid.appendChild(s("line", { x1: P.l, x2: W - P.r, y1: y, y2: y }));
        grid.appendChild(s("text", { x: P.l - 4, y: y + 3, "text-anchor": "end" }, fmtNum(m * f) + (f === 1 && o.unit ? o.unit : "")));
      });
      data.forEach(function (d, i) {
        var pts = d.map(function (v, j) {
          var x = P.l + (W - P.l - P.r) * (j / Math.max(1, len - 1));
          var y = P.t + (H - P.t - P.b) * (1 - Math.min(1, v / m));
          return x.toFixed(1) + "," + y.toFixed(1);
        });
        lines[i].setAttribute("points", pts.join(" "));
      });
    }
    wrap.push = function (values) {
      values.forEach(function (v, i) { data[i].push(v); if (data[i].length > len) data[i].shift(); });
      draw();
    };
    wrap.reset = function () { data.forEach(function (d) { d.length = 0; }); draw(); };
    draw();
    return wrap;
  }
  function niceCeil(m) {
    var p = Math.pow(10, Math.floor(Math.log10(m)));
    var f = m / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function fmtNum(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(v % 1e3 ? 1 : 0) + "k";
    return String(Math.round(v * 10) / 10);
  }

  /*
   * The player: a clock that calls onTick() every interval while playing, a step button that
   * calls it once, restart (onReset) and a speed choice. With steps: true it also shows a
   * "step i/n" counter (caller passes total via player.total(n)) and a previous button (onPrev).
   */
  function player(o) {
    var speeds = o.speeds || [0.5, 1, 2, 4];
    var speed = 1, timer = null, count = 0, total = 0;
    var bPlay = el("button", { type: "button", class: "csim-play", title: t("Play / pause (space)", "Reproduzir / pausar (espaço)"), html: icon("play") });
    var bNext = el("button", { type: "button", title: t("Step (→)", "Um passo (→)"), html: icon("next") });
    var bPrev = o.onPrev ? el("button", { type: "button", title: t("Previous step (←)", "Passo anterior (←)"), html: icon("prev") }) : null;
    var bReset = el("button", { type: "button", title: t("Restart", "Recomeçar"), html: icon("reset") });
    var counter = el("span", { class: "csim-count" });
    var sp = el("button", { type: "button", class: "csim-speed", title: t("Speed", "Velocidade"), text: "1×" });
    var bar = el("div", { class: "csim-bar" }, [bReset, bPrev, bPlay, bNext, counter, el("span", { class: "csim-fill" }), o.extra || null, sp]);

    function show() {
      bPlay.innerHTML = icon(timer ? "pause" : "play");
      counter.textContent = o.label ? o.label(count, total) : (total ? t("Step ", "Passo ") + count + "/" + total : t("t = ", "t = ") + count);
    }
    function tick() {
      if (!document.contains(bar)) { pause(); return; }   /* the page changed */
      if (total && count >= total) { pause(); return; }
      count++;
      if (o.onTick(count) === false) pause();
      show();
    }
    function play() {
      if (timer) return pause();
      if (total && count >= total) reset();
      timer = setInterval(tick, (o.interval || 700) / speed);
      tick();
      show();
    }
    function pause() { if (timer) clearInterval(timer); timer = null; show(); }
    function reset() { pause(); count = 0; if (o.onReset) o.onReset(); show(); }
    bPlay.onclick = play;
    bNext.onclick = function () { pause(); tick(); };
    if (bPrev) bPrev.onclick = function () { pause(); if (count > 0) { count--; o.onPrev(count); } show(); };
    bReset.onclick = reset;
    sp.onclick = function () {
      speed = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
      sp.textContent = speed + "×";
      if (timer) { clearInterval(timer); timer = setInterval(tick, (o.interval || 700) / speed); }
    };
    /* a custom label usually reads the module's state, which is built after the player: first render later */
    if (o.label) Promise.resolve().then(show); else show();
    bar.play = play; bar.pause = pause; bar.reset = reset; bar.step = function () { pause(); tick(); };
    bar.running = function () { return !!timer; };
    bar.count = function () { return count; };
    bar.total = function (n) { total = n; show(); };
    bar.jump = function (n) { pause(); count = n; show(); };
    bar.refresh = show;
    return bar;
  }

  /* Seeded PRNG (mulberry32), so a run can be replayed. */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* data-* attributes of the block, with defaults: opts(root, {nodes: 4}) → numbers stay numbers */
  function opts(root, defaults) {
    var out = {};
    Object.keys(defaults || {}).forEach(function (k) {
      var raw = root.getAttribute("data-" + k);
      var d = defaults[k];
      if (raw === null) out[k] = d;
      else if (typeof d === "number") out[k] = +raw;
      else if (typeof d === "boolean") out[k] = raw !== "off" && raw !== "false" && raw !== "0";
      else out[k] = raw;
    });
    return out;
  }

  /* ------------------------------------------------------------------ mounting */

  /* A module's own CSS rules, added to the page once. */
  function style(name, css) {
    if (document.getElementById("csim-css-" + name)) return;
    document.head.appendChild(el("style", { id: "csim-css-" + name, text: css }));
  }

  function load(name) {
    if (requested[name] || !/^[a-z0-9-]+$/.test(name)) return;
    requested[name] = true;
    document.head.appendChild(el("script", { src: BASE + name + ".js", async: true,
      onerror: function () { console.warn("csim: no module " + name); } }));
  }

  function register(name, mount) {
    registry[name] = mount;
    if (typeof document$ === "undefined") setTimeout(init, 0);
    else init();
  }

  function init() {
    mounted = mounted.filter(function (m) {
      var alive = document.contains(m.root);
      if (!alive && m.api && m.api.destroy) m.api.destroy();
      return alive;
    });
    document.querySelectorAll("div.csim[data-sim]").forEach(function (root) {
      if (root.getAttribute("data-csim-ready")) return;
      var name = root.getAttribute("data-sim");
      var mount = registry[name];
      if (!mount) { load(name); return; }
      root.setAttribute("data-csim-ready", "1");
      root.tabIndex = 0;
      try {
        mounted.push({ root: root, api: mount(root) || {} });
      } catch (err) {
        console.warn("csim:", root.getAttribute("data-sim"), err);
      }
    });
  }

  /* Keys act on the focused simulator: space plays, arrows step. */
  document.addEventListener("keydown", function (ev) {
    var root = ev.target && ev.target.classList && ev.target.classList.contains("csim") ? ev.target : null;
    if (!root) return;
    var bar = root.querySelector(".csim-bar");
    if (!bar || !bar.play) return;
    if (ev.key === " ") { ev.preventDefault(); bar.play(); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); bar.step(); }
    else if (ev.key === "ArrowLeft") {
      var prev = bar.querySelector("button[title^='" + t("Previous", "Passo anterior") + "']");
      if (prev) { ev.preventDefault(); prev.click(); }
    }
  });

  /* Mount on every page load (instant navigation swaps the content and keeps the window). */
  if (typeof document$ !== "undefined") document$.subscribe(init);
  else document.addEventListener("DOMContentLoaded", init);

  window.CSim = {
    PT: PT, t: t, el: el, s: s, add: add, clear: clear, icon: icon,
    slider: slider, choice: choice, toggle: toggle, button: button, stats: stats, log: log, chart: chart,
    player: player, rng: rng, opts: opts, register: register, style: style, fmtNum: fmtNum
  };
})();
