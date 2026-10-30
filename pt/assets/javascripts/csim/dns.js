/*
 * DNS caching and the TTL (appendix — network/dns):
 *
 *   <div class="csim" data-sim="dns" data-ttl="300"></div>
 *
 * Clients look up api.example.com through four caching resolvers (two ISPs and two public
 * resolvers), some busy, some quiet: on average 3, 1, 0.5 and 0.2 queries per second, at random
 * (seeded) instants. A resolver answers from its cache while the record's TTL lasts; otherwise it
 * asks the authoritative servers and caches the answer for TTL seconds. The TTL slider sets the
 * TTL that the authoritative servers hand out (answers already cached keep theirs). "Change the
 * IP" moves the name to a new address: every resolver keeps serving the old one until its copy
 * expires, so clients get a stale answer for up to one TTL.
 */
(function () {
  "use strict";

  var OLD_IP = "203.0.113.10", NEW_IP = "203.0.113.20", NAME = "api.example.com";
  var RESOLVERS = [
    { en: "ISP A", pt: "Provedor A", rate: 3 },
    { en: "ISP B", pt: "Provedor B", rate: 1 },
    { en: "public 8.8.8.8", pt: "público 8.8.8.8", rate: 0.5 },
    { en: "public 1.1.1.1", pt: "público 1.1.1.1", rate: 0.2 }
  ];

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* number of queries in one second (Poisson, Knuth's method; the rates are small) */
  function poisson(rand, lambda) {
    var l = Math.exp(-lambda), k = 0, p = 1;
    do { k++; p *= rand(); } while (p > l);
    return k - 1;
  }

  function create(o) {
    o = o || {};
    return {
      t: 0, ttl: o.ttl || 300, ip: OLD_IP, rand: mulberry32(o.seed || 11),
      res: RESOLVERS.map(function (r) { return { rate: r.rate, cache: null, queries: 0, hits: 0, auth: 0 }; }),
      total: { queries: 0, hits: 0, auth: 0, stale: 0 },
      changedAt: null, lastStaleAt: null, lastStaleBy: null, history: []
    };
  }

  /* one second: each resolver answers its clients' queries, in time order */
  function tick(st) {
    var sec = { t: st.t + 1, queries: 0, hits: 0, auth: 0, stale: 0, misses: [] };
    st.res.forEach(function (r, i) {
      var n = poisson(st.rand, r.rate), at = [];
      for (var q = 0; q < n; q++) at.push(st.t + st.rand());
      at.sort(function (a, b) { return a - b; });
      at.forEach(function (when) {
        sec.queries++; r.queries++;
        if (r.cache && r.cache.exp > when) {
          sec.hits++; r.hits++;
          if (r.cache.ip !== st.ip) { sec.stale++; st.lastStaleAt = when; st.lastStaleBy = i; }
        } else {
          sec.auth++; r.auth++;
          r.cache = { ip: st.ip, exp: when + st.ttl };
          if (sec.misses.indexOf(i) < 0) sec.misses.push(i);
        }
      });
    });
    st.t++;
    ["queries", "hits", "auth", "stale"].forEach(function (f) { st.total[f] += sec[f]; });
    st.history.push(sec);
    return sec;
  }

  function changeIp(st) {
    st.ip = st.ip === OLD_IP ? NEW_IP : OLD_IP;
    st.changedAt = st.t;
    st.lastStaleAt = null;
    st.total.stale = 0;
  }

  /* how long after the change the last stale answer was served (null: none yet) */
  function staleFor(st) {
    return st.changedAt === null || st.lastStaleAt === null ? null : st.lastStaleAt - st.changedAt;
  }
  /* the latest moment a resolver can still hand out the old address */
  function staleUntil(st) {
    var m = st.changedAt;
    st.res.forEach(function (r) { if (r.cache && r.cache.ip !== st.ip && r.cache.exp > m) m = r.cache.exp; });
    return m;
  }

  /* run `secs` seconds with a TTL: what the resolvers and the authoritative servers saw */
  function summary(o, secs) {
    var st = create(o);
    for (var i = 0; i < secs; i++) tick(st);
    return { queries: st.total.queries, hits: st.total.hits, auth: st.total.auth, hit: st.total.hits / st.total.queries, st: st };
  }
  /* warm up for `at` seconds, change the IP, run until every cache has expired */
  function changeRun(o, at) {
    var st = create(o);
    for (var i = 0; i < at; i++) tick(st);
    changeIp(st);
    var until = staleUntil(st);
    while (st.t < until + 1) tick(st);
    return { stale: st.total.stale, lastStale: staleFor(st), bound: until - st.changedAt, st: st };
  }

  var API = { create: create, tick: tick, changeIp: changeIp, staleFor: staleFor, staleUntil: staleUntil,
    summary: summary, changeRun: changeRun, poisson: poisson, RESOLVERS: RESOLVERS, OLD_IP: OLD_IP, NEW_IP: NEW_IP, NAME: NAME };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var RY = [18, 66, 114, 162], RX = 150, RW = 150, BAR = 120;

  function num(v) { return v.toLocaleString(C.PT ? "pt-BR" : "en-US"); }
  function pct(f) { var v = (100 * f).toFixed(1); return (C.PT ? v.replace(".", ",") : v) + "%"; }

  C.style("dns", [
    ".md-typeset .csim-dns-bar { fill: var(--c-panel); stroke: var(--c-line); }",
    ".md-typeset .csim-dns-fill { transition: width .25s; }",
    ".md-typeset .csim-dns-fill.fresh { fill: color-mix(in srgb, var(--c-ok) 60%, var(--c-bg)); }",
    ".md-typeset .csim-dns-fill.stale { fill: color-mix(in srgb, var(--c-warn) 70%, var(--c-bg)); }"
  ].join("\n"));

  C.register("dns", function (root) {
    var o = C.opts(root, { ttl: 300 });
    var st, last = null;

    var svg = s("svg", { viewBox: "0 0 520 210", role: "img", "aria-label": t("Clients, caching resolvers and the authoritative servers", "Clientes, resolvedores com cache e os servidores autoritativos") });
    var note = el("p", { class: "csim-note" });
    var lg = C.log(6);
    var tiles = C.stats([
      { key: "q", label: t("queries from clients", "consultas dos clientes") },
      { key: "hit", label: t("answered from cache", "respondidas do cache") },
      { key: "auth", label: t("reached the authoritative servers", "chegaram aos autoritativos") },
      { key: "stale", label: t("old IP served after the change", "IP antigo servido após a mudança") },
      { key: "last", label: t("last old answer, after the change", "última resposta antiga, após a mudança") }
    ]);
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    var ttl = C.slider({ label: "TTL", min: 10, max: 600, step: 10, value: o.ttl, fmt: function (v) { return v + " s"; },
      onInput: function (v) { st.ttl = v; } });
    var bChange = C.button(t("change the IP", "mudar o IP"), function () {
      changeIp(st);
      lg.add("t=" + st.t + "s  " + NAME + " → " + st.ip, "info");
      say(t("The authoritative servers now answer " + st.ip + ". Each resolver keeps its cached copy until it expires: watch the orange bars drain, at most " +
        Math.round(staleUntil(st) - st.t) + " s from now.",
        "Os servidores autoritativos agora respondem " + st.ip + ". Cada resolvedor mantém a cópia em cache até ela expirar: veja as barras laranja esvaziarem, no máximo em " +
        Math.round(staleUntil(st) - st.t) + " s."), "warn");
      draw();
    }, { tone: "bad" });

    var player = C.player({
      interval: 120, speeds: [1, 2, 4, 8],
      label: function () { return "t = " + (st ? st.t : 0) + " s"; },
      onTick: function () {
        last = tick(st);
        last.misses.forEach(function (i) {
          lg.add("t=" + st.t + "s  " + t(RESOLVERS[i].en, RESOLVERS[i].pt) + t(": cache miss → authoritative, cached for ", ": cache vazio → autoritativo, guardado por ") + st.ttl + " s", "");
        });
        if (st.changedAt !== null && last.stale) say(t(last.stale + " client(s) got the old address " + (st.ip === NEW_IP ? OLD_IP : NEW_IP) + " this second, " + (st.t - st.changedAt) + " s after the change.",
          last.stale + " cliente(s) receberam o endereço antigo " + (st.ip === NEW_IP ? OLD_IP : NEW_IP) + " neste segundo, " + (st.t - st.changedAt) + " s após a mudança."), "warn");
        else if (st.changedAt !== null && staleUntil(st) <= st.t && st.t - st.changedAt < 2 * st.ttl + 5)
          say(t("Every cache now holds " + st.ip + ". The last old answer went out " + Math.round(staleFor(st) || 0) + " s after the change, within the TTL.",
            "Todos os caches agora têm " + st.ip + ". A última resposta antiga saiu " + Math.round(staleFor(st) || 0) + " s após a mudança, dentro do TTL."), "ok");
        draw();
      },
      onReset: function () { reset(); }
    });

    function draw() {
      C.clear(svg);
      svg.appendChild(s("rect", { x: 4, y: 70, width: 90, height: 60, rx: 6, class: "c-box" }));
      svg.appendChild(s("text", { x: 49, y: 96, "text-anchor": "middle", class: "c-label" }, t("clients", "clientes")));
      svg.appendChild(s("text", { x: 49, y: 110, "text-anchor": "middle", class: "c-small" }, NAME + "?"));
      var authHot = last && last.auth;
      RESOLVERS.forEach(function (r, i) {
        var y = RY[i], c = st.res[i].cache, live = c && c.exp > st.t;
        var miss = last && last.misses.indexOf(i) >= 0;
        svg.appendChild(s("line", { x1: 94, y1: 100, x2: RX, y2: y + 15, class: "c-wire" }));
        svg.appendChild(s("line", { x1: RX + RW, y1: y + 15, x2: 400, y2: 100, class: "c-wire c-anim" + (miss ? " on" : "") }));
        svg.appendChild(s("rect", { x: RX, y: y, width: RW, height: 34, rx: 5, class: "c-box c-anim" + (miss ? " hot" : "") }));
        svg.appendChild(s("text", { x: RX + 6, y: y + 12, class: "c-small" }, t(r.en, r.pt)));
        svg.appendChild(s("rect", { x: RX + 6, y: y + 18, width: BAR, height: 9, rx: 2, class: "csim-dns-bar" }));
        if (live) {
          var w = Math.max(1, BAR * Math.min(1, (c.exp - st.t) / Math.max(st.ttl, c.exp - st.t)));
          svg.appendChild(s("rect", { x: RX + 6, y: y + 18, width: w, height: 9, rx: 2, class: "csim-dns-fill " + (c.ip === st.ip ? "fresh" : "stale") }));
        }
        svg.appendChild(s("text", { x: RX + RW - 4, y: y + 12, "text-anchor": "end", class: "c-small c-mono" },
          live ? "." + c.ip.split(".").pop() + " · " + Math.ceil(c.exp - st.t) + " s" : t("empty", "vazio")));
      });
      svg.appendChild(s("rect", { x: 400, y: 70, width: 115, height: 60, rx: 6, class: "c-box c-anim" + (authHot ? " on" : "") }));
      svg.appendChild(s("text", { x: 457, y: 90, "text-anchor": "middle", class: "c-label" }, t("authoritative", "autoritativo")));
      svg.appendChild(s("text", { x: 457, y: 104, "text-anchor": "middle", class: "c-small c-mono" }, "A " + st.ip));
      svg.appendChild(s("text", { x: 457, y: 118, "text-anchor": "middle", class: "c-small" }, "TTL " + st.ttl + " s"));

      var T = st.total;
      tiles.set("q", num(T.queries), "");
      tiles.set("hit", T.queries ? pct(T.hits / T.queries) : "–", T.queries ? "ok" : "");
      tiles.set("auth", num(T.auth) + (st.t ? " (" + (Math.round(600 * T.auth / st.t) / 10).toLocaleString(C.PT ? "pt-BR" : "en-US") + "/min)" : ""), "");
      tiles.set("stale", st.changedAt === null ? "–" : num(T.stale), T.stale ? "warn" : st.changedAt === null ? "" : "ok");
      var sf = staleFor(st);
      tiles.set("last", sf === null ? "–" : Math.round(sf) + " s", sf === null ? "" : "warn");
      player.refresh();
    }

    function reset() {
      st = create({ ttl: ttl.get() });
      last = null;
      lg.clear();
      say(t("Four resolvers, about 4.7 queries per second in all. Press play: the first query at each resolver misses, then its cache answers until the TTL runs out.",
        "Quatro resolvedores, cerca de 4,7 consultas por segundo no total. Aperte play: a primeira consulta em cada resolvedor erra, depois o cache responde até o TTL acabar."), "");
      draw();
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("What does the TTL trade off? Load on the authoritative servers vs. stale answers", "O que o TTL troca? Carga nos autoritativos vs. respostas desatualizadas") }),
      el("p", { class: "csim-sub", text: t("Bars: how long each resolver keeps its cached answer (green: current address, orange: the old one). One step = 1 s.",
        "Barras: por quanto tempo cada resolvedor mantém a resposta em cache (verde: endereço atual, laranja: o antigo). Um passo = 1 s.") }),
      el("div", { class: "csim-row" }, [ttl, bChange]),
      el("div", { class: "csim-cols" }, [el("div", { class: "csim-stage" }, svg), el("div", {}, [tiles, lg])]),
      note,
      player
    ]);
    reset();
    return {};
  });
})();
