/*
 * NAT translation table (appendix — network/addressing):
 *
 *   <div class="csim" data-sim="nat" data-timeout="60"></div>
 *
 * A home network (192.168.1.0/24) behind one router with the public address 203.0.113.7. Each
 * outbound connection gets a row in the router's translation table: the private ip:port it came
 * from, the public port the router picked for it, and the remote end. A reply from that remote
 * end is translated back; any other inbound packet is dropped, unless a port-forward rule
 * (a switch) sends that public port to a private host. Rows that stay idle for `timeout` seconds
 * are deleted, and a late reply is dropped too. Optional: data-forward="on".
 */
(function () {
  "use strict";

  var PUBLIC = "203.0.113.7", LAN = "192.168.1.0/24", FIRST_PORT = 40001, STEP = 5;
  /* Linux's default ephemeral range (net.ipv4.ip_local_port_range) */
  var EPH_LO = 32768, EPH_HI = 60999;
  var HOSTS = {
    laptop: { ip: "192.168.1.10", en: "laptop", pt: "notebook" },
    phone: { ip: "192.168.1.11", en: "phone", pt: "celular" },
    nas: { ip: "192.168.1.20", en: "home server", pt: "servidor de casa" }
  };
  var REMOTES = {
    web: { ip: "198.51.100.20", port: 443, proto: "TCP", en: "web server", pt: "servidor web" },
    dns: { ip: "198.51.100.53", port: 53, proto: "UDP", en: "DNS resolver", pt: "resolvedor DNS" }
  };
  var OUTSIDER = { ip: "192.0.2.66", port: 51000 };
  var FORWARD = { port: 8080, host: "nas", inPort: 8080, proto: "TCP" };

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function create(o) {
    o = o || {};
    return { t: 0, timeout: o.timeout || 60, forward: !!o.forward, rand: mulberry32(o.seed || 5),
      next: FIRST_PORT, table: [], last: null, stats: { out: 0, back: 0, fwd: 0, drop: 0 } };
  }

  /* a private host opens a connection: it picks an ephemeral port, the router a public port */
  function open(st, hostKey, remoteKey) {
    var h = HOSTS[hostKey], r = REMOTES[remoteKey];
    var e = { proto: r.proto, host: hostKey, inIp: h.ip, inPort: EPH_LO + Math.floor(st.rand() * (EPH_HI - EPH_LO + 1)),
      pubPort: st.next++, rIp: r.ip, rPort: r.port, remote: remoteKey, last: st.t, born: st.t };
    st.table.push(e);
    st.last = e;
    st.stats.out++;
    return { action: "out", entry: e,
      inside: { src: e.inIp + ":" + e.inPort, dst: e.rIp + ":" + e.rPort },
      outside: { src: PUBLIC + ":" + e.pubPort, dst: e.rIp + ":" + e.rPort } };
  }

  function find(st, pubPort, proto) {
    for (var i = 0; i < st.table.length; i++) if (st.table[i].pubPort === pubPort && st.table[i].proto === proto) return st.table[i];
    return null;
  }

  /* a packet arrives at the public address: translate it back, forward it, or drop it */
  function inbound(st, p) {
    var e = find(st, p.dstPort, p.proto);
    var res = { outside: { src: p.srcIp + ":" + p.srcPort, dst: PUBLIC + ":" + p.dstPort }, inside: null };
    if (e && e.rIp === p.srcIp && e.rPort === p.srcPort) {
      e.last = st.t;
      st.stats.back++;
      res.action = "translated"; res.entry = e;
      res.inside = { src: p.srcIp + ":" + p.srcPort, dst: e.inIp + ":" + e.inPort };
    } else if (e) {
      st.stats.drop++;
      res.action = "dropped"; res.reason = "filtered"; res.entry = e;
    } else if (st.forward && p.dstPort === FORWARD.port && p.proto === FORWARD.proto) {
      st.stats.fwd++;
      res.action = "forwarded";
      res.inside = { src: p.srcIp + ":" + p.srcPort, dst: HOSTS[FORWARD.host].ip + ":" + FORWARD.inPort };
    } else {
      st.stats.drop++;
      res.action = "dropped"; res.reason = "no-entry";
    }
    return res;
  }

  /* the remote end of a connection answers (the row may be gone by now) */
  function reply(st, e) {
    return inbound(st, { srcIp: e.rIp, srcPort: e.rPort, dstPort: e.pubPort, proto: e.proto });
  }
  /* someone on the Internet tries a port of the public address */
  function knock(st, port, proto) {
    return inbound(st, { srcIp: OUTSIDER.ip, srcPort: OUTSIDER.port, dstPort: port, proto: proto || "TCP" });
  }

  /* time passes: rows idle for `timeout` seconds are deleted */
  function advance(st, secs) {
    st.t += secs;
    var gone = st.table.filter(function (e) { return st.t - e.last >= st.timeout; });
    st.table = st.table.filter(function (e) { return st.t - e.last < st.timeout; });
    return gone;
  }

  var API = { create: create, open: open, inbound: inbound, reply: reply, knock: knock, advance: advance,
    PUBLIC: PUBLIC, LAN: LAN, HOSTS: HOSTS, REMOTES: REMOTES, OUTSIDER: OUTSIDER, FORWARD: FORWARD,
    FIRST_PORT: FIRST_PORT, STEP: STEP, EPH_LO: EPH_LO, EPH_HI: EPH_HI };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;

  C.style("nat", [
    ".md-typeset .csim-nat-tbl { width: 100%; border-collapse: collapse; font-family: var(--md-code-font-family); font-size: .6rem; margin: .2rem 0; }",
    ".md-typeset .csim-nat-tbl th, .md-typeset .csim-nat-tbl td { padding: .15rem .35rem; border-bottom: .05rem solid var(--c-line); text-align: left; white-space: nowrap; }",
    ".md-typeset .csim-nat-tbl th { font-family: var(--md-text-font-family); color: var(--c-fg2); font-weight: 600; }",
    ".md-typeset .csim-nat-tbl tr.hl td { background: var(--c-tint); }",
    ".md-typeset .csim-nat-tbl tr.old td { color: var(--c-warn); }",
    ".md-typeset .csim-nat-tbl td.empty { color: var(--c-fg3); font-family: var(--md-text-font-family); }",
    ".md-typeset .csim-nat-wrap { overflow-x: auto; }",
    ".md-typeset .csim-nat-pkt { font-family: var(--md-code-font-family); font-size: .6rem; margin: .3rem 0 0; display: grid; grid-template-columns: auto 1fr; gap: .1rem .5rem; }",
    ".md-typeset .csim-nat-pkt b { font-family: var(--md-text-font-family); color: var(--c-fg2); font-weight: 600; }",
    ".md-typeset .csim-nat-pkt .bad { color: var(--c-bad); font-weight: 700; }",
    ".md-typeset .csim-nat-pkt .ok { color: var(--c-ok); font-weight: 700; }"
  ].join("\n"));

  C.register("nat", function (root) {
    var o = C.opts(root, { timeout: 60, forward: false });
    var st, lastRes = null;

    var svg = s("svg", { viewBox: "0 0 520 200", role: "img", "aria-label": t("Home network, NAT router and the Internet", "Rede de casa, roteador NAT e a Internet") });
    var tableBox = el("div", { class: "csim-nat-wrap" });
    var pkt = el("div", { class: "csim-nat-pkt" });
    var note = el("p", { class: "csim-note" });
    var lg = C.log(6);
    var tiles = C.stats([
      { key: "rows", label: t("rows in the table", "linhas na tabela") },
      { key: "back", label: t("replies translated back", "respostas traduzidas de volta") },
      { key: "drop", label: t("inbound packets dropped", "pacotes de entrada descartados") }
    ]);
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    function hostName(k) { return t(HOSTS[k].en, HOSTS[k].pt); }

    var timeout = C.slider({ label: t("Idle timeout", "Timeout ocioso"), min: 30, max: 300, step: 10, value: o.timeout,
      fmt: function (v) { return v + " s"; }, onInput: function (v) { st.timeout = v; draw(); } });
    var fwd = C.toggle({ label: t("Port forward :8080 → 192.168.1.20:8080", "Redirecionamento :8080 → 192.168.1.20:8080"), checked: o.forward,
      onChange: function (v) {
        st.forward = v;
        say(v ? t("Rule added: packets to " + PUBLIC + ":8080 go to the home server, 192.168.1.20:8080. Try the outsider again.",
          "Regra criada: pacotes para " + PUBLIC + ":8080 vão para o servidor de casa, 192.168.1.20:8080. Tente o estranho de novo.")
          : t("Rule removed: nothing inside can be reached from outside again.", "Regra removida: de novo, nada lá dentro é alcançável de fora."), "");
      } });

    function act(res, text, tone) {
      lastRes = res;
      lg.add("t=" + st.t + "s  " + text, tone);
      draw();
    }
    function connect(hostKey, remoteKey) {
      var r = open(st, hostKey, remoteKey), e = r.entry, rem = REMOTES[remoteKey];
      act(r, hostName(hostKey) + " → " + rem.ip + ":" + rem.port + "  " + t("new row", "nova linha") + " " + e.inIp + ":" + e.inPort + " ⇄ " + PUBLIC + ":" + e.pubPort, "info");
      say(t("The " + hostName(hostKey) + " picked port " + e.inPort + "; the router rewrote the source to " + PUBLIC + ":" + e.pubPort +
        " and wrote the pair down. The " + t(rem.en, rem.pt) + " only ever sees " + PUBLIC + ".",
        "O " + hostName(hostKey) + " escolheu a porta " + e.inPort + "; o roteador trocou a origem por " + PUBLIC + ":" + e.pubPort +
        " e anotou o par. O " + t(rem.en, rem.pt) + " só enxerga " + PUBLIC + "."), "");
    }
    function serverReplies() {
      var e = st.last;
      if (!e) { say(t("Open a connection first: no server has anything to answer.", "Abra uma conexão antes: nenhum servidor tem o que responder."), "warn"); return; }
      var r = reply(st, e);
      if (r.action === "translated") {
        act(r, e.rIp + ":" + e.rPort + " → :" + e.pubPort + "  " + t("translated to", "traduzido para") + " " + r.inside.dst, "ok");
        say(t("Port " + e.pubPort + " is in the table and the packet comes from the right remote end, so the router rewrites the destination back to " +
          r.inside.dst + " (and the row's idle timer restarts).",
          "A porta " + e.pubPort + " está na tabela e o pacote vem da ponta remota certa, então o roteador devolve o destino para " +
          r.inside.dst + " (e o timer ocioso da linha recomeça)."), "ok");
      } else {
        act(r, e.rIp + ":" + e.rPort + " → :" + e.pubPort + "  " + t("dropped: the row expired", "descartado: a linha expirou"), "bad");
        say(t("Too late: the row for :" + e.pubPort + " was deleted after " + st.timeout + " s idle, so the router no longer knows who asked. The reply is dropped.",
          "Tarde demais: a linha de :" + e.pubPort + " foi apagada após " + st.timeout + " s ociosa, e o roteador não sabe mais quem perguntou. A resposta é descartada."), "bad");
      }
    }
    function outsider(port) {
      var r = knock(st, port, "TCP");
      if (r.action === "forwarded") {
        act(r, OUTSIDER.ip + " → :" + port + "  " + t("forwarded to", "redirecionado para") + " " + r.inside.dst, "ok");
        say(t("No row matched, but the port-forward rule did: the packet goes to " + r.inside.dst + ". This is what Docker's ports: \"8080:8080\" sets up on the host.",
          "Nenhuma linha bateu, mas a regra de redirecionamento sim: o pacote vai para " + r.inside.dst + ". É o que o ports: \"8080:8080\" do Docker configura no host."), "ok");
      } else if (r.reason === "filtered") {
        act(r, OUTSIDER.ip + " → :" + port + "  " + t("dropped: row is for", "descartado: a linha é de") + " " + r.entry.rIp, "bad");
        say(t("Port " + port + " is in the table, but only for " + r.entry.rIp + ":" + r.entry.rPort + ". A packet from anyone else is dropped: an open row is not an open door.",
          "A porta " + port + " está na tabela, mas só para " + r.entry.rIp + ":" + r.entry.rPort + ". Um pacote de qualquer outro é descartado: linha aberta não é porta aberta."), "bad");
      } else {
        act(r, OUTSIDER.ip + " → :" + port + "  " + t("dropped: no row", "descartado: sem linha"), "bad");
        say(t("No row has public port " + port + ", so the router has no idea which private host should get this packet. It drops it: outside hosts cannot start a connection.",
          "Nenhuma linha tem a porta pública " + port + ", então o roteador não sabe para qual host privado mandar. Ele descarta: hosts de fora não conseguem iniciar uma conexão."), "bad");
      }
    }

    var player = C.player({
      interval: 600,
      label: function () { return "t = " + (st ? st.t : 0) + " s"; },
      onTick: function () {
        var gone = advance(st, STEP);
        gone.forEach(function (e) {
          lg.add("t=" + st.t + "s  " + t("row expired", "linha expirou") + " " + e.inIp + ":" + e.inPort + " ⇄ :" + e.pubPort, "warn");
        });
        if (gone.length) say(t(gone.length + " row(s) idle for " + st.timeout + " s were deleted. A reply arriving now would be dropped.",
          gone.length + " linha(s) ociosa(s) por " + st.timeout + " s foram apagadas. Uma resposta que chegue agora seria descartada."), "warn");
        draw();
      },
      onReset: function () { reset(); }
    });

    function box(x, y, w, h, cls, lines, title) {
      var g = s("g", {});
      g.appendChild(s("rect", { x: x, y: y, width: w, height: h, rx: 5, class: "c-box c-anim " + cls }));
      lines.forEach(function (l, i) {
        g.appendChild(s("text", { x: x + w / 2, y: y + 15 + i * 12, "text-anchor": "middle", class: i ? "c-small c-mono" : "c-label" }, l));
      });
      if (title) g.appendChild(s("title", {}, title));
      svg.appendChild(g);
    }

    function draw() {
      C.clear(svg);
      var r = lastRes, a = r && r.action;
      var hostY = { laptop: 30, phone: 85, nas: 140 }, remY = { web: 30, dns: 85, out: 140 };
      var activeHost = !r || a === "dropped" ? null : a === "forwarded" ? "nas" : r.entry.host;
      var activeRem = null;
      if (r) {
        var ip = a === "out" ? r.entry.rIp : r.outside.src.split(":")[0];
        activeRem = ip === REMOTES.web.ip ? "web" : ip === REMOTES.dns.ip ? "dns" : "out";
      }
      /* frames */
      svg.appendChild(s("rect", { x: 4, y: 6, width: 160, height: 188, rx: 8, class: "c-box down" }));
      svg.appendChild(s("text", { x: 12, y: 20, class: "c-small" }, t("home network ", "rede de casa ") + LAN));
      svg.appendChild(s("text", { x: 512, y: 20, "text-anchor": "end", class: "c-small" }, "Internet"));
      /* wires */
      Object.keys(hostY).forEach(function (k) {
        var on = activeHost === k && a !== "dropped";
        svg.appendChild(s("line", { x1: 140, y1: hostY[k] + 20, x2: 205, y2: 100, class: "c-wire c-anim" + (on ? " on" : "") }));
      });
      Object.keys(remY).forEach(function (k) {
        var on = activeRem === k, cut = on && a === "dropped";
        svg.appendChild(s("line", { x1: 315, y1: 100, x2: 380, y2: remY[k] + 20, class: "c-wire c-anim" + (cut ? " cut" : on ? " on" : "") }));
      });
      Object.keys(hostY).forEach(function (k) {
        box(20, hostY[k], 120, 40, activeHost === k && a !== "dropped" ? "on" : "", [hostName(k), HOSTS[k].ip]);
      });
      box(205, 70, 110, 60, a === "dropped" ? "bad" : a ? "on" : "", [t("NAT router", "roteador NAT"), "in 192.168.1.1", "out " + PUBLIC]);
      if (a === "dropped") svg.appendChild(s("text", { x: 260, y: 150, "text-anchor": "middle", class: "c-label c-bad" }, t("✕ dropped", "✕ descartado")));
      box(380, remY.web, 130, 40, activeRem === "web" ? (a === "dropped" ? "bad" : "on") : "", [t(REMOTES.web.en, REMOTES.web.pt), REMOTES.web.ip + ":443"]);
      box(380, remY.dns, 130, 40, activeRem === "dns" ? (a === "dropped" ? "bad" : "on") : "", [t(REMOTES.dns.en, REMOTES.dns.pt), REMOTES.dns.ip + ":53"]);
      box(380, remY.out, 130, 40, activeRem === "out" ? (a === "forwarded" ? "on" : "bad") : "", [t("stranger", "estranho"), OUTSIDER.ip]);

      /* the packet, before and after the router */
      C.clear(pkt);
      if (r) {
        var isIn = a !== "out";
        pkt.appendChild(el("b", { text: isIn ? t("arrives", "chega") : t("leaves host", "sai do host") }));
        pkt.appendChild(el("span", { text: isIn ? "src " + r.outside.src + "  dst " + r.outside.dst : "src " + r.inside.src + "  dst " + r.inside.dst }));
        pkt.appendChild(el("b", { text: isIn ? t("delivered", "entregue") : t("leaves router", "sai do roteador") }));
        if (a === "dropped") pkt.appendChild(el("span", { class: "bad", text: t("dropped", "descartado") }));
        else pkt.appendChild(el("span", { class: isIn ? "ok" : "", text: isIn ? "src " + r.inside.src + "  dst " + r.inside.dst : "src " + r.outside.src + "  dst " + r.outside.dst }));
      }

      /* the table */
      C.clear(tableBox);
      var rows = st.table.map(function (e) {
        var idle = st.t - e.last;
        return el("tr", { class: (r && r.entry === e ? "hl" : "") + (idle >= st.timeout - 2 * STEP ? " old" : "") }, [
          el("td", { text: e.proto }), el("td", { text: e.inIp + ":" + e.inPort }), el("td", { text: PUBLIC + ":" + e.pubPort }),
          el("td", { text: e.rIp + ":" + e.rPort }), el("td", { text: idle + " / " + st.timeout + " s" })
        ]);
      });
      if (!rows.length) rows = [el("tr", {}, el("td", { colspan: 5, class: "empty", text: t("empty: no connection open", "vazia: nenhuma conexão aberta") }))];
      tableBox.appendChild(el("div", { class: "csim-lbl", text: t("Translation table", "Tabela de tradução") }));
      tableBox.appendChild(el("table", { class: "csim-nat-tbl" }, [
        el("thead", {}, el("tr", {}, [t("proto", "proto"), t("inside (private)", "dentro (privado)"), t("outside (public)", "fora (público)"), t("remote end", "ponta remota"), t("idle", "ocioso")]
          .map(function (h) { return el("th", { text: h }); }))),
        el("tbody", {}, rows)
      ]));
      tiles.set("rows", String(st.table.length), "");
      tiles.set("back", String(st.stats.back + st.stats.fwd), st.stats.back + st.stats.fwd ? "ok" : "");
      tiles.set("drop", String(st.stats.drop), st.stats.drop ? "bad" : "");
      player.refresh();
    }

    function reset() {
      st = create({ timeout: timeout.get(), forward: fwd.get() });
      lastRes = null;
      lg.clear();
      say(t("Open connections from the home network, then let the server reply, and let a stranger try to get in.",
        "Abra conexões a partir da rede de casa, deixe o servidor responder e veja um estranho tentar entrar."), "");
      draw();
    }

    var bLaptop = C.button(t("laptop → HTTPS", "notebook → HTTPS"), function () { connect("laptop", "web"); });
    var bPhone = C.button(t("phone → HTTPS", "celular → HTTPS"), function () { connect("phone", "web"); });
    var bDns = C.button(t("laptop → DNS (UDP)", "notebook → DNS (UDP)"), function () { connect("laptop", "dns"); });
    var bReply = C.button(t("server replies", "servidor responde"), serverReplies, { tone: "ok" });
    var bOut = C.button(t("stranger → :8080", "estranho → :8080"), function () { outsider(FORWARD.port); }, { tone: "bad" });
    var bOpen = C.button(t("stranger → newest row's port", "estranho → porta da linha mais nova"), function () {
      if (!st.last) { say(t("Open a connection first, so there is a row to aim at.", "Abra uma conexão antes, para haver uma linha como alvo."), "warn"); return; }
      outsider(st.last.pubPort);
    }, { tone: "bad" });

    C.add(root, [
      el("p", { class: "csim-title", text: t("NAT: what does the router write down, and why can't a stranger get in?", "NAT: o que o roteador anota, e por que um estranho não entra?") }),
      el("p", { class: "csim-sub", text: t("Three devices share one public address. Each button sends one packet; play makes time pass (5 s per step) so idle rows expire.",
        "Três dispositivos compartilham um endereço público. Cada botão envia um pacote; o play faz o tempo passar (5 s por passo) e as linhas ociosas expiram.") }),
      el("div", { class: "csim-row" }, [bLaptop, bPhone, bDns, bReply]),
      el("div", { class: "csim-row" }, [bOut, bOpen, fwd]),
      el("div", { class: "csim-row" }, [timeout]),
      el("div", { class: "csim-cols" }, [el("div", { class: "csim-stage" }, [svg, pkt]), el("div", {}, [tiles, tableBox, lg])]),
      note,
      player
    ]);
    reset();
    return {};
  });
})();
