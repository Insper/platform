/*
 * The Minikube cluster of hands-on 5 (2026.2), as a lab twin:
 *
 *   <div class="csim" data-sim="k8s-lab" data-script="gateway"></div>
 *
 * The lab's manifests (k8s/postgres/secrets.yaml, configmap.yaml, deployment.yaml, service.yaml and
 * k8s/gateway/k8s.yaml) applied to a one-node Minikube. Every button is a command of the lab (kubectl
 * apply / get / delete pod / scale, minikube tunnel, the curl on /health-check) and prints what kubectl
 * prints. A script (data-script) replays a part of the page step by step: postgres, gateway or
 * pitfalls; "free" leaves only the buttons.
 *
 * The model: a Deployment owns a ReplicaSet (a hash in the pod names) that keeps `replicas` pods; a pod
 * whose env references a ConfigMap or Secret that does not exist stays in CreateContainerConfigError
 * until it appears; every command takes 2 s and a container starts in 3 s, so a pod shows
 * ContainerCreating once before Running. A Service selects the Running pods whose labels match its
 * selector (its endpoints) and kube-proxy picks one at random per connection (seeded). Minikube has no
 * cloud load balancer: a LoadBalancer Service shows EXTERNAL-IP <pending> until `minikube tunnel` runs
 * (127.0.0.1, as with the Docker driver).
 */
(function () {
  "use strict";

  /* the lab's manifests, as the files in docs/2026.2/hands-on/5/k8s/ define them */
  var FILES = {
    "secrets.yaml": [{ kind: "Secret", name: "postgres-secrets", keys: ["POSTGRES_USER", "POSTGRES_PASSWORD"] }],
    "configmap.yaml": [{ kind: "ConfigMap", name: "postgres-configmap", keys: ["POSTGRES_HOST", "POSTGRES_DB"] }],
    "deployment.yaml": [{ kind: "Deployment", name: "postgres", replicas: 1, image: "postgres:latest", port: 5432,
      env: [["configmap", "postgres-configmap"], ["secret", "postgres-secrets"], ["secret", "postgres-secrets"]] }],
    "service.yaml": [{ kind: "Service", name: "postgres", type: "ClusterIP", port: 5432, selector: "postgres" }],
    "k8s.yaml": [{ kind: "Deployment", name: "gateway", replicas: 1, image: "humbertosandmann/gateway:latest", port: 8080, env: [] },
      { kind: "Service", name: "gateway", type: "LoadBalancer", port: 8080, selector: "gateway" }]
  };
  var STEP = 2, START = 3;            /* seconds per command; seconds for a container to start */
  var SAFE = "bcdfghjklmnpqrstvwxz2456789";   /* the alphabet of Kubernetes' generated names */
  var KIND = { Secret: "secret", ConfigMap: "configmap", Deployment: "deployment.apps", Service: "service" };

  function rngOf(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rand(st, n) { var s = ""; for (var i = 0; i < n; i++) s += SAFE[Math.floor(st.rng() * SAFE.length)]; return s; }

  function create(o) {
    o = o || {};
    var st = { t: 0, rng: rngOf(o.seed || 5), objs: {}, pods: [], tunnel: false, podIp: 3, curls: 0,
      svcIp: { kubernetes: "10.96.0.1" } };
    if (o.postgres) { ["secrets.yaml", "configmap.yaml", "deployment.yaml", "service.yaml"].forEach(function (f) { apply(st, f); }); st.t += 10; settle(st); }
    return st;
  }
  function obj(st, kind, name) { return st.objs[kind + "/" + name] || null; }
  function list(st, kind) { return Object.keys(st.objs).filter(function (k) { return k.indexOf(kind + "/") === 0; }).map(function (k) { return st.objs[k]; }); }
  function age(st, t0) { var s = Math.max(1, Math.round(st.t - t0)); return s < 120 ? s + "s" : Math.floor(s / 60) + "m"; }
  function pad(x, n) { x = String(x); while (x.length < n) x += " "; return x; }

  /* the first ConfigMap or Secret the pod's env references that does not exist */
  function missing(st, d) {
    for (var i = 0; i < d.env.length; i++) {
      var e = d.env[i];
      if (!obj(st, e[0] === "secret" ? "Secret" : "ConfigMap", e[1])) return e;
    }
    return null;
  }
  function newPod(st, d) {
    var p = { name: d.name + "-" + d.hash + "-" + rand(st, 5), app: d.name, created: st.t, ip: "10.244.0." + st.podIp++, status: "", gone: null };
    st.pods.push(p);
    return p;
  }
  /* bring every pod's status up to date and let each ReplicaSet reach its replicas */
  function settle(st) {
    st.pods = st.pods.filter(function (p) { return !(p.gone !== null && st.t >= p.gone); });
    list(st, "Deployment").forEach(function (d) {
      var mine = st.pods.filter(function (p) { return p.app === d.name && p.gone === null; });
      for (var i = mine.length; i < d.replicas; i++) mine.push(newPod(st, d));
      mine.slice(d.replicas).forEach(function (p) { p.gone = st.t + STEP; p.status = "Terminating"; });
    });
    st.pods.forEach(function (p) {
      if (p.gone !== null) return;
      var d = obj(st, "Deployment", p.app), m = missing(st, d);
      if (m) { p.status = "CreateContainerConfigError"; p.waitFrom = null; p.why = m; return; }
      if (p.waitFrom === undefined || p.waitFrom === null) p.waitFrom = p.status === "CreateContainerConfigError" ? st.t : p.created;
      p.status = st.t - p.waitFrom >= START ? "Running" : "ContainerCreating";
    });
  }
  function tick(st) { st.t += STEP; settle(st); }
  function running(st, app) { return st.pods.filter(function (p) { return p.app === app && p.status === "Running"; }); }
  /* the endpoints of a Service: Running pods whose label app matches its selector */
  function endpoints(st, svc) { return st.pods.filter(function (p) { return p.app === svc.selector && p.status === "Running"; }); }

  function apply(st, file) {
    var cmd = "$ kubectl apply -f ./k8s/" + file, out = [];
    (FILES[file] || []).forEach(function (m) {
      var key = m.kind + "/" + m.name, had = st.objs[key], o = JSON.parse(JSON.stringify(m));
      if (m.kind === "Deployment") o.hash = had ? had.hash : rand(st, 10);
      if (m.kind === "Service") {
        o.ip = had ? had.ip : "10.96." + (Math.floor(st.rng() * 200) + 20) + "." + (Math.floor(st.rng() * 250) + 2);
        if (m.type === "LoadBalancer") o.nodePort = had ? had.nodePort : 30000 + Math.floor(st.rng() * 2768);
      }
      if (had && m.kind === "Deployment") { o.replicas = had.replicas; }
      o.created = had ? had.created : st.t;
      var changed = had && had.selector !== o.selector;
      st.objs[key] = o;
      out.push(KIND[m.kind] + "/" + m.name + (had ? (changed ? " configured" : " unchanged") : " created"));
    });
    settle(st);
    var r = { cmd: cmd, out: out, tone: "ok" };
    var stuck = st.pods.filter(function (p) { return p.status === "CreateContainerConfigError"; })[0];
    r.note = stuck && file === "deployment.yaml"
      ? ["The Deployment exists, but its pod cannot start: " + stuck.why[0] + " \"" + stuck.why[1] + "\" not found.", "O Deployment existe, mas o pod não consegue iniciar: " + stuck.why[0] + " \"" + stuck.why[1] + "\" not found."]
      : ["kubectl sends the desired state; the controllers make the cluster match it.", "O kubectl envia o estado desejado; os controladores fazem o cluster ficar igual a ele."];
    if (stuck && file === "deployment.yaml") r.tone = "warn";
    return r;
  }

  function get(st, what) {
    var cmd = "$ kubectl get " + what, out = [], r = { cmd: cmd, tone: "info" };
    if (what === "pods") {
      var ps = st.pods;
      out = ps.length ? [pad("NAME", longest(ps) + 2) + "READY   STATUS" + pad("", 21) + "RESTARTS   AGE"].concat(ps.map(function (p) {
        return pad(p.name, longest(ps) + 2) + pad(p.status === "Running" ? "1/1" : "0/1", 8) + pad(p.status, 27) + pad("0", 11) + age(st, p.created);
      })) : ["No resources found in default namespace."];
      r.pods = ps.map(function (p) { return { name: p.name, status: p.status }; });
      var bad = ps.filter(function (p) { return p.status === "CreateContainerConfigError"; })[0];
      r.note = bad ? [bad.name + ": " + bad.why[0] + " \"" + bad.why[1] + "\" not found — apply it and the kubelet retries.", bad.name + ": " + bad.why[0] + " \"" + bad.why[1] + "\" not found — aplique-o e o kubelet tenta de novo."]
        : ["One line per pod: the ReplicaSet's hash in the middle of the name, a random suffix at the end.", "Uma linha por pod: o hash do ReplicaSet no meio do nome, um sufixo aleatório no fim."];
      if (bad) r.tone = "warn";
    } else if (what === "deployments") {
      var ds = list(st, "Deployment");
      out = ds.length ? ["NAME       READY   UP-TO-DATE   AVAILABLE   AGE"].concat(ds.map(function (d) {
        var n = running(st, d.name).length;
        return pad(d.name, 11) + pad(n + "/" + d.replicas, 8) + pad(d.replicas, 13) + pad(n, 12) + age(st, d.created);
      })) : ["No resources found in default namespace."];
      r.ready = ds.map(function (d) { return d.name + " " + running(st, d.name).length + "/" + d.replicas; });
      r.note = ["READY is running/desired: the ReplicaSet works until they are equal.", "READY é rodando/desejado: o ReplicaSet trabalha até os dois serem iguais."];
    } else if (what === "services") {
      out = ["NAME         TYPE           CLUSTER-IP      EXTERNAL-IP   PORT(S)          AGE",
        "kubernetes   ClusterIP      10.96.0.1       <none>        443/TCP          5d"];
      r.svcs = [];
      list(st, "Service").forEach(function (sv) {
        var ext = sv.type === "LoadBalancer" ? (st.tunnel ? "127.0.0.1" : "<pending>") : "<none>";
        r.svcs.push({ name: sv.name, type: sv.type, ext: ext });
        out.push(pad(sv.name, 13) + pad(sv.type, 15) + pad(sv.ip, 16) + pad(ext, 14) + pad(sv.port + (sv.nodePort ? ":" + sv.nodePort : "") + "/TCP", 17) + age(st, sv.created));
      });
      var lb = r.svcs.filter(function (x) { return x.type === "LoadBalancer"; })[0];
      r.note = lb && lb.ext === "<pending>" ? ["gateway is a LoadBalancer, and Minikube has no cloud load balancer: EXTERNAL-IP stays <pending>. Start minikube tunnel.", "gateway é um LoadBalancer e o Minikube não tem balanceador de nuvem: EXTERNAL-IP fica <pending>. Inicie o minikube tunnel."]
        : lb ? ["With the tunnel running, gateway answers at 127.0.0.1:8080. postgres stays ClusterIP: reachable only inside the cluster, by its name.", "Com o tunnel rodando, gateway responde em 127.0.0.1:8080. postgres continua ClusterIP: só dentro do cluster, pelo nome."]
          : ["postgres is a ClusterIP: other pods reach it as postgres:5432, the POSTGRES_HOST of the ConfigMap.", "postgres é um ClusterIP: os outros pods o alcançam como postgres:5432, o POSTGRES_HOST do ConfigMap."];
      if (lb && lb.ext === "<pending>") r.tone = "warn";
    } else if (what === "endpoints") {
      out = ["NAME         ENDPOINTS                                   AGE", "kubernetes   192.168.49.2:8443                           5d"];
      r.eps = {};
      list(st, "Service").forEach(function (sv) {
        var eps = endpoints(st, sv).map(function (p) { return p.ip + ":" + sv.port; });
        r.eps[sv.name] = eps.length;
        out.push(pad(sv.name, 13) + pad(eps.length ? eps.slice(0, 2).join(",") + (eps.length > 2 ? " + " + (eps.length - 2) + " more..." : "") : "<none>", 44) + age(st, sv.created));
      });
      r.note = ["A Service sends traffic to its endpoints: the Running pods whose labels match its selector.", "Um Service manda o tráfego para seus endpoints: os pods Running cujos rótulos batem com o seletor."];
    } else if (what === "secrets" || what === "configmap") {
      var kind = what === "secrets" ? "Secret" : "ConfigMap", xs = list(st, kind);
      out = what === "secrets" ? ["NAME               TYPE     DATA   AGE"].concat(xs.map(function (x) { return pad(x.name, 19) + "Opaque   " + pad(x.keys.length, 7) + age(st, x.created); }))
        : ["NAME                 DATA   AGE", "kube-root-ca.crt     1      5d"].concat(xs.map(function (x) { return pad(x.name, 21) + pad(x.keys.length, 7) + age(st, x.created); }));
      if (what === "secrets" && !xs.length) out = ["No resources found in default namespace."];
      r.note = what === "secrets" ? ["The values are only base64: c3RvcmU= is store. Encoding, not encryption.", "Os valores são só base64: c3RvcmU= é store. Codificação, não criptografia."]
        : ["Configuration outside the image: the Deployment reads POSTGRES_DB from here.", "Configuração fora da imagem: o Deployment lê POSTGRES_DB daqui."];
    }
    r.out = out;
    return r;
  }
  function longest(ps) { return ps.reduce(function (m, p) { return Math.max(m, p.name.length); }, 4); }

  function deletePod(st, name) {
    var p = st.pods.filter(function (x) { return x.name === name && x.gone === null; })[0], cmd = "$ kubectl delete pod " + name;
    if (!p) { return { cmd: cmd, out: ["Error from server (NotFound): pods \"" + name + "\" not found"], tone: "bad", note: null }; }
    st.pods = st.pods.filter(function (x) { return x !== p; });
    settle(st);
    var fresh = st.pods.filter(function (x) { return x.app === p.app; }).pop();
    return { cmd: cmd, out: ["pod \"" + name + "\" deleted"], tone: "ok", replaced: fresh ? fresh.name : null,
      note: ["The ReplicaSet saw " + p.app + " below its replicas and created " + fresh.name + ": a new name, a new IP (" + fresh.ip + ").",
        "O ReplicaSet viu " + p.app + " abaixo das réplicas e criou " + fresh.name + ": um nome novo, um IP novo (" + fresh.ip + ")."] };
  }
  function scale(st, dep, n) {
    var d = obj(st, "Deployment", dep), cmd = "$ kubectl scale deployment " + dep + " --replicas=" + n;
    if (!d) { return { cmd: cmd, out: ["Error from server (NotFound): deployments.apps \"" + dep + "\" not found"], tone: "bad", note: null }; }
    var before = d.replicas;
    d.replicas = n;
    settle(st);
    return { cmd: cmd, out: ["deployment.apps/" + dep + " scaled"], tone: "ok",
      note: n > before ? ["Desired " + n + ": the ReplicaSet creates " + (n - before) + " pod(s).", "Desejado " + n + ": o ReplicaSet cria " + (n - before) + " pod(s)."]
        : n < before ? ["Desired " + n + ": the ReplicaSet terminates " + (before - n) + " pod(s).", "Desejado " + n + ": o ReplicaSet encerra " + (before - n) + " pod(s)."]
          : ["Already " + n + ".", "Já são " + n + "."] };
  }
  function tunnel(st, on) {
    st.tunnel = on;
    return on ? { cmd: "$ minikube tunnel", out: ["✅  Tunnel successfully started", "🏃  Starting tunnel for service gateway."], tone: "ok",
      note: ["Keep this terminal open: while it runs, LoadBalancer Services get an external IP.", "Deixe este terminal aberto: enquanto ele roda, Services LoadBalancer recebem um IP externo."] }
      : { cmd: "^C  (minikube tunnel stopped)", out: ["✋  Stopped tunnel for service gateway."], tone: "warn",
        note: ["Without the tunnel, EXTERNAL-IP goes back to <pending>.", "Sem o tunnel, EXTERNAL-IP volta a <pending>."] };
  }
  function curl(st, n) {
    n = n || 1;
    var cmd = "$ " + (n > 1 ? "for i in {1.." + n + "}; do curl http://127.0.0.1:8080/health-check; echo; done" : "curl http://127.0.0.1:8080/health-check");
    var sv = obj(st, "Service", "gateway"), out = [], hosts = [];
    for (var i = 0; i < n; i++) {
      if (!sv || !st.tunnel) { out.push("curl: (7) Failed to connect to 127.0.0.1 port 8080 after 0 ms: Couldn't connect to server"); continue; }
      var eps = endpoints(st, sv);
      if (!eps.length) { out.push("curl: (7) Failed to connect to 127.0.0.1 port 8080 after 2 ms: Connection refused"); continue; }
      var p = eps[Math.floor(st.rng() * eps.length)];
      hosts.push(p.name);
      out.push('{"hostname":"' + p.name + '"}');
    }
    var distinct = hosts.filter(function (h, i) { return hosts.indexOf(h) === i; });
    return { cmd: cmd, out: out, hosts: hosts, distinct: distinct.length, tone: hosts.length === n ? "ok" : "bad",
      note: !sv ? ["There is no gateway Service yet.", "Ainda não há Service gateway."]
        : !st.tunnel ? ["No tunnel, no external IP: nothing listens on 127.0.0.1:8080.", "Sem tunnel, sem IP externo: nada escuta em 127.0.0.1:8080."]
          : !hosts.length ? ["The Service has no endpoints: no Running pod matches its selector.", "O Service não tem endpoints: nenhum pod Running bate com o seletor."]
            : [hosts.length + " answer(s) from " + distinct.length + " pod(s): kube-proxy picks one of the Service's endpoints per connection.",
              hosts.length + " resposta(s) de " + distinct.length + " pod(s): o kube-proxy escolhe um dos endpoints do Service a cada conexão."] };
  }
  /* edit the selector of the gateway Service (the label pitfall) and apply */
  function selector(st, value) {
    var sv = obj(st, "Service", "gateway"), cmd = "$ kubectl apply -f ./k8s/k8s.yaml   # selector: app: " + value;
    if (!sv) { return { cmd: cmd, out: ["(no gateway Service)"], tone: "bad", note: null }; }
    var was = sv.selector;
    sv.selector = value;
    return { cmd: cmd, out: ["deployment.apps/gateway unchanged", "service/gateway " + (was === value ? "unchanged" : "configured")], tone: value === "gateway" ? "ok" : "warn",
      note: value === "gateway" ? ["The selector matches the pods' label again.", "O seletor volta a bater com o rótulo dos pods."]
        : ["No pod has the label app: " + value + ": the Service selects nothing.", "Nenhum pod tem o rótulo app: " + value + ": o Service não seleciona nada."] };
  }

  var SCRIPTS = {
    postgres: [
      { ops: [["apply", "secrets.yaml"], ["get", "secrets"]], en: "secrets.yaml: user and password, base64-encoded.", pt: "secrets.yaml: usuário e senha, em base64." },
      { ops: [["apply", "configmap.yaml"], ["get", "configmap"]], en: "configmap.yaml: POSTGRES_HOST and POSTGRES_DB.", pt: "configmap.yaml: POSTGRES_HOST e POSTGRES_DB." },
      { ops: [["apply", "deployment.yaml"], ["get", "deployments"]], en: "deployment.yaml: the Deployment wants 1 replica; its pod is starting.", pt: "deployment.yaml: o Deployment quer 1 réplica; o pod está iniciando." },
      { ops: [["get", "pods"]], en: "The pod is Running: it read the ConfigMap and the Secret that already exist.", pt: "O pod está Running: leu o ConfigMap e o Secret que já existem." },
      { ops: [["apply", "service.yaml"], ["get", "services"]], en: "service.yaml: a ClusterIP named postgres, reachable only inside the cluster.", pt: "service.yaml: um ClusterIP chamado postgres, alcançável só dentro do cluster." }
    ],
    gateway: [
      { ops: [["apply", "k8s.yaml"], ["get", "pods"]], en: "k8s.yaml: one file, a Deployment and a Service. The gateway pod is starting.", pt: "k8s.yaml: um arquivo, um Deployment e um Service. O pod do gateway está iniciando." },
      { ops: [["get", "services"]], en: "EXTERNAL-IP <pending>: Minikube has no cloud load balancer.", pt: "EXTERNAL-IP <pending>: o Minikube não tem balanceador de nuvem." },
      { ops: [["tunnel", true], ["get", "services"]], en: "minikube tunnel in another terminal: the Service gets 127.0.0.1.", pt: "minikube tunnel em outro terminal: o Service recebe 127.0.0.1." },
      { ops: [["curl", 1]], en: "/health-check answers the hostname of the pod: its name.", pt: "O /health-check responde o hostname do pod: o nome dele." },
      { ops: [["deleteFirst", "gateway"], ["get", "pods"]], en: "Delete the pod: the ReplicaSet creates another one, with a new name.", pt: "Apague o pod: o ReplicaSet cria outro, com um nome novo." },
      { ops: [["scale", "gateway", 3], ["get", "pods"]], en: "Scale to 3: two new pods start.", pt: "Escale para 3: dois pods novos iniciam." },
      { ops: [["get", "endpoints"]], en: "The Service now has 3 endpoints: the pods with app: gateway.", pt: "O Service agora tem 3 endpoints: os pods com app: gateway." },
      { ops: [["curl", 6]], en: "Six requests, spread over the pods by the Service.", pt: "Seis requisições, espalhadas pelos pods pelo Service." }
    ],
    pitfalls: [
      { ops: [["apply", "deployment.yaml"], ["get", "pods"]], en: "Deployment first: the pod waits for a ConfigMap that does not exist.", pt: "Deployment primeiro: o pod espera um ConfigMap que não existe." },
      { ops: [["apply", "configmap.yaml"], ["get", "pods"]], en: "Now the Secret is missing.", pt: "Agora falta o Secret." },
      { ops: [["apply", "secrets.yaml"], ["get", "pods"]], en: "Both exist: the kubelet retries and the container starts.", pt: "Os dois existem: o kubelet tenta de novo e o contêiner inicia." },
      { ops: [["get", "pods"]], en: "Running, without deleting anything: Kubernetes converges to the desired state.", pt: "Running, sem apagar nada: o Kubernetes converge para o estado desejado." },
      { ops: [["apply", "k8s.yaml"], ["tunnel", true], ["get", "pods"]], en: "The gateway, with the tunnel running.", pt: "O gateway, com o tunnel rodando." },
      { ops: [["selector", "gateway-api"], ["get", "endpoints"], ["curl", 1]], en: "A selector that matches no label: the Service has no endpoints and the request is refused.", pt: "Um seletor que não bate com nenhum rótulo: o Service fica sem endpoints e a requisição é recusada." },
      { ops: [["selector", "gateway"], ["curl", 1]], en: "Fix the selector: the pod answers again.", pt: "Corrija o seletor: o pod volta a responder." }
    ]
  };
  function deleteFirst(st, app) { var p = st.pods.filter(function (x) { return x.app === app && x.gone === null; })[0]; return deletePod(st, p ? p.name : app); }
  var OPS = { apply: apply, get: get, deletePod: deletePod, deleteFirst: deleteFirst, scale: scale, tunnel: tunnel, curl: curl, selector: selector };
  /* every command takes STEP seconds, before it runs: what it prints is the state it leaves */
  Object.keys(OPS).forEach(function (k) { var f = OPS[k]; OPS[k] = function (st) { tick(st); return f.apply(null, arguments); }; });
  function run(st, op) { return OPS[op[0]].apply(null, [st].concat(op.slice(1))); }
  function startOf(name) { return { postgres: false, gateway: true, pitfalls: false }[name] ? { postgres: true } : {}; }
  function play(name, n) {
    var st = create(startOf(name)), out = [];
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (step) { step.ops.forEach(function (op) { out.push(run(st, op)); }); });
    return { st: st, out: out };
  }

  var API = { FILES: FILES, STEP: STEP, START: START, SCRIPTS: SCRIPTS, create: create, startOf: startOf, obj: obj, endpoints: endpoints, running: running, run: run, play: play,
    apply: OPS.apply, get: OPS.get, deletePod: OPS.deletePod, scale: OPS.scale, tunnel: OPS.tunnel, curl: OPS.curl, selector: OPS.selector };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  function L(pair) { return pair ? (PT ? pair[1] : pair[0]) : ""; }
  var TONE = { Running: "ok", ContainerCreating: "warn", CreateContainerConfigError: "bad", Terminating: "down" };

  C.style("k8s-lab", [
    ".md-typeset .csim .csim-k8-pod { cursor: pointer; }",
    ".md-typeset .csim .csim-k8-pod.sel > rect { stroke-width: 3; }",
    ".md-typeset .csim .csim-k8-obj { stroke-dasharray: 3 2; }",
    ".md-typeset .csim-log.csim-k8-term li { font-family: var(--md-code-font-family, monospace); font-size: .6rem; white-space: pre; overflow-x: auto; }",
    ".md-typeset .csim-log.csim-k8-term li b { font-weight: 600; }",
    ".md-typeset .csim-k8-acts .csim-btn[disabled] { opacity: .4; cursor: default; }"
  ].join("\n"));

  C.register("k8s-lab", function (root) {
    var o = C.opts(root, { script: "gateway" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st, sel = null, lastHosts = [];

    var svg = s("svg", { viewBox: "0 0 630 250", role: "img", "aria-label": t("Minikube cluster", "Cluster Minikube") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(5); term.className += " csim-k8-term";
    var tiles = C.stats([
      { key: "gw", label: t("gateway ready", "gateway prontos") },
      { key: "pg", label: t("postgres ready", "postgres prontos") },
      { key: "ext", label: "EXTERNAL-IP" },
      { key: "eps", label: t("gateway endpoints", "endpoints do gateway") }
    ]);
    function say(pair, tone) { note.textContent = L(pair); note.className = "csim-note" + (tone && tone !== "info" ? " csim-" + tone : ""); }
    function show(r) {
      term.add(el("span", {}, [el("b", { text: r.cmd }), r.out.length ? "\n" + r.out.join("\n") : ""]), r.tone === "info" ? "" : r.tone);
      if (r.hosts) lastHosts = r.hosts;
    }
    var cScript = C.choice({ label: t("Lab part", "Parte do lab"), value: script, options: [
      { value: "postgres", label: "Postgres" }, { value: "gateway", label: "Gateway" },
      { value: "pitfalls", label: t("Pitfalls", "Armadilhas") }, { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; reset(); } });

    function act(fn) { return function () { player.pause(); lastHosts = []; var r = fn(); if (r) { show(r); say(r.note, r.tone); } draw(); }; }
    var cFile = C.choice({ label: "kubectl apply -f", value: "secrets.yaml", options: Object.keys(FILES).map(function (f) { return { value: f, label: f }; }),
      onChange: act(function () { return OPS.apply(st, cFile.get()); }) });
    var cGet = C.choice({ label: "kubectl get", value: "pods", options: ["pods", "deployments", "services", "endpoints", "secrets", "configmap"].map(function (w) { return { value: w, label: w }; }),
      onChange: act(function () { return OPS.get(st, cGet.get()); }) });
    var bDel = C.button("kubectl delete pod", act(function () { return sel ? OPS.deletePod(st, sel) : null; }), { tone: "bad" });
    var cScale = C.choice({ label: t("scale gateway", "escalar gateway"), value: 1, options: [1, 2, 3, 4].map(function (n) { return { value: n, label: String(n) }; }),
      onChange: act(function () { return OPS.scale(st, "gateway", cScale.get()); }) });
    var bTun = C.button("minikube tunnel", act(function () { return OPS.tunnel(st, !st.tunnel); }));
    var bCurl = C.button("curl …/health-check", act(function () { return OPS.curl(st, 1); }), { tone: "ok" });
    var bCurl6 = C.button("curl ×6", act(function () { return OPS.curl(st, 6); }));

    var player = C.player({ interval: 1900, onTick: function (k) { return step(k); }, onPrev: function (k) { replay(k); }, onReset: function () { reset(); } });

    function step(k) {
      var sc = SCRIPTS[script];
      if (!sc || k > sc.length) return false;
      var tone = "";
      lastHosts = [];
      sc[k - 1].ops.forEach(function (op) { var r = run(st, op); show(r); if (r.tone === "bad" || (r.tone === "warn" && tone !== "bad")) tone = r.tone; });
      say([sc[k - 1].en, sc[k - 1].pt], tone);
      draw();
    }
    function replay(k) { fresh(); for (var i = 1; i <= k; i++) step(i); if (!k) intro(); draw(); }
    function intro() {
      say(script === "free"
        ? ["An empty cluster: apply the lab's files in any order, click a pod to delete it, scale the gateway, start the tunnel.", "Um cluster vazio: aplique os arquivos do lab em qualquer ordem, clique num pod para apagá-lo, escale o gateway, inicie o tunnel."]
        : ["Press play or → to run the page's commands; the buttons work at any time." + (script === "gateway" ? " The Postgres part is already applied." : ""),
           "Aperte play ou → para rodar os comandos da página; os botões funcionam a qualquer momento." + (script === "gateway" ? " A parte do Postgres já está aplicada." : "")], "");
    }
    function fresh() { st = create(script === "free" ? {} : startOf(script)); term.clear(); lastHosts = []; sel = null; }
    function reset() {
      fresh();
      player.total(SCRIPTS[script] ? SCRIPTS[script].length : 0);
      player.style.display = SCRIPTS[script] ? "" : "none";
      intro(); draw();
    }

    function box(x, y, w, h, cls, rx) { return s("rect", { x: x, y: y, width: w, height: h, rx: rx || 7, class: "c-box " + cls }); }
    function text(x, y, str, cls, anchor) { return s("text", { x: x, y: y, class: cls || "c-small", "text-anchor": anchor || "start" }, str); }

    function draw() {
      C.clear(svg);
      /* the cluster frame */
      svg.appendChild(s("rect", { x: 108, y: 4, width: 518, height: 240, rx: 10, class: "c-box csim-k8-obj" }));
      svg.appendChild(text(118, 18, t("Minikube · one node", "Minikube · um nó"), "c-small"));
      /* the outside: a browser / curl, and the tunnel */
      var gsv = obj(st, "Service", "gateway"), psv = obj(st, "Service", "postgres");
      svg.appendChild(box(2, 40, 100, 40, "on"));
      svg.appendChild(text(52, 57, t("you", "você"), "c-label", "middle"));
      svg.appendChild(text(52, 71, "127.0.0.1:8080", "c-small c-mono", "middle"));
      svg.appendChild(text(52, 100, st.tunnel ? t("tunnel: on", "tunnel: ligado") : t("tunnel: off", "tunnel: desligado"), "c-small" + (st.tunnel ? " c-ok" : " c-warn"), "middle"));
      var apps = [{ app: "gateway", y: 30, svc: gsv }, { app: "postgres", y: 150, svc: psv }];
      if (gsv) svg.appendChild(s("line", { x1: 102, y1: 60, x2: 124, y2: 60, class: "c-wire" + (st.tunnel ? " on" : " cut") }));
      apps.forEach(function (a) {
        var d = obj(st, "Deployment", a.app), y = a.y;
        /* the Service */
        if (a.svc) {
          var eps = endpoints(st, a.svc);
          svg.appendChild(box(124, y, 156, 62, eps.length ? "on" : "warn"));
          svg.appendChild(text(131, y + 15, "Service " + a.svc.name, "c-label"));
          svg.appendChild(text(131, y + 29, a.svc.type + " :" + a.svc.port, "c-small c-mono"));
          svg.appendChild(text(131, y + 42, "selector app: " + a.svc.selector, "c-small c-mono" + (a.svc.selector === a.app ? "" : " c-bad")));
          svg.appendChild(text(131, y + 55, a.svc.type === "LoadBalancer" ? "EXTERNAL-IP " + (st.tunnel ? "127.0.0.1" : "<pending>") : "postgres:" + a.svc.port + t(" inside", " interno"),
            "c-small c-mono" + (a.svc.type === "LoadBalancer" && !st.tunnel ? " c-warn" : "")));
        }
        /* the Deployment and its ReplicaSet */
        if (d) {
          svg.appendChild(box(292, y, 132, 62, "csim-k8-obj"));
          svg.appendChild(text(299, y + 15, d.name, "c-label"));
          svg.appendChild(text(299, y + 29, "Deployment · replicas: " + d.replicas, "c-small"));
          svg.appendChild(text(299, y + 43, "ReplicaSet", "c-small"));
          svg.appendChild(text(299, y + 56, d.name + "-" + d.hash, "c-small c-mono"));
        }
        /* its pods */
        var ps = st.pods.filter(function (p) { return p.app === a.app; });
        ps.forEach(function (p, i) {
          var col = i % 2, row = Math.floor(i / 2), x = 434 + col * 96, py = y - 8 + row * 40;
          if (a.svc && p.status === "Running" && p.app === a.svc.selector) {
            svg.appendChild(s("path", { d: "M280," + (y + 31) + " C350," + (y + 31) + " 360," + (py + 17) + " " + x + "," + (py + 17),
              class: "c-wire" + (lastHosts.indexOf(p.name) >= 0 ? " on" : ""), style: "opacity:.55" }));
          }
          var g = s("g", { class: "csim-k8-pod" + (p.name === sel ? " sel" : ""), onclick: function () { sel = p.name; draw(); } });
          g.appendChild(box(x, py, 90, 34, TONE[p.status] || "", 5));
          g.appendChild(text(x + 5, py + 13, p.app + "-…-" + p.name.slice(-5), "c-small"));
          g.appendChild(text(x + 5, py + 27, p.status === "CreateContainerConfigError" ? "ConfigError" : p.status, "c-small" + (p.status === "Running" ? " c-ok" : p.status === "CreateContainerConfigError" ? " c-bad" : " c-warn")));
          svg.appendChild(g);
        });
        if (!d && !a.svc) svg.appendChild(text(292, y + 35, a.app + t(": not applied", ": não aplicado"), "c-small"));
      });
      /* ConfigMap and Secret */
      var cm = obj(st, "ConfigMap", "postgres-configmap"), se = obj(st, "Secret", "postgres-secrets");
      svg.appendChild(text(124, 236, "ConfigMap " + (cm ? "✓" : "✗") + "   Secret " + (se ? "✓" : "✗"), "c-small c-mono" + (cm && se ? "" : " c-warn")));
      if (sel && !st.pods.some(function (p) { return p.name === sel; })) sel = null;
      bDel.disabled = !sel;
      bDel.textContent = "kubectl delete pod " + (sel ? "…" + sel.slice(-11) : t("(click a pod)", "(clique num pod)"));
      bTun.textContent = st.tunnel ? t("stop minikube tunnel", "parar minikube tunnel") : "minikube tunnel";
      var gd = obj(st, "Deployment", "gateway"), pd = obj(st, "Deployment", "postgres");
      cScale.set(gd ? gd.replicas : 1);
      tiles.set("gw", gd ? running(st, "gateway").length + "/" + gd.replicas : "–", gd ? (running(st, "gateway").length === gd.replicas ? "ok" : "warn") : "");
      tiles.set("pg", pd ? running(st, "postgres").length + "/" + pd.replicas : "–", pd ? (running(st, "postgres").length === pd.replicas ? "ok" : "warn") : "");
      tiles.set("ext", gsv ? (st.tunnel ? "127.0.0.1" : "<pending>") : "–", gsv ? (st.tunnel ? "ok" : "warn") : "");
      tiles.set("eps", gsv ? String(endpoints(st, gsv).length) : "–", gsv ? (endpoints(st, gsv).length ? "ok" : "bad") : "");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's cluster, without Minikube: apply, self-healing, scaling and the LoadBalancer",
        "O cluster do lab, sem Minikube: apply, autocorreção, escala e o LoadBalancer") }),
      el("p", { class: "csim-sub", text: t("The lab's manifests on a one-node Minikube. Every button is a command of the lab; click a pod to delete it. Pod colours: green Running, amber starting, red waiting for a ConfigMap or Secret.",
        "Os manifestos do lab num Minikube de um nó. Cada botão é um comando do lab; clique num pod para apagá-lo. Cores dos pods: verde Running, âmbar iniciando, vermelho esperando um ConfigMap ou Secret.") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-row" }, [cFile]),
      el("div", { class: "csim-row" }, [cGet]),
      el("div", { class: "csim-row csim-k8-acts" }, [bDel, cScale, bTun, bCurl, bCurl6]),
      note,
      player,
      el("div", { class: "csim-cols" }, [tiles, term])
    ]);
    reset();
    return {};
  });
})();
