/*
 * The responsibility stack (2026.2, class "Service models"):
 *
 *   <div class="csim" data-sim="service-stack" data-model="iaas" data-event=""></div>
 *
 * Six layers, from "Data and access" down to "Hardware", and six models, from on-premises to SaaS.
 * Each layer is operated by you or by the provider, exactly as the page's stack table says; an event
 * from the page's table "Who acts when something happens?" hits one layer, and whoever operates that
 * layer in the chosen model acts. Black Friday hits no layer: it is capacity, and whoever adds machines
 * or instances acts. The tables are copied here as strings (Y = you, P = provider), and
 * scripts/csim/service-stack.test.mjs checks them against both pages and against each other.
 */
(function () {
  "use strict";

  var MODELS = ["onprem", "iaas", "caas", "paas", "faas", "saas"];
  var MODEL_NAMES = { onprem: "On-premises", iaas: "IaaS", caas: "CaaS", paas: "PaaS", faas: "FaaS", saas: "SaaS" };

  /* top to bottom, with the page's names and "In the store" examples; own = the stack table's row */
  var LAYERS = [
    { id: "data", own: "YYYYYY", en: "Data and access", pt: "Dados e acesso",
      exEn: "Orders, accounts, database users, API keys", exPt: "Pedidos, contas, usuários do banco, chaves de API" },
    { id: "app", own: "YYYYYP", en: "Application", pt: "Aplicação", exEn: "The gateway and the services", exPt: "O gateway e os serviços" },
    { id: "mw", own: "YYYPPP", en: "Middleware", pt: "Middleware", exEn: "JDK, web server, Redis", exPt: "JDK, servidor web, Redis" },
    { id: "os", own: "YYPPPP", en: "OS", pt: "SO", exEn: "Linux", exPt: "Linux" },
    { id: "virt", own: "YPPPPP", en: "Virtualisation", pt: "Virtualização", exEn: "KVM, Xen", exPt: "KVM, Xen" },
    { id: "hw", own: "YPPPPP", en: "Hardware", pt: "Hardware", exEn: "The datacentre", exPt: "O datacenter" }
  ];

  /* the page's table "Who acts when something happens?" (acts), and the layer each event hits */
  var EVENTS = [
    { id: "disk", layer: "hw", acts: "YPPPPP", en: "A disk fails", pt: "Um disco falha", shortEn: "Disk fails", shortPt: "Disco falha" },
    { id: "kernel", layer: "os", acts: "YYPPPP", en: "A flaw is found in the Linux kernel", pt: "Descobrem uma falha no kernel do Linux", shortEn: "Kernel flaw", shortPt: "Falha no kernel" },
    { id: "jdk", layer: "mw", acts: "YYYPPP", en: "A flaw is found in the JDK", pt: "Descobrem uma falha no JDK", shortEn: "JDK flaw", shortPt: "Falha no JDK" },
    { id: "peak", layer: null, acts: "YYPPPP", en: "Black Friday: traffic grows tenfold", pt: "Black Friday: o tráfego fica dez vezes maior", shortEn: "Black Friday 10×", shortPt: "Black Friday 10×" },
    { id: "bug", layer: "app", acts: "YYYYYP", en: "A bug in the application", pt: "Um bug na aplicação", shortEn: "App bug", shortPt: "Bug na aplicação" },
    { id: "key", layer: "data", acts: "YYYYYY", en: "An access key leaks", pt: "Uma chave de acesso vaza", shortEn: "Key leaks", shortPt: "Chave vaza" }
  ];

  function col(model) { var i = MODELS.indexOf(model); if (i < 0) throw new Error("unknown model " + model); return i; }
  function layer(id) { return LAYERS.filter(function (l) { return l.id === id; })[0]; }
  function event(id) { return EVENTS.filter(function (e) { return e.id === id; })[0]; }

  /* "you" | "provider" */
  function owner(layerId, model) { return layer(layerId).own[col(model)] === "Y" ? "you" : "provider"; }
  function yours(model) { return LAYERS.filter(function (l) { return owner(l.id, model) === "you"; }).length; }
  function actor(eventId, model) { return event(eventId).acts[col(model)] === "Y" ? "you" : "provider"; }

  /* what the one who acts does (en, pt) */
  function action(eventId, model) {
    var who = actor(eventId, model);
    if (who === "provider" && model === "saas" && eventId !== "bug")
      return ["The SaaS vendor handles it inside its product: your team does nothing.", "O fornecedor do SaaS resolve dentro do produto: seu time não faz nada."];
    switch (eventId) {
      case "disk":
        return who === "you"
          ? ["Your team replaces the disk and restores the data from the RAID or the backup.", "Seu time troca o disco e recupera os dados do RAID ou do backup."]
          : ["The provider replaces it; at most your machine or instance restarts on another host.", "O provedor troca o disco; no máximo sua máquina ou instância reinicia em outro host."];
      case "kernel":
        if (who === "you") return ["Your team patches the kernel and reboots every machine.", "Seu time aplica o patch no kernel e reinicia cada máquina."];
        return model === "caas"
          ? ["The provider patches the OS under your containers. On managed Kubernetes with classic node groups, updating the nodes is still partly your job.",
             "O provedor aplica o patch no SO que roda seus containers. Em Kubernetes gerenciado com node groups clássicos, atualizar os nós ainda é em parte tarefa sua."]
          : ["The provider patches the OS under your code.", "O provedor aplica o patch no SO que roda seu código."];
      case "jdk":
        if (who === "provider") return ["The platform rolls out the patched runtime.", "A plataforma distribui o runtime corrigido."];
        return model === "caas"
          ? ["The JDK is inside your image: your team updates the base image, rebuilds and deploys again.", "O JDK está dentro da sua imagem: seu time atualiza a imagem base, reconstrói e faz o deploy de novo."]
          : ["Your team installs the patched JDK on every machine and restarts the services.", "Seu time instala o JDK corrigido em cada máquina e reinicia os serviços."];
      case "peak":
        if (model === "onprem") return ["Your team would have to buy and install servers, which takes weeks: the capacity must already be there.", "Seu time precisaria comprar e instalar servidores, o que leva semanas: a capacidade já precisa estar lá."];
        if (model === "iaas") return ["Your team starts and configures more VMs, or set up an auto scaling group beforehand.", "Seu time sobe e configura mais VMs ou deixou um auto scaling group pronto antes."];
        if (model === "faas") return ["The platform creates more instances as the calls arrive.", "A plataforma cria mais instâncias conforme as chamadas chegam."];
        return ["The platform adds instances; you still set the limits (the maximum number of replicas).", "A plataforma adiciona instâncias; você ainda define os limites (o máximo de réplicas)."];
      case "bug":
        return who === "you"
          ? ["Your team fixes the code and deploys again.", "Seu time corrige o código e faz o deploy de novo."]
          : ["The vendor fixes its product: you open a ticket and wait.", "O fornecedor corrige o produto: você abre um chamado e espera."];
      case "key":
        return ["Your team revokes the key, issues a new one and checks what it accessed. No model hands this to the provider.",
          "Seu time revoga a chave, emite uma nova e verifica o que ela acessou. Nenhum modelo passa isso para o provedor."];
    }
    return ["", ""];
  }

  var API = { MODELS: MODELS, MODEL_NAMES: MODEL_NAMES, LAYERS: LAYERS, EVENTS: EVENTS, owner: owner, yours: yours, actor: actor, action: action };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  var TOP = 26, ROW = 38, SX = 8, SW = 392, MX = 420, MW = 33, MG = 3;
  var SHORT = { onprem: "On-prem", iaas: "IaaS", caas: "CaaS", paas: "PaaS", faas: "FaaS", saas: "SaaS" };
  function nm(x) { return PT ? x.pt : x.en; }
  function who(w) { return w === "you" ? t("you", "você") : t("provider", "provedor"); }

  C.style("service-stack", [
    ".md-typeset .csim-ss-you { fill: color-mix(in srgb, var(--c-warn) 16%, var(--c-bg)); stroke: var(--c-warn); stroke-width: 1.4; }",
    ".md-typeset .csim-ss-prov { fill: color-mix(in srgb, var(--c-ink) 13%, var(--c-bg)); stroke: var(--c-ink); stroke-width: 1.4; }",
    ".md-typeset .csim-ss-cell { stroke: var(--c-bg); stroke-width: 1; cursor: pointer; transition: opacity .25s; }",
    ".md-typeset .csim-ss-cell.you { fill: var(--c-warn); } .md-typeset .csim-ss-cell.prov { fill: var(--c-ink); }",
    ".md-typeset .csim-ss-cell.dim { opacity: .3; }",
    ".md-typeset .csim-ss-colhead { cursor: pointer; }",
    ".md-typeset .csim-ss-sel { fill: none; stroke: var(--c-fg); stroke-width: 1.6; }",
    ".md-typeset .csim-ss-hit { fill: none; stroke: var(--c-bad); stroke-width: 3; animation: csim-pulse 1s ease-in-out 2; }",
    ".md-typeset .csim-ss-line { stroke: var(--c-fg); stroke-width: 2.2; stroke-dasharray: 6 4; }",
    ".md-typeset .csim-ss-key { display: flex; gap: 1rem; color: var(--c-fg2); margin: .2rem 0; }",
    ".md-typeset .csim-ss-key i { display: inline-block; width: .7rem; height: .7rem; border-radius: .15rem; margin-right: .3rem; vertical-align: -.1rem; }",
    ".md-typeset .csim-ss-key .you i { background: var(--c-warn); } .md-typeset .csim-ss-key .prov i { background: var(--c-ink); }"
  ].join("\n"));

  C.register("service-stack", function (root) {
    var o = C.opts(root, { model: "iaas", event: "" });
    var model = MODELS.indexOf(o.model) >= 0 ? o.model : "iaas";
    var ev = event(o.event) ? o.event : "";

    var svg = s("svg", { viewBox: "0 0 640 " + (TOP + 6 * ROW + 26), role: "img", "aria-label": t("Responsibility stack", "Pilha de responsabilidade") });
    var note = el("p", { class: "csim-note" });
    var lg = C.log(8);
    var st = C.stats([
      { key: "you", label: t("layers you maintain", "camadas que você mantém") },
      { key: "prov", label: t("layers the provider maintains", "camadas que o provedor mantém") },
      { key: "acts", label: t("who acts on the event", "quem age no evento") }
    ]);

    var cModel = C.choice({ label: t("Model", "Modelo"), value: model,
      options: MODELS.map(function (m) { return { value: m, label: MODEL_NAMES[m] }; }),
      onChange: function (m) { pick(m, ev); } });
    var cEvent = C.choice({ label: t("Event", "Evento"), value: ev,
      options: [{ value: "", label: t("none", "nenhum") }].concat(EVENTS.map(function (e) {
        return { value: e.id, label: PT ? e.shortPt : e.shortEn, title: nm(e) };
      })),
      onChange: function (e) { pick(model, e); } });

    function pick(m, e) {
      var changed = m !== model || e !== ev;
      model = m; ev = e;
      cModel.set(m); cEvent.set(e);
      if (ev && changed) {
        var E = event(ev), w = actor(ev, model);
        lg.add(MODEL_NAMES[model] + " · " + nm(E) + " → " + who(w) + " (" + (E.layer ? nm(layer(E.layer)) : t("capacity", "capacidade")) + ")", w === "you" ? "warn" : "info");
      }
      draw();
    }

    function draw() {
      C.clear(svg);
      var n = yours(model), E = ev ? event(ev) : null;
      /* the stack of the chosen model */
      svg.appendChild(s("text", { x: SX, y: 16, class: "c-label" }, MODEL_NAMES[model]));
      LAYERS.forEach(function (l, i) {
        var y = TOP + i * ROW, w = owner(l.id, model);
        svg.appendChild(s("rect", { x: SX, y: y + 2, width: SW, height: ROW - 4, rx: 5, class: "c-anim " + (w === "you" ? "csim-ss-you" : "csim-ss-prov") }));
        svg.appendChild(s("text", { x: SX + 10, y: y + 17, class: "c-label" }, nm(l)));
        svg.appendChild(s("text", { x: SX + 10, y: y + 30, class: "c-small" }, PT ? l.exPt : l.exEn));
        svg.appendChild(s("text", { x: SX + SW - 10, y: y + 23, "text-anchor": "end", class: "c-label " + (w === "you" ? "c-warn" : "c-ink") }, who(w)));
        if (E && E.layer === l.id) {
          svg.appendChild(s("rect", { x: SX - 2, y: y, width: SW + 4, height: ROW, rx: 6, class: "csim-ss-hit" }));
          svg.appendChild(s("text", { x: SX + SW - 70, y: y + 23, "text-anchor": "end", class: "c-small c-bad" }, "⚡ " + (PT ? E.shortPt : E.shortEn)));
        }
      });
      /* the line between what you operate and what the provider operates */
      if (n < LAYERS.length) {
        var ly = TOP + n * ROW;
        svg.appendChild(s("line", { x1: SX - 6, x2: SX + SW + 14, y1: ly, y2: ly, class: "csim-ss-line" }));
      }
      /* every model side by side: the page's table, rows aligned with the stack */
      MODELS.forEach(function (m, j) {
        var x = MX + j * (MW + MG), sel = m === model;
        var head = s("text", { x: x + MW / 2, y: 16, "text-anchor": "middle", class: "c-small csim-ss-colhead" + (sel ? " c-ink" : ""), onclick: function () { pick(m, ev); } }, SHORT[m]);
        svg.appendChild(head);
        LAYERS.forEach(function (l, i) {
          var cell = s("rect", { x: x, y: TOP + i * ROW + 2, width: MW, height: ROW - 4, rx: 3,
            class: "csim-ss-cell " + (owner(l.id, m) === "you" ? "you" : "prov") + (sel ? "" : " dim"), onclick: function () { pick(m, ev); } });
          cell.appendChild(s("title", {}, MODEL_NAMES[m] + " · " + nm(l) + ": " + who(owner(l.id, m))));
          svg.appendChild(cell);
        });
        if (sel) svg.appendChild(s("rect", { x: x - 2, y: TOP, width: MW + 4, height: 6 * ROW, rx: 4, class: "csim-ss-sel" }));
        svg.appendChild(s("text", { x: x + MW / 2, y: TOP + 6 * ROW + 14, "text-anchor": "middle", class: "c-small" }, yours(m) + "/6"));
      });
      if (E && E.layer) {
        var ey = TOP + LAYERS.map(function (l) { return l.id; }).indexOf(E.layer) * ROW;
        svg.appendChild(s("rect", { x: MX - 3, y: ey, width: 6 * (MW + MG) + 3, height: ROW, rx: 4, class: "csim-ss-hit" }));
      }

      st.set("you", n + "/6", "warn");
      st.set("prov", (6 - n) + "/6", "info");
      if (E) {
        var w = actor(ev, model), a = action(ev, model);
        st.set("acts", who(w), w === "you" ? "warn" : "ok");
        note.textContent = !E.layer ? t(
          nm(E) + " → no single layer: it is capacity, and on " + MODEL_NAMES[model] + " " + (w === "you" ? "you add the machines" : "the platform adds the instances") + ". " + a[0],
          nm(E) + " → nenhuma camada só: é capacidade e em " + MODEL_NAMES[model] + " " + (w === "you" ? "você adiciona as máquinas" : "a plataforma adiciona as instâncias") + ". " + a[1]) : t(
          nm(E) + " → on " + MODEL_NAMES[model] + " the " + nm(layer(E.layer)) + " layer is operated by " + (owner(E.layer, model) === "you" ? "you" : "the provider") +
            ", so " + (w === "you" ? "you act" : "the provider acts") + ". " + a[0],
          nm(E) + " → em " + MODEL_NAMES[model] + " a camada " + nm(layer(E.layer)) + " é operada " + (owner(E.layer, model) === "you" ? "por você" : "pelo provedor") +
            ", então " + (w === "you" ? "você age" : "o provedor age") + ". " + a[1]);
        note.className = "csim-note " + (w === "you" ? "csim-warn" : "csim-ok");
      } else {
        st.set("acts", "–", "");
        var mine = LAYERS.filter(function (l) { return owner(l.id, model) === "you"; }).map(nm);
        var theirs = LAYERS.filter(function (l) { return owner(l.id, model) === "provider"; }).map(nm);
        function list(xs, pt) { return xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + (pt ? " e " : " and ") + xs[xs.length - 1]; }
        note.textContent = t(
          "On " + MODEL_NAMES[model] + " your team operates " + n + " of the 6 layers (" + list(mine) + ")" +
            (theirs.length ? "; the provider operates " + list(theirs) + "." : ": there is no provider.") + " Pick an event to see who acts.",
          "Em " + MODEL_NAMES[model] + " seu time opera " + n + " das 6 camadas (" + list(mine, true) + ")" +
            (theirs.length ? "; o provedor opera " + list(theirs, true) + "." : ": não há provedor.") + " Escolha um evento para ver quem age.");
        note.className = "csim-note";
      }
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The responsibility stack: who operates each layer, and who acts when something happens?", "A pilha de responsabilidade: quem opera cada camada e quem age quando algo acontece?") }),
      el("p", { class: "csim-sub", text: t("Left: the stack of the chosen model, with the store's examples. Right: all six models side by side, as in the table above (click a column).",
        "À esquerda, a pilha do modelo escolhido, com os exemplos da loja. À direita, os seis modelos lado a lado, como na tabela acima (clique numa coluna).") }),
      el("div", { class: "csim-row" }, [cModel]),
      el("div", { class: "csim-row" }, [cEvent]),
      el("div", { class: "csim-ss-key" }, [el("span", { class: "you" }, [el("i"), t("you operate it", "você opera")]), el("span", { class: "prov" }, [el("i"), t("the provider operates it", "o provedor opera")])]),
      el("div", { class: "csim-stage" }, svg),
      st,
      note,
      lg
    ]);
    if (ev) pick(model, ev); else draw();
    return {};
  });
})();
