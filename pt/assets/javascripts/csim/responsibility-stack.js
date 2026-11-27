/*
 * Who operates what, and who acts when something happens (2027.1, Cloud native — service models):
 *
 *   <div class="csim" data-sim="responsibility-stack" data-model="caas" data-event=""></div>
 *
 * The page's stack table, copied here as strings: six layers (from "Data and access rules" down to
 * "Virtualization, hardware, data centre") × six models (on-premises to SaaS), each cell operated by
 * you (Y), the provider (P) or shared (S: the OS of the nodes on CaaS). An event hits one layer, and
 * whoever operates that layer in the chosen model acts. The 10:00 on-sale hits the "Container
 * orchestration and scaling" layer: it is a layer of its own in this table, so capacity has an owner
 * like every other event (unlike 2026.2's service-stack, whose Black Friday hit no layer).
 * scripts/csim/responsibility-stack.test.mjs checks the table against both pages.
 */
(function () {
  "use strict";

  var MODELS = ["onprem", "iaas", "caas", "paas", "faas", "saas"];
  var MODEL_NAMES = { onprem: "On-premises", iaas: "IaaS", caas: "CaaS", paas: "PaaS", faas: "FaaS", saas: "SaaS" };

  /* top to bottom, with the page's row names; own = the row of the page's table */
  var LAYERS = [
    { id: "data", own: "YYYYYY", en: "Data and access rules", pt: "Dados e regras de acesso",
      exEn: "orders, seat holds, IAM policies, the tickets bucket", exPt: "pedidos, reservas, políticas de IAM, o bucket de ingressos" },
    { id: "app", own: "YYYYYP", en: "Application code", pt: "Código da aplicação",
      exEn: "catalog, inventory, order…", exPt: "catalog, inventory, order…" },
    { id: "runtime", own: "YYYPPP", en: "Runtime (JVM, Python)", pt: "Runtime (JVM, Python)",
      exEn: "the JDK 21 the services run on", exPt: "o JDK 21 em que os serviços rodam" },
    { id: "orch", own: "YYPPPP", en: "Container orchestration and scaling", pt: "Orquestração de containers e escala",
      exEn: "placing replicas, rollouts, adding capacity", exPt: "posicionar réplicas, rollouts, adicionar capacidade" },
    { id: "os", own: "YYSPPP", en: "Operating system", pt: "Sistema operacional",
      exEn: "Linux on the machines or nodes", exPt: "Linux nas máquinas ou nós" },
    { id: "infra", own: "YPPPPP", en: "Virtualization, hardware, data centre", pt: "Virtualização, hardware, data center",
      exEn: "hypervisor, disks, power, cooling", exPt: "hypervisor, discos, energia, refrigeração" }
  ];

  /* BoxOffice events and the layer each one hits */
  var EVENTS = [
    { id: "disk", layer: "infra", en: "A disk fails under a node", pt: "Um disco falha sob um nó", shortEn: "Disk fails", shortPt: "Disco falha" },
    { id: "kernel", layer: "os", en: "A Linux kernel flaw is published", pt: "Publicam uma falha no kernel do Linux", shortEn: "Kernel flaw", shortPt: "Falha no kernel" },
    { id: "jdk", layer: "runtime", en: "A JDK flaw is published", pt: "Publicam uma falha no JDK", shortEn: "JDK flaw", shortPt: "Falha no JDK" },
    { id: "onsale", layer: "orch", en: "10:00 on-sale: 20× the traffic", pt: "Abertura às 10:00: 20× o tráfego", shortEn: "On-sale 20×", shortPt: "Abertura 20×" },
    { id: "bug", layer: "app", en: "A bug in inventory expires holds early", pt: "Um bug no inventory expira reservas cedo demais", shortEn: "Bug in inventory", shortPt: "Bug no inventory" },
    { id: "bucket", layer: "data", en: "The tickets bucket is made public", pt: "O bucket de ingressos fica público", shortEn: "Public bucket", shortPt: "Bucket público" }
  ];

  function col(model) { var i = MODELS.indexOf(model); if (i < 0) throw new Error("unknown model " + model); return i; }
  function layer(id) { return LAYERS.filter(function (l) { return l.id === id; })[0]; }
  function event(id) { return EVENTS.filter(function (e) { return e.id === id; })[0]; }

  var WHO = { Y: "you", P: "provider", S: "shared" };
  /* "you" | "provider" | "shared" */
  function owner(layerId, model) { return WHO[layer(layerId).own[col(model)]]; }
  function count(model, who) { return LAYERS.filter(function (l) { return owner(l.id, model) === who; }).length; }
  function yours(model) { return count(model, "you"); }
  function actor(eventId, model) { return owner(event(eventId).layer, model); }

  /* what the one who acts does (en, pt) */
  function action(eventId, model) {
    var who = actor(eventId, model);
    if (model === "saas" && who === "provider")
      return eventId === "bug"
        ? ["The vendor fixes its product: you open a ticket, and your adapter copes meanwhile.", "O fornecedor corrige o produto: você abre um chamado e seu adaptador se vira enquanto isso."]
        : eventId === "onsale"
          ? ["The vendor scales its product; at most you hit its rate limit (the payment provider's requests per second).", "O fornecedor escala o produto; no máximo você esbarra no limite de taxa dele (as requisições por segundo do provedor de pagamento)."]
          : ["The SaaS vendor handles it inside its product: your team does nothing.", "O fornecedor do SaaS resolve dentro do produto: seu time não faz nada."];
    switch (eventId) {
      case "disk":
        return who === "you"
          ? ["Your team replaces the disk and restores the data from a replica or the backup.", "Seu time troca o disco e recupera os dados de uma réplica ou do backup."]
          : ["The provider replaces it; at most a VM or node restarts on another host, and your other replicas cover for it.", "O provedor troca o disco; no máximo uma VM ou um nó reinicia em outro host e suas outras réplicas cobrem a falta."];
      case "kernel":
        if (who === "you") return ["Your team patches the kernel and reboots every machine, one at a time.", "Seu time aplica o patch no kernel e reinicia cada máquina, uma de cada vez."];
        if (who === "shared") return ["Shared: the provider publishes a patched node image; with classic node groups your team rolls the nodes onto it (drain, replace), with Fargate or GKE Autopilot the provider does it all.",
          "Compartilhado: o provedor publica uma imagem de nó corrigida; com node groups clássicos seu time troca os nós por ela (drain, substituição), com Fargate ou GKE Autopilot o provedor faz tudo."];
        return ["The provider patches the hosts under your code and restarts your instances gradually.", "O provedor aplica o patch nos hosts que rodam seu código e reinicia suas instâncias aos poucos."];
      case "jdk":
        if (who === "provider") return ["The platform rolls out the patched runtime; at most you redeploy.", "A plataforma distribui o runtime corrigido; no máximo você faz um novo deploy."];
        return model === "caas"
          ? ["The JDK is inside your image: your team bumps the base image, rebuilds and rolls out every service.", "O JDK está dentro da sua imagem: seu time atualiza a imagem base, reconstrói e faz o rollout de cada serviço."]
          : ["Your team installs the patched JDK on every machine and restarts the services.", "Seu time instala o JDK corrigido em cada máquina e reinicia os serviços."];
      case "onsale":
        if (model === "onprem") return ["The servers must already be there: buying more takes weeks, so the peak's capacity was bought months ahead and idles the rest of the month (the CapEx of FinOps).",
          "Os servidores já precisam estar lá: comprar mais leva semanas, então a capacidade do pico foi comprada meses antes e fica ociosa o resto do mês (o CapEx da página de FinOps)."];
        if (model === "iaas") return ["Your team starts more VMs and installs the services on them, or set up an auto scaling group beforehand.", "Seu time sobe mais VMs e instala os serviços nelas ou deixou um auto scaling group pronto antes."];
        if (model === "caas") return ["The control plane adds pods and nodes (HPA, node autoscaler), but only within the rules your team wrote: minReplicas, maxReplicas and the pre-scale at 09:45.",
          "O control plane adiciona pods e nós (HPA, autoscaler de nós), mas só dentro das regras que seu time escreveu: minReplicas, maxReplicas e o pré-escalonamento às 09:45."];
        if (model === "faas") return ["The platform starts more function instances as the calls arrive, up to the concurrency limit; the first ones pay a cold start.", "A plataforma sobe mais instâncias da função conforme as chamadas chegam, até o limite de concorrência; as primeiras pagam um cold start."];
        return ["The platform adds instances, within the minimum and maximum your team configured.", "A plataforma adiciona instâncias, dentro do mínimo e do máximo que seu time configurou."];
      case "bug":
        return ["Your team fixes the code and ships it through the pipeline, behind a canary.", "Seu time corrige o código e o entrega pelo pipeline, atrás de um canary."];
      case "bucket":
        return ["Your team blocks public access, rotates what leaked and reads the access logs. No model hands your data and access rules to the provider.",
          "Seu time bloqueia o acesso público, troca o que vazou e lê os logs de acesso. Nenhum modelo passa seus dados e regras de acesso para o provedor."];
    }
    return ["", ""];
  }

  var API = { MODELS: MODELS, MODEL_NAMES: MODEL_NAMES, LAYERS: LAYERS, EVENTS: EVENTS, owner: owner, count: count, yours: yours, actor: actor, action: action };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  var TOP = 26, ROW = 38, SX = 8, SW = 392, MX = 420, MW = 33, MG = 3;
  var SHORT = { onprem: "On-prem", iaas: "IaaS", caas: "CaaS", paas: "PaaS", faas: "FaaS", saas: "SaaS" };
  var CLS = { you: "you", provider: "prov", shared: "shared" };
  var TONE = { you: "warn", provider: "ok", shared: "warn" };
  function nm(x) { return PT ? x.pt : x.en; }
  function who(w) { return w === "you" ? t("you", "você") : w === "shared" ? t("shared", "compartilhado") : t("provider", "provedor"); }

  C.style("responsibility-stack", [
    ".md-typeset .csim-rs-you { fill: color-mix(in srgb, var(--c-warn) 16%, var(--c-bg)); stroke: var(--c-warn); stroke-width: 1.4; }",
    ".md-typeset .csim-rs-prov { fill: color-mix(in srgb, var(--c-ink) 13%, var(--c-bg)); stroke: var(--c-ink); stroke-width: 1.4; }",
    ".md-typeset .csim-rs-shared { fill: color-mix(in srgb, var(--c-warn) 8%, color-mix(in srgb, var(--c-ink) 8%, var(--c-bg))); stroke: var(--c-warn); stroke-width: 1.4; stroke-dasharray: 5 3; }",
    ".md-typeset .csim-rs-cell { stroke: var(--c-bg); stroke-width: 1; cursor: pointer; transition: opacity .25s; }",
    ".md-typeset .csim-rs-cell.you { fill: var(--c-warn); } .md-typeset .csim-rs-cell.prov { fill: var(--c-ink); }",
    ".md-typeset .csim-rs-cell.shared { fill: color-mix(in srgb, var(--c-warn) 50%, var(--c-ink)); }",
    ".md-typeset .csim-rs-cell.dim { opacity: .3; }",
    ".md-typeset .csim-rs-colhead { cursor: pointer; }",
    ".md-typeset .csim-rs-sel { fill: none; stroke: var(--c-fg); stroke-width: 1.6; }",
    ".md-typeset .csim-rs-hit { fill: none; stroke: var(--c-bad); stroke-width: 3; animation: csim-pulse 1s ease-in-out 2; }",
    ".md-typeset .csim-rs-line { stroke: var(--c-fg); stroke-width: 2.2; stroke-dasharray: 6 4; }",
    ".md-typeset .csim-rs-key { display: flex; flex-wrap: wrap; gap: 1rem; color: var(--c-fg2); margin: .2rem 0; }",
    ".md-typeset .csim-rs-key i { display: inline-block; width: .7rem; height: .7rem; border-radius: .15rem; margin-right: .3rem; vertical-align: -.1rem; }",
    ".md-typeset .csim-rs-key .you i { background: var(--c-warn); } .md-typeset .csim-rs-key .prov i { background: var(--c-ink); }",
    ".md-typeset .csim-rs-key .shared i { background: color-mix(in srgb, var(--c-warn) 50%, var(--c-ink)); }"
  ].join("\n"));

  C.register("responsibility-stack", function (root) {
    var o = C.opts(root, { model: "caas", event: "" });
    var model = MODELS.indexOf(o.model) >= 0 ? o.model : "caas";
    var ev = event(o.event) ? o.event : "";

    var svg = s("svg", { viewBox: "0 0 640 " + (TOP + 6 * ROW + 26), role: "img", "aria-label": t("Responsibility stack", "Pilha de responsabilidade") });
    var note = el("p", { class: "csim-note" });
    var lg = C.log(8);
    var st = C.stats([
      { key: "you", label: t("layers your team operates", "camadas que seu time opera") },
      { key: "prov", label: t("layers the provider operates", "camadas que o provedor opera") },
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
        lg.add(MODEL_NAMES[model] + " · " + nm(E) + " → " + who(w) + " (" + nm(layer(E.layer)) + ")", w === "provider" ? "info" : "warn");
      }
      draw();
    }

    function youText(m) {
      var n = yours(m), sh = count(m, "shared");
      return n + "/6" + (sh ? t(" + " + sh + " shared", " + " + sh + " compart.") : "");
    }

    function draw() {
      C.clear(svg);
      var n = yours(model), E = ev ? event(ev) : null;
      svg.appendChild(s("text", { x: SX, y: 16, class: "c-label" }, MODEL_NAMES[model]));
      LAYERS.forEach(function (l, i) {
        var y = TOP + i * ROW, w = owner(l.id, model);
        svg.appendChild(s("rect", { x: SX, y: y + 2, width: SW, height: ROW - 4, rx: 5, class: "c-anim csim-rs-" + CLS[w] }));
        svg.appendChild(s("text", { x: SX + 10, y: y + 17, class: "c-label" }, nm(l)));
        svg.appendChild(s("text", { x: SX + 10, y: y + 30, class: "c-small" }, PT ? l.exPt : l.exEn));
        svg.appendChild(s("text", { x: SX + SW - 10, y: y + 23, "text-anchor": "end", class: "c-label " + (w === "provider" ? "c-ink" : "c-warn") }, who(w)));
        if (E && E.layer === l.id) {
          svg.appendChild(s("rect", { x: SX - 2, y: y, width: SW + 4, height: ROW, rx: 6, class: "csim-rs-hit" }));
          svg.appendChild(s("text", { x: SX + SW - 10, y: y + 11, "text-anchor": "end", class: "c-small c-bad" }, "⚡ " + (PT ? E.shortPt : E.shortEn)));
        }
      });
      /* the line between what your team operates and what the provider operates */
      var top = LAYERS.filter(function (l) { return owner(l.id, model) === "you"; }).length;
      if (top < LAYERS.length) {
        var ly = TOP + top * ROW;
        svg.appendChild(s("line", { x1: SX - 6, x2: SX + SW + 14, y1: ly, y2: ly, class: "csim-rs-line" }));
      }
      /* every model side by side: the page's table, rows aligned with the stack */
      MODELS.forEach(function (m, j) {
        var x = MX + j * (MW + MG), sel = m === model;
        svg.appendChild(s("text", { x: x + MW / 2, y: 16, "text-anchor": "middle", class: "c-small csim-rs-colhead" + (sel ? " c-ink" : ""), onclick: function () { pick(m, ev); } }, SHORT[m]));
        LAYERS.forEach(function (l, i) {
          var w = owner(l.id, m);
          var cell = s("rect", { x: x, y: TOP + i * ROW + 2, width: MW, height: ROW - 4, rx: 3,
            class: "csim-rs-cell " + CLS[w] + (sel ? "" : " dim"), onclick: function () { pick(m, ev); } });
          cell.appendChild(s("title", {}, MODEL_NAMES[m] + " · " + nm(l) + ": " + who(w)));
          svg.appendChild(cell);
        });
        if (sel) svg.appendChild(s("rect", { x: x - 2, y: TOP, width: MW + 4, height: 6 * ROW, rx: 4, class: "csim-rs-sel" }));
        svg.appendChild(s("text", { x: x + MW / 2, y: TOP + 6 * ROW + 14, "text-anchor": "middle", class: "c-small" }, yours(m) + (count(m, "shared") ? "+" : "")));
      });
      if (E) {
        var ey = TOP + LAYERS.map(function (l) { return l.id; }).indexOf(E.layer) * ROW;
        svg.appendChild(s("rect", { x: MX - 3, y: ey, width: 6 * (MW + MG) + 3, height: ROW, rx: 4, class: "csim-rs-hit" }));
      }

      st.set("you", youText(model), "warn");
      st.set("prov", count(model, "provider") + "/6", "info");
      if (E) {
        var w = actor(ev, model), a = action(ev, model), L = nm(layer(E.layer));
        st.set("acts", who(w), TONE[w]);
        var by = { you: t("your team", "seu time"), provider: t("the provider", "o provedor"), shared: t("your team and the provider together", "seu time e o provedor juntos") }[w];
        note.textContent = t(
          nm(E) + " → on " + MODEL_NAMES[model] + " the layer “" + L + "” is operated by " + by + ", so " + (w === "provider" ? "the provider acts" : w === "you" ? "your team acts" : "both act") + ". " + a[0],
          nm(E) + " → em " + MODEL_NAMES[model] + " a camada “" + L + "” é operada por " + by + ", então " + (w === "provider" ? "o provedor age" : w === "you" ? "seu time age" : "os dois agem") + ". " + a[1]);
        note.className = "csim-note " + (w === "provider" ? "csim-ok" : "csim-warn");
      } else {
        st.set("acts", "–", "");
        function list(who, pt) {
          var xs = LAYERS.filter(function (l) { return owner(l.id, model) === who; }).map(nm);
          return xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + (pt ? " e " : " and ") + xs[xs.length - 1];
        }
        var sh = count(model, "shared");
        note.textContent = t(
          "On " + MODEL_NAMES[model] + " your team operates " + n + " of the 6 layers (" + list("you") + ")" +
            (sh ? ", shares " + list("shared") : "") +
            (count(model, "provider") ? "; the provider operates " + list("provider") + "." : ": there is no provider.") + " Pick an event to see who acts.",
          "Em " + MODEL_NAMES[model] + " seu time opera " + n + " das 6 camadas (" + list("you", true) + ")" +
            (sh ? ", divide " + list("shared", true) : "") +
            (count(model, "provider") ? "; o provedor opera " + list("provider", true) + "." : ": não há provedor.") + " Escolha um evento para ver quem age.");
        note.className = "csim-note";
      }
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("Who operates each layer of BoxOffice, and who acts when something happens?", "Quem opera cada camada do BoxOffice e quem age quando algo acontece?") }),
      el("p", { class: "csim-sub", text: t("Left: the stack of the chosen model, with BoxOffice's examples. Right: all six models side by side, as in the table above (click a column).",
        "À esquerda, a pilha do modelo escolhido, com os exemplos do BoxOffice. À direita, os seis modelos lado a lado, como na tabela acima (clique numa coluna).") }),
      el("div", { class: "csim-row" }, [cModel]),
      el("div", { class: "csim-row" }, [cEvent]),
      el("div", { class: "csim-rs-key" }, [
        el("span", { class: "you" }, [el("i"), t("your team operates it", "seu time opera")]),
        el("span", { class: "shared" }, [el("i"), t("shared", "compartilhado")]),
        el("span", { class: "prov" }, [el("i"), t("the provider operates it", "o provedor opera")])]),
      el("div", { class: "csim-stage" }, svg),
      st,
      note,
      lg
    ]);
    if (ev) pick(model, ev); else draw();
    return {};
  });
})();
