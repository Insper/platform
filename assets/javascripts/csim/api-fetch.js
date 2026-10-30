/*
 * One screen, two API styles (appendix — REST vs GraphQL):
 *
 *   <div class="csim" data-sim="api-fetch" data-n="10" data-rtt="100" data-mode="seq" data-loader="off"></div>
 *
 * A screen shows a user, their N orders and each order's items. REST fetches it from three
 * resources (GET /users/42, GET /users/42/orders, GET /orders/{id}/items once per order), in
 * sequence or in two parallel waves, and each response carries the full representation. GraphQL
 * sends one query and gets exactly the fields the screen shows, but on the server the resolvers
 * run one database query per order (N + 1) unless a DataLoader batches them into one. The model
 * is deterministic: the waterfall, total latency, bytes downloaded (and how much of it is unused),
 * client round trips and server DB queries all come from the same few illustrative costs below.
 */
(function () {
  "use strict";

  /* illustrative costs, not measurements: app work per request and one DB query (ms) */
  var COST = { app: 4, db: 5 };
  /* bytes: HTTP response headers; [full representation, fields the screen shows] per object */
  var SIZE = { hdr: 300, user: [1000, 100], order: [500, 60], item: [400, 50] };
  var ITEMS = 3;   /* items per order */

  /* REST: one entry per HTTP request; mode "seq" waits for each response, "par" fires in two waves */
  function rest(n, rtt, mode) {
    var par = mode === "par";
    var reqs = [
      { path: "/users/42", wave: 0, full: SIZE.user[0], used: SIZE.user[1] },
      { path: "/users/42/orders", wave: par ? 0 : 1, full: n * SIZE.order[0], used: n * SIZE.order[1] }
    ];
    for (var i = 0; i < n; i++) {
      reqs.push({ path: "/orders/" + (101 + i) + "/items", wave: par ? 1 : 2 + i, full: ITEMS * SIZE.item[0], used: ITEMS * SIZE.item[1] });
    }
    var per = rtt + COST.app + COST.db, waves = 0, payload = 0, used = 0;
    reqs.forEach(function (r) {
      r.start = r.wave * per;
      r.srvStart = r.start + rtt / 2;
      r.srvEnd = r.srvStart + COST.app + COST.db;
      r.end = r.start + per;
      waves = Math.max(waves, r.wave + 1);
      payload += r.full; used += r.used;
    });
    return {
      reqs: reqs, trips: reqs.length, waves: waves, latency: waves * per,
      bytes: payload + reqs.length * SIZE.hdr, payload: payload, used: used, unused: payload - used,
      queries: reqs.length   /* each request runs one query */
    };
  }

  /* GraphQL: one POST; the resolvers run user → orders → items, one query per order unless batched */
  function graphql(n, rtt, loader) {
    var names = ["users", "orders"];
    if (loader) names.push("items (" + n + " ids)");
    else for (var i = 0; i < n; i++) names.push("items #" + (101 + i));
    var t0 = rtt / 2 + COST.app;
    var queries = names.map(function (q, k) { return { name: q, start: t0 + k * COST.db, end: t0 + (k + 1) * COST.db }; });
    var server = COST.app + queries.length * COST.db;
    var used = SIZE.user[1] + n * SIZE.order[1] + n * ITEMS * SIZE.item[1];
    return {
      req: { path: "/graphql", start: 0, srvStart: rtt / 2, srvEnd: rtt / 2 + server, end: rtt + server },
      dbq: queries, trips: 1, waves: 1, latency: rtt + server,
      bytes: used + SIZE.hdr, payload: used, used: used, unused: 0, queries: queries.length
    };
  }

  var API = { rest: rest, graphql: graphql, COST: COST, SIZE: SIZE, ITEMS: ITEMS };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var W = 660, LW = 168, RH = 17, MAXROWS = 9;

  function num(v) { return Math.round(v).toLocaleString(C.PT ? "pt-BR" : "en-US"); }
  function ms(v) { return num(v) + " ms"; }
  function kb(b) { return (b / 1000).toLocaleString(C.PT ? "pt-BR" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " kB"; }
  function pct(f) { return Math.round(100 * f) + "%"; }

  C.style("api-fetch", [
    ".md-typeset .csim-af-net { fill: var(--c-tint2); }",
    ".md-typeset .csim-af-srv { fill: var(--c-ink); }",
    ".md-typeset .csim-af-more { fill: none; stroke: var(--c-fg3); stroke-dasharray: 4 3; }",
    ".md-typeset .csim-af-db { stroke: var(--c-bg); stroke-width: .6; }",
    ".md-typeset .csim-af-head { font-weight: 700; }",
    ".md-typeset .csim-af-axis { stroke: var(--c-line); }",
    ".md-typeset .csim-af-legend { display: flex; flex-wrap: wrap; gap: .2rem .9rem; color: var(--c-fg2); font-size: .6rem; margin-top: .2rem; }",
    ".md-typeset .csim-af-legend i { display: inline-block; width: .8rem; height: .5rem; border-radius: .1rem; margin-right: .3rem; vertical-align: middle; }",
    ".md-typeset .csim-af-legend .net i { background: var(--c-tint2); }",
    ".md-typeset .csim-af-legend .srv i { background: var(--c-ink); }",
    ".md-typeset .csim-af-legend .dbw i { background: var(--c-warn); }",
    ".md-typeset .csim-af-legend .dbo i { background: var(--c-ok); }",
    ".md-typeset .csim-af-h { font-weight: 700; margin: .4rem 0 0; }"
  ].join("\n"));

  C.register("api-fetch", function (root) {
    var o = C.opts(root, { n: 10, rtt: 100, mode: "seq", loader: false });
    var n = o.n, rtt = o.rtt, mode = o.mode === "par" ? "par" : "seq", loader = o.loader;

    var svg = s("svg", { viewBox: "0 0 " + W + " 200", role: "img", "aria-label": t("Request waterfall", "Cascata de requisições") });
    var note = el("p", { class: "csim-note" });
    function tiles() {
      return C.stats([
        { key: "lat", label: t("total latency", "latência total") },
        { key: "trips", label: t("client round trips", "idas e voltas do cliente") },
        { key: "bytes", label: t("downloaded", "baixado") },
        { key: "unused", label: t("unused fields", "campos não usados"), title: t("bytes of fields the screen never shows", "bytes de campos que a tela nunca mostra") },
        { key: "db", label: t("server DB queries", "consultas ao banco") }
      ]);
    }
    var stR = tiles(), stG = tiles();

    var sN = C.slider({ label: t("Orders (N)", "Pedidos (N)"), min: 1, max: 50, value: n, onInput: function (v) { n = v; draw(); } });
    var sR = C.slider({ label: "RTT", min: 10, max: 300, step: 10, value: rtt, fmt: function (v) { return v + " ms"; }, onInput: function (v) { rtt = v; draw(); } });
    var cM = C.choice({
      label: "REST", value: mode,
      options: [{ value: "seq", label: t("sequential", "sequencial") }, { value: "par", label: t("parallel", "paralelo") }],
      onChange: function (v) { mode = v; draw(); }
    });
    var tL = C.toggle({ label: "DataLoader", checked: loader, title: t("batch the items resolver into one query", "agrupa o resolver de itens numa consulta só"),
      onChange: function (v) { loader = v; draw(); } });

    function rows(r) {
      /* long lists: first rows, one dashed row standing for the hidden ones, the last row */
      if (r.reqs.length <= MAXROWS) return r.reqs;
      var head = r.reqs.slice(0, MAXROWS - 2), hidden = r.reqs.slice(MAXROWS - 2, -1), last = r.reqs[r.reqs.length - 1];
      var more = { more: hidden.length, start: Math.min.apply(null, hidden.map(function (q) { return q.start; })),
        end: Math.max.apply(null, hidden.map(function (q) { return q.end; })) };
      return head.concat([more, last]);
    }

    function draw() {
      var R = rest(n, rtt, mode), G = graphql(n, rtt, loader);
      var tmax = Math.max(R.latency, G.latency);
      var x = function (v) { return LW + (W - LW - 8) * v / tmax; };
      var list = rows(R), y = 4, H;
      C.clear(svg);

      function label(text, cls) { svg.appendChild(s("text", { x: 0, y: y + RH - 5, class: cls || "c-mono" }, text)); }
      function bar(q) {
        svg.appendChild(s("rect", { x: x(q.start), y: y + 3, width: Math.max(1, x(q.end) - x(q.start)), height: RH - 6, rx: 2, class: "csim-af-net c-anim" }));
        svg.appendChild(s("rect", { x: x(q.srvStart), y: y + 3, width: Math.max(1, x(q.srvEnd) - x(q.srvStart)), height: RH - 6, class: "csim-af-srv c-anim" }));
      }

      label(t("REST — ", "REST — ") + R.trips + t(" requests", " requisições") + (mode === "par" ? t(", 2 waves", ", 2 ondas") : t(", one after another", ", uma após a outra")), "c-label csim-af-head");
      y += RH;
      list.forEach(function (q) {
        if (q.more) {
          label("… " + q.more + t(" more", " a mais"), "c-small");
          svg.appendChild(s("rect", { x: x(q.start), y: y + 3, width: Math.max(1, x(q.end) - x(q.start)), height: RH - 6, rx: 2, class: "csim-af-more" }));
        } else {
          label("GET " + q.path);
          bar(q);
        }
        y += RH;
      });
      y += 8;
      label(t("GraphQL — 1 request", "GraphQL — 1 requisição"), "c-label csim-af-head");
      y += RH;
      label("POST /graphql");
      bar(G.req);
      y += RH;
      label(t("  DB: ", "  banco: ") + G.queries + t(" queries", " consultas"), "c-small");
      G.dbq.forEach(function (q) {
        svg.appendChild(s("rect", { x: x(q.start), y: y + 3, width: Math.max(1, x(q.end) - x(q.start)), height: RH - 6,
          class: "csim-af-db c-anim " + (loader ? "c-fill-ok" : "c-fill-warn") }, s("title", {}, q.name)));
      });
      y += RH + 6;
      /* time axis */
      svg.appendChild(s("line", { x1: LW, x2: W - 8, y1: y, y2: y, class: "csim-af-axis" }));
      [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
        svg.appendChild(s("line", { x1: x(f * tmax), x2: x(f * tmax), y1: y, y2: y + 4, class: "csim-af-axis" }));
        svg.appendChild(s("text", { x: x(f * tmax), y: y + 14, "text-anchor": f === 1 ? "end" : f === 0 ? "start" : "middle", class: "c-small" }, ms(f * tmax)));
      });
      H = y + 18;
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);

      /* tiles */
      var fastR = R.latency <= G.latency;
      stR.set("lat", ms(R.latency), fastR ? "ok" : R.latency > 2 * G.latency ? "bad" : "warn");
      stG.set("lat", ms(G.latency), !fastR ? "ok" : G.latency > 2 * R.latency ? "bad" : "warn");
      stR.set("trips", num(R.trips) + (mode === "par" ? t(" (2 waves)", " (2 ondas)") : ""), R.waves > 2 ? "bad" : "warn");
      stG.set("trips", "1", "ok");
      stR.set("bytes", kb(R.bytes), R.bytes > 2 * G.bytes ? "warn" : "");
      stG.set("bytes", kb(G.bytes), "ok");
      stR.set("unused", kb(R.unused) + " (" + pct(R.unused / R.payload) + ")", R.unused / R.payload > 0.5 ? "bad" : "warn");
      stG.set("unused", "0 kB", "ok");
      stR.set("db", num(R.queries), R.queries > 3 ? "warn" : "ok");
      stG.set("db", num(G.queries), G.queries > 3 ? "warn" : "ok");

      if (!fastR) {
        note.textContent = loader
          ? t("GraphQL wins: one round trip, exactly the fields the screen shows, and the DataLoader turns " + n + " item lookups into one query (" + G.queries + " in total).",
            "GraphQL ganha: uma ida e volta, só os campos que a tela mostra, e o DataLoader transforma " + n + " buscas de itens numa consulta só (" + G.queries + " no total).")
          : t("GraphQL wins on the network (1 round trip instead of " + R.trips + "), but its resolvers ran " + G.queries + " queries in a row: switch the DataLoader on.",
            "GraphQL ganha na rede (1 ida e volta em vez de " + R.trips + "), mas os resolvers fizeram " + G.queries + " consultas em fila: ligue o DataLoader.");
        note.className = "csim-note " + (loader ? "csim-ok" : "csim-warn");
      } else {
        note.textContent = t("Parallel REST is faster here: two waves of " + ms(rtt + COST.app + COST.db) + " beat one round trip plus " + G.queries +
          " sequential queries on the server. The N + 1 moved from the network to the database.",
          "REST paralelo é mais rápido aqui: duas ondas de " + ms(rtt + COST.app + COST.db) + " vencem uma ida e volta mais " + G.queries +
          " consultas em sequência no servidor. O N + 1 saiu da rede e foi para o banco.");
        note.className = "csim-note csim-bad";
      }
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("How many round trips and bytes does one screen cost?", "Quantas idas e voltas e quantos bytes custa uma tela?") }),
      el("p", { class: "csim-sub", text: t("The screen shows a user, their N orders and the " + ITEMS + " items of each order. Costs are illustrative: " + COST.app + " ms of app work per request, " + COST.db + " ms per DB query.",
        "A tela mostra um usuário, seus N pedidos e os " + ITEMS + " itens de cada pedido. Custos ilustrativos: " + COST.app + " ms de aplicação por requisição, " + COST.db + " ms por consulta ao banco.") }),
      el("div", { class: "csim-row" }, [sN, sR, cM, tL]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-af-legend" }, [
        el("span", { class: "net" }, [el("i"), t("network (RTT)", "rede (RTT)")]),
        el("span", { class: "srv" }, [el("i"), t("server work", "trabalho no servidor")]),
        el("span", { class: "dbw" }, [el("i"), t("one DB query per order (N + 1)", "uma consulta por pedido (N + 1)")]),
        el("span", { class: "dbo" }, [el("i"), t("batched by the DataLoader", "agrupadas pelo DataLoader")])
      ]),
      el("div", { class: "csim-cols" }, [
        el("div", {}, [el("p", { class: "csim-af-h", text: "REST" }), stR]),
        el("div", {}, [el("p", { class: "csim-af-h", text: "GraphQL" }), stG])
      ]),
      note
    ]);
    draw();
    return {};
  });
})();
