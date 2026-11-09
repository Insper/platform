/*
 * The kind cluster of hands-on 10 (2027.1), as a lab twin:
 *
 *   <div class="csim" data-sim="kind-lab" data-script="deploy"></div>
 *
 * boxoffice-control-plane (with Traefik) and two workers, running db-0, redis and two catalog pods as
 * k8s/base/ declares them. Every button is a command of the lab (kubectl apply -k, get pods -o wide,
 * get nodes, delete pod -l app=catalog, rollout restart, docker stop/start boxoffice-worker2, the
 * patch that removes the readiness probe and the preStop pause, lab 8's k6 at a steady rate) and
 * prints what the lab prints. A script (data-script) replays a part of the lab step by step: deploy,
 * heal, node or rollout; "free" starts from the deployed cluster and leaves only the buttons.
 * The HPA is not here: the autoscale simulator of the Kubernetes class page plays it with the same
 * catalog-hpa.yaml.
 *
 * The model runs second by second. LAB holds what the lab's files say (replicas, rollout strategy,
 * preStop, probe periods, grace period, the k6 command of experiment B); MODEL holds what they do not
 * (how long a JVM takes, when PostgreSQL accepts connections, Kubernetes' defaults for back-off, node
 * detection and eviction, how long Traefik takes to see an endpoint change). A catalog container that
 * reaches the database before db-0 is ready exits and restarts with a doubling back-off. A pod is
 * ready at the first probe after its JVM listens. A terminating pod leaves the Service endpoints at
 * once, but Traefik sees the change `lag` seconds later; the pod keeps accepting until its preStop
 * pause ends and SIGTERM arrives. A stopped node keeps its pods until it is declared NotReady (then
 * they leave the endpoints) and evicts them after the default toleration; only then does the
 * ReplicaSet replace them. k6 sends `rate` requests per second, round robin over Traefik's endpoints:
 * one sent to a pod that no longer accepts fails (502), none at all fails with 503.
 */
(function () {
  "use strict";

  /* lab 10: k8s/base/catalog.yaml, k8s/kind.yaml and the k6 command of measure/index.md (experiment B) */
  var LAB = { replicas: 2, maxSurge: 1, maxUnavailable: 0, preStop: 5, readinessPeriod: 5, startupPeriod: 5, grace: 30,
    port: 8082, cluster: "boxoffice", workers: 2, rate: 100, duration: 120, rolloutAt: 30 };
  /* not from the lab: a laptop's timings and Kubernetes' defaults */
  var MODEL = {
    create: 2,          /* s: ContainerCreating (the image is already loaded into the nodes) */
    toDb: 12,           /* s: from JVM start to Flyway's first connection */
    jvm: 22,            /* s: from JVM start to listening, warm laptop, no load (+0–3 s per pod) */
    migrate: 5,         /* s: the Flyway migrations of the very first start */
    dbReady: 38,        /* s: from container start to pg_isready (volume provisioning + initdb) */
    redisReady: 3,
    backoff: 10,        /* s: the kubelet's first restart back-off, doubling */
    nodeGrace: 50,      /* s: node-monitor-grace-period: no heartbeat for this long → NotReady */
    toleration: 300,    /* s: default tolerationSeconds for not-ready / unreachable nodes */
    lag: 2,             /* s: from an endpoint change in the API to Traefik's routing table */
    shutdown: 1,        /* s: graceful shutdown of a JVM with no long requests in flight */
    nodeBoot: 10        /* s: a restarted node container until Ready */
  };
  var CLUSTER = LAB.cluster, NODES = [CLUSTER + "-control-plane"];
  for (var w = 1; w <= LAB.workers; w++) NODES.push(CLUSTER + "-worker" + (w > 1 ? w : ""));
  var SAFE = "bcdfghjklmnpqrstvwxz2456789";   /* the alphabet of Kubernetes' generated names */
  var APPLY = ["namespace/boxoffice created", "configmap/boxoffice-config created", "secret/db-credentials-c677754gbf created",
    "service/catalog created", "service/db created", "service/redis created", "deployment.apps/catalog created",
    "deployment.apps/redis created", "statefulset.apps/db created", "horizontalpodautoscaler.autoscaling/catalog created",
    "ingress.networking.k8s.io/boxoffice created"];

  function rngOf(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rand(st, n, abc) { var s = ""; abc = abc || SAFE; for (var i = 0; i < n; i++) s += abc[Math.floor(st.rng() * abc.length)]; return s; }

  /* ------------------------------------------------------------------ state */

  function create(o) {
    o = o || {};
    var st = { t: 0, rng: rngOf(o.seed || 10), lag: o.lag || MODEL.lag, applied: false, migrated: false,
      nodes: NODES.map(function (n, i) { return { name: n, worker: i > 0, up: true, ready: true, downAt: null, notReadyAt: null, readyAt: null }; }),
      catalog: { replicas: LAB.replicas, hash: "8685666c5", readiness: true, preStop: LAB.preStop, restartedAt: null },
      redis: { replicas: 1, hash: "6757b9b5ff" },
      pods: [], ep: {}, rr: 0, k6: null, k6runs: [] };
    if (o.deployed) { cmdApply(st); advance(st, 211); }   /* "AGE 3m31s" on the page: deployed and warm */
    return st;
  }
  function node(st, name) { return st.nodes.filter(function (n) { return n.name === name; })[0]; }
  function pods(st, app) { return st.pods.filter(function (p) { return !app || p.app === app; }); }
  function active(st, app) { return pods(st, app).filter(function (p) { return p.term === null; }); }
  function dbReady(st) { return st.pods.some(function (p) { return p.app === "db" && p.ready && p.term === null; }); }
  function accepting(st, p) {
    var n = node(st, p.node);
    return !!n && n.up && p.up !== null && st.t >= p.up && !(p.term !== null && st.t >= p.sigterm);
  }

  /* the scheduler: a worker that is Ready, spreading pods of the same app (a terminating pod still sits on
     its node), the first one on a tie */
  function schedule(st, app) {
    var ws = st.nodes.filter(function (n) { return n.worker && n.ready && n.up; });
    if (!ws.length) return null;
    var count = function (n) { return st.pods.filter(function (p) { return p.app === app && p.node === n.name; }).length; };
    return ws.reduce(function (b, n) { return count(n) < count(b) ? n : b; }).name;
  }
  function newPod(st, app) {
    var name = app === "db" ? "db-0" : app + "-" + st[app].hash + "-" + rand(st, 5);
    var p = { name: name, app: app, node: null, created: st.t, start: null, restarts: 0, lastRestart: null, crashAt: null, nextStart: null,
      checked: false, up: null, ready: false, lost: false, term: null, sigterm: null, exitAt: null, hash: app === "db" ? "" : st[app].hash,
      preStop: app === "catalog" ? st.catalog.preStop : 0, readiness: app === "catalog" ? st.catalog.readiness : true,
      jitter: app === "catalog" ? Math.floor(st.rng() * 4) : 0 };
    st.pods.push(p);
    place(st, p);
    return p;
  }
  function place(st, p) { p.node = schedule(st, p.app); if (p.node) p.start = st.t + MODEL.create; }
  function terminate(st, p) {
    if (p.term !== null) return;
    p.term = st.t; p.ready = false;
    p.sigterm = st.t + p.preStop;
    p.exitAt = Math.min(p.sigterm + MODEL.shutdown, st.t + LAB.grace);
  }

  /* one Deployment's ReplicaSets: maxSurge pods above replicas, never fewer than replicas − maxUnavailable ready */
  function reconcile(st, app) {
    var d = st[app], act = active(st, app);
    var fresh = act.filter(function (p) { return p.hash === d.hash; }), old = act.filter(function (p) { return p.hash !== d.hash; });
    if (!old.length) {
      for (var i = fresh.length; i < d.replicas; i++) newPod(st, app);
      fresh.slice(d.replicas).forEach(function (p) { terminate(st, p); });
      return;
    }
    if (fresh.length < d.replicas && fresh.length + old.length < d.replicas + LAB.maxSurge) newPod(st, app);
    var ready = act.filter(function (p) { return p.ready; }).length;
    if (ready - 1 >= d.replicas - LAB.maxUnavailable) {
      var victim = old.filter(function (p) { return !p.ready; })[0] || old[0];
      terminate(st, victim);
    }
  }

  /* one second of the cluster */
  function tick(st) {
    st.t++;
    var t = st.t;
    st.nodes.forEach(function (n) {
      if (!n.up && n.ready && t >= n.downAt + MODEL.nodeGrace) {
        n.ready = false; n.notReadyAt = t;
        st.pods.forEach(function (p) { if (p.node === n.name) { p.ready = false; p.lost = true; } });
      }
      if (!n.up && !n.ready && n.notReadyAt !== null && t >= n.notReadyAt + MODEL.toleration) {
        st.pods.forEach(function (p) { if (p.node === n.name && p.term === null) { p.term = t; p.evicted = true; p.exitAt = Infinity; p.sigterm = t; } });
      }
      if (n.up && !n.ready && t >= n.readyAt) {
        n.ready = true; n.notReadyAt = null;
        st.pods = st.pods.filter(function (p) { return !(p.node === n.name && p.term !== null); });
        st.pods.forEach(function (p) {
          if (p.node === n.name) { p.lost = false; p.up = null; p.ready = false; p.checked = false; p.start = t; p.restarts++; p.lastRestart = t; }
        });
      }
    });
    st.pods = st.pods.filter(function (p) { return !(p.term !== null && t >= p.exitAt); });
    st.pods.forEach(function (p) {
      var n = node(st, p.node);
      if (!p.node) { place(st, p); return; }
      if (!n.up || p.term !== null) return;
      if (p.nextStart !== null && t >= p.nextStart) { p.start = t; p.nextStart = null; p.crashAt = null; p.checked = false; p.restarts++; p.lastRestart = t; }
      if (p.start === null || t < p.start || p.crashAt !== null) return;
      if (p.app === "catalog" && !p.checked && t >= p.start + MODEL.toDb) {
        p.checked = true;
        if (!dbReady(st)) { p.crashAt = t; p.nextStart = t + MODEL.backoff * Math.pow(2, p.restarts); return; }
        p.up = p.start + MODEL.jvm + p.jitter + (st.migrated ? 0 : MODEL.migrate);
      }
      if (p.app === "db" && p.up === null) p.up = p.start + (p.restarts ? 5 : MODEL.dbReady);
      if (p.app === "redis" && p.up === null) p.up = p.start + MODEL.redisReady;
      if (p.up !== null && t >= p.up && !p.ready && !p.lost) {
        if (p.app === "catalog") st.migrated = true;
        /* the readiness probe, or without it the startup probe: either runs every 5 s from the container's start */
        var period = p.readiness ? LAB.readinessPeriod : LAB.startupPeriod;
        if ((t - p.start) % period === 0) p.ready = true;
      }
    });
    if (st.applied) {
      reconcile(st, "catalog"); reconcile(st, "redis");
      if (!st.pods.some(function (p) { return p.app === "db"; })) newPod(st, "db");
    }
    st.ep[t] = active(st, "catalog").filter(function (p) { return p.ready; }).map(function (p) { return p.name; });
    delete st.ep[t - 20];
    traffic(st);
  }
  function advance(st, secs) { for (var i = 0; i < secs; i++) tick(st); }

  /* Traefik's view of the catalog endpoints: the API's, lag seconds ago */
  function traefik(st) { var at = Math.max(0, st.t - st.lag); while (at > 0 && !st.ep[at]) at--; return st.ep[at] || []; }
  function traffic(st) {
    var k = st.k6;
    if (!k || st.t <= k.start || st.t > k.end) return;
    var list = traefik(st);
    for (var i = 0; i < k.rate; i++) {
      k.total++;
      if (!list.length) { k.failed++; k.c503++; continue; }
      var name = list[st.rr++ % list.length], p = st.pods.filter(function (x) { return x.name === name; })[0];
      if (!p || !accepting(st, p)) { k.failed++; k.c502++; }
    }
  }

  /* ------------------------------------------------------------------ kubectl and friends */

  function age(s) {
    s = Math.max(0, Math.round(s));
    if (s < 120) return s + "s";
    if (s < 600) return Math.floor(s / 60) + "m" + (s % 60 ? (s % 60) + "s" : "");
    return Math.floor(s / 60) + "m";
  }
  function pad(x, n) { x = String(x); while (x.length < n) x += " "; return x; }
  function status(st, p) {
    if (p.term !== null) return "Terminating";
    if (!p.node) return "Pending";
    if (p.crashAt !== null) return st.t - p.crashAt < 3 ? "Error" : "CrashLoopBackOff";
    if (p.start === null || st.t < p.start) return "ContainerCreating";
    return "Running";
  }
  function row(st, p) {
    return { name: p.name, app: p.app, node: p.node, status: status(st, p), ready: p.ready, restarts: p.restarts, accepting: accepting(st, p) };
  }

  function cmdApply(st) {
    var first = !st.applied, changed = st.catalog.readiness !== true || st.catalog.preStop !== LAB.preStop;
    st.applied = true;
    if (changed) { st.catalog.readiness = true; st.catalog.preStop = LAB.preStop; st.catalog.hash = rand(st, 9 + Math.floor(st.rng() * 2), "0123456789abcdef"); }
    tick(st);
    var out = first ? APPLY.slice() : APPLY.map(function (l) { return l.replace(/ created$/, l.indexOf("deployment.apps/catalog") === 0 && changed ? " configured" : " unchanged"); });
    return { cmd: "$ kubectl apply -k k8s/overlays/local", out: out, tone: "ok",
      note: first ? ["kubectl sends the desired state; every pod starts at once — there is no depends_on.", "O kubectl envia o estado desejado; todos os pods iniciam juntos — não existe depends_on."]
        : changed ? ["The probes and the preStop pause are back in the template: a new rollout.", "As probes e a pausa do preStop voltam ao template: um novo rollout."]
          : ["Nothing changed: apply is idempotent.", "Nada mudou: o apply é idempotente."] };
  }
  function cmdPods(st) {
    var ps = st.pods.slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; }), w = ps.reduce(function (m, p) { return Math.max(m, p.name.length); }, 4) + 3;
    var out = [pad("NAME", w) + "READY   STATUS              RESTARTS        AGE     NODE"].concat(ps.map(function (p) {
      var r = p.restarts ? p.restarts + " (" + age(st.t - p.lastRestart) + " ago)" : "0";
      return pad(p.name, w) + pad((p.ready ? 1 : 0) + "/1", 8) + pad(status(st, p), 20) + pad(r, 16) + pad(age(st.t - p.created), 8) + (p.node || "<none>");
    }));
    if (!ps.length) out = ["No resources found in boxoffice namespace."];
    var cat = pods(st, "catalog"), bad = cat.filter(function (p) { return /Error|CrashLoop/.test(status(st, p)); }).length;
    var lostP = cat.filter(function (p) { return p.lost && p.term === null; }).length, termP = cat.filter(function (p) { return p.term !== null; }).length;
    var ready = active(st, "catalog").filter(function (p) { return p.ready; }).length;
    var note = bad ? ["catalog reached PostgreSQL before db-0 was ready: Flyway failed, the JVM exited, the kubelet restarts it with a back-off.", "O catalog chegou ao PostgreSQL antes de o db-0 ficar pronto: o Flyway falhou, a JVM saiu e o kubelet a reinicia com back-off."]
      : lostP ? ["The node is NotReady: its pod still shows Running, but READY 0/1 — it left the endpoints and waits for the eviction.", "O nó está NotReady: o pod dele ainda mostra Running, mas READY 0/1 — saiu dos endpoints e espera o despejo."]
        : termP ? ["Terminating pods have already left the endpoints; the ReplicaSet counts only the others.", "Pods em Terminating já saíram dos endpoints; o ReplicaSet conta só os outros."]
          : ready === st.catalog.replicas ? ["Every pod 1/1: the actual state matches the desired state.", "Todos os pods 1/1: o estado real é igual ao desejado."]
            : ["catalog: " + ready + " of " + st.catalog.replicas + " ready — the controllers are still converging.", "catalog: " + ready + " de " + st.catalog.replicas + " prontos — os controladores ainda estão convergindo."];
    return { cmd: "$ kubectl -n boxoffice get pods -o wide", out: out, rows: ps.map(function (p) { return row(st, p); }), tone: bad ? "warn" : "info", note: note };
  }
  function cmdNodes(st) {
    var out = ["NAME                      STATUS     ROLES           AGE   VERSION"].concat(st.nodes.map(function (n) {
      return pad(n.name, 26) + pad(n.ready ? "Ready" : "NotReady", 11) + pad(n.worker ? "<none>" : "control-plane", 16) + pad(age(st.t + 600), 6) + "v1.37.0";
    }));
    var down = st.nodes.filter(function (n) { return !n.up; })[0];
    return { cmd: "$ kubectl get nodes", out: out, nodes: st.nodes.map(function (n) { return n.name + " " + (n.ready ? "Ready" : "NotReady"); }),
      tone: st.nodes.every(function (n) { return n.ready; }) ? "info" : "warn",
      note: down && down.ready ? [down.name + " is stopped, but still Ready: the control plane waits " + MODEL.nodeGrace + " s without heartbeats before saying NotReady.", down.name + " está parado, mas ainda Ready: o control plane espera " + MODEL.nodeGrace + " s sem heartbeats antes de dizer NotReady."]
        : down ? [down.name + " NotReady: its pods leave the endpoints now and are evicted after the " + MODEL.toleration + " s toleration.", down.name + " NotReady: os pods dele saem dos endpoints agora e são despejados depois da tolerância de " + MODEL.toleration + " s."]
          : ["Three nodes Ready: one control plane, two workers.", "Três nós Ready: um control plane e dois workers."] };
  }
  function cmdDelete(st) {
    var cat = active(st, "catalog");
    cat.forEach(function (p) { terminate(st, p); });
    var out = cat.map(function (p) { return "pod \"" + p.name + "\" deleted"; });
    tick(st);
    return { cmd: "$ kubectl -n boxoffice delete pod -l app=catalog --wait=false", out: out, tone: "warn",
      note: ["The ReplicaSet sees 0 of " + st.catalog.replicas + " and creates two pods at once; until a JVM is ready no catalog pod is an endpoint.", "O ReplicaSet vê 0 de " + st.catalog.replicas + " e cria dois pods na hora; até uma JVM ficar pronta nenhum pod do catalog é endpoint."] };
  }
  function cmdRollout(st) {
    st.catalog.hash = rand(st, 9 + Math.floor(st.rng() * 2), "0123456789abcdef");
    st.catalog.restartedAt = st.t;
    tick(st);
    return { cmd: "$ kubectl -n boxoffice rollout restart deployment/catalog", out: ["deployment.apps/catalog restarted"], tone: "ok",
      note: ["maxSurge " + LAB.maxSurge + ", maxUnavailable " + LAB.maxUnavailable + ": one new pod first; an old one terminates only when the new one is ready.", "maxSurge " + LAB.maxSurge + ", maxUnavailable " + LAB.maxUnavailable + ": primeiro um pod novo; um antigo só termina quando o novo está pronto."] };
  }
  function cmdPatch(st, readiness, preStop) {
    var was = [st.catalog.readiness, st.catalog.preStop];
    st.catalog.readiness = readiness; st.catalog.preStop = preStop;
    if (was[0] !== readiness || was[1] !== preStop) st.catalog.hash = rand(st, 9 + Math.floor(st.rng() * 2), "0123456789abcdef");
    tick(st);
    var ops = [];
    if (was[0] && !readiness) ops.push('{"op": "remove", "path": "/spec/template/spec/containers/0/readinessProbe"}');
    if (was[1] && !preStop) ops.push('{"op": "remove", "path": "/spec/template/spec/containers/0/lifecycle"}');
    var cmd = ops.length ? "$ kubectl -n boxoffice patch deployment catalog --type=json -p '[" + ops.join(", ") + "]'"
      : "$ kubectl apply -k k8s/overlays/local   # " + (readiness ? "readinessProbe" : "") + (readiness && preStop ? " + " : "") + (preStop ? "preStop" : "") + " back";
    return { cmd: cmd, out: ["deployment.apps/catalog " + (ops.length ? "patched" : "configured")], tone: "warn",
      note: ["A new pod template: the Deployment rolls it out. Wait for the rollout before measuring.", "Um template de pod novo: o Deployment faz o rollout. Espere o rollout antes de medir."] };
  }
  function cmdNode(st, up) {
    var n = node(st, NODES[2]);
    if (up && !n.up) { n.up = true; n.readyAt = st.t + MODEL.nodeBoot; }
    if (!up && n.up) { n.up = false; n.downAt = st.t; }
    tick(st);
    return { cmd: "$ docker " + (up ? "start " : "stop ") + NODES[2], out: [NODES[2]], tone: up ? "ok" : "bad",
      note: up ? ["The node comes back empty of evicted pods; nothing moves back to it by itself.", "O nó volta sem os pods despejados; nada volta para ele sozinho."]
        : ["The node's container stops: its pods stop answering at once, but the control plane does not know yet.", "O contêiner do nó para: os pods dele param de responder na hora, mas o control plane ainda não sabe."] };
  }
  function cmdK6(st, rate, secs) {
    st.k6 = { start: st.t, end: st.t + secs, rate: rate, total: 0, failed: 0, c502: 0, c503: 0 };
    st.k6runs.push(st.k6);
    return { cmd: "$ k6 run -e RATE=" + rate + " -e DURATION=" + (secs % 60 ? secs + "s" : secs / 60 + "m") + " load/catalog-otel.js &", out: [], tone: "info",
      note: ["Lab 8's script: " + rate + " requests per second through Traefik, whatever the latency.", "O script do lab 8: " + rate + " requisições por segundo pelo Traefik, qualquer que seja a latência."] };
  }
  function k6summary(k) {
    return "http_req_failed................: " + (100 * k.failed / Math.max(1, k.total)).toFixed(2) + "%  " + k.failed + " out of " + k.total;
  }
  function cmdWait(st, secs) {
    var k = st.k6, ended = k && st.t < k.end && st.t + secs >= k.end;
    advance(st, secs);
    var r = { cmd: "# … " + age(secs) + " later (t = " + clock(st.t) + ")", out: [], tone: "info", note: null };
    if (ended) { r.cmd = "$ wait   # k6 ends"; r.out = [k6summary(k)]; r.k6 = { total: k.total, failed: k.failed, c502: k.c502, c503: k.c503 }; r.tone = k.failed ? "bad" : "ok";
      r.note = k.failed ? [k.failed + " of " + k.total + " requests failed (" + k.c502 + " sent to a pod that no longer accepted, " + k.c503 + " with no endpoint at all).", k.failed + " de " + k.total + " requisições falharam (" + k.c502 + " enviadas a um pod que não aceitava mais, " + k.c503 + " sem nenhum endpoint)."]
        : ["No request failed.", "Nenhuma requisição falhou."]; }
    return r;
  }
  function cmdCurl(st) {
    tick(st);
    var list = traefik(st), code = 503;
    if (list.length) {
      var p = st.pods.filter(function (x) { return x.name === list[st.rr % list.length]; })[0];
      st.rr++;
      code = p && accepting(st, p) ? 200 : 502;
    }
    return { cmd: "$ curl -s -o /dev/null -w '%{http_code}\\n' localhost/catalog/events/1", out: [String(code)], code: code, tone: code === 200 ? "ok" : "bad",
      note: code === 200 ? ["Traefik → Service catalog → a ready pod.", "Traefik → Service catalog → um pod pronto."]
        : code === 503 ? ["503: Traefik has no ready catalog endpoint to send to.", "503: o Traefik não tem endpoint pronto do catalog para onde mandar."]
          : ["502: Traefik sent the request to a pod that no longer accepts it.", "502: o Traefik mandou a requisição para um pod que não a aceita mais."] };
  }
  function clock(s) { return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }

  var SCRIPTS = {
    deploy: [
      { ops: [["apply"]], en: "kubectl apply -k: every object at once, in no particular order.", pt: "kubectl apply -k: todos os objetos de uma vez, sem ordem." },
      { ops: [["wait", 13], ["pods"]], en: "catalog reached PostgreSQL before db-0 accepted connections: Flyway fails and the JVM exits.", pt: "O catalog chegou ao PostgreSQL antes de o db-0 aceitar conexões: o Flyway falha e a JVM sai." },
      { ops: [["wait", 25], ["pods"]], en: "Restarted after 10 s, failed again: the next back-off is 20 s.", pt: "Reiniciou depois de 10 s e falhou de novo: o próximo back-off é de 20 s." },
      { ops: [["wait", 20], ["pods"]], en: "db-0 is ready now; the second restart of catalog will find it.", pt: "O db-0 está pronto agora; o segundo reinício do catalog vai encontrá-lo." },
      { ops: [["wait", 153], ["pods"], ["curl"]], en: "3m31s after the apply, as on the page: RESTARTS 2, everything 1/1, and the Ingress answers 200.", pt: "3m31s depois do apply, como na página: RESTARTS 2, tudo 1/1 e o Ingress responde 200." }
    ],
    heal: [
      { ops: [["delete"], ["pods"]], en: "Both catalog pods deleted: two new ones are created at once.", pt: "Os dois pods do catalog apagados: dois novos são criados na hora." },
      { ops: [["wait", 9], ["curl"]], en: "The old pods are gone and the new JVMs are starting: no endpoint, 503.", pt: "Os pods antigos sumiram e as JVMs novas estão iniciando: nenhum endpoint, 503." },
      { ops: [["until", "healed"], ["pods"], ["curl"]], en: "Both new pods 1/1: that time is the MTTR of a pod crash, dominated by JVM startup.", pt: "Os dois pods novos 1/1: esse tempo é o MTTR de uma queda de pod, dominado pela partida da JVM." }
    ],
    node: [
      { ops: [["k6", 100, 120], ["node", false], ["nodes"]], en: "k6 running; boxoffice-worker2 stopped. Still Ready for the control plane.", pt: "k6 rodando; boxoffice-worker2 parado. Ainda Ready para o control plane." },
      { ops: [["wait", 50], ["nodes"], ["pods"]], en: "NotReady after 50 s without heartbeats: the pod on worker2 leaves the endpoints, but is not replaced.", pt: "NotReady depois de 50 s sem heartbeats: o pod do worker2 sai dos endpoints, mas não é substituído." },
      { ops: [["wait", 70]], en: "k6 ends: every request sent to the dead pod before the endpoint update failed.", pt: "O k6 termina: toda requisição mandada ao pod morto antes da atualização dos endpoints falhou." },
      { ops: [["wait", 180], ["pods"]], en: "One pod carries catalog: the dead one waits for the eviction.", pt: "Um pod carrega o catalog: o morto espera o despejo." },
      { ops: [["until", "replaced"], ["pods"]], en: "Evicted after the 300 s toleration; its replacement runs on boxoffice-worker.", pt: "Despejado depois da tolerância de 300 s; o substituto roda no boxoffice-worker." },
      { ops: [["node", true], ["wait", 15], ["nodes"], ["pods"]], en: "worker2 is back and Ready, and empty: nothing moves back by itself.", pt: "O worker2 voltou, Ready e vazio: nada volta sozinho para ele." }
    ],
    rollout: [
      { ops: [["k6", 100, 120], ["wait", 30], ["rollout"]], en: "With the probes: k6 at 100 req/s, rollout restart after 30 s.", pt: "Com as probes: k6 a 100 req/s e rollout restart depois de 30 s." },
      { ops: [["wait", 30], ["pods"]], en: "A new pod is ready; one old pod is terminating, still serving through its preStop pause.", pt: "Um pod novo está pronto; um antigo está terminando e ainda atende durante a pausa do preStop." },
      { ops: [["wait", 60]], en: "k6 ends: no request failed.", pt: "O k6 termina: nenhuma requisição falhou." },
      { ops: [["patch", false, 0], ["wait", 80], ["pods"]], en: "Remove the readiness probe and the preStop pause, and wait for that rollout.", pt: "Remova a readiness probe e a pausa do preStop e espere esse rollout." },
      { ops: [["k6", 100, 120], ["wait", 30], ["rollout"]], en: "The same experiment, without them.", pt: "O mesmo experimento, sem elas." },
      { ops: [["wait", 90]], en: "k6 ends: requests failed while Traefik still listed the old pods that had stopped accepting.", pt: "O k6 termina: requisições falharam enquanto o Traefik ainda listava os pods antigos que já não aceitavam." },
      { ops: [["apply"], ["wait", 80], ["pods"]], en: "kubectl apply -k restores the probes and the preStop pause.", pt: "kubectl apply -k restaura as probes e a pausa do preStop." }
    ]
  };

  /* wait until a condition holds (at most 10 min) */
  function cmdUntil(st, what) {
    var t0 = st.t, ok = {
      healed: function () { return traefik(st).length === st.catalog.replicas; },   /* ready, and Traefik knows it */
      replaced: function () { return traefik(st).length === st.catalog.replicas && active(st, "catalog").every(function (p) { return p.node === NODES[1]; }); }
    }[what];
    var from = what === "healed" ? st.healFrom : st.nodeFrom;
    while (!ok() && st.t - t0 < 600) tick(st);
    var r = { cmd: "# … until " + (what === "healed" ? "both pods are 1/1" : "the replacement is 1/1") + " (t = " + clock(st.t) + ")", out: [], tone: "ok", note: null };
    if (from !== undefined) r.after = st.t - from;
    return r;
  }

  var OPS = { apply: cmdApply, pods: cmdPods, nodes: cmdNodes, delete: cmdDelete, rollout: cmdRollout, patch: cmdPatch,
    node: cmdNode, k6: cmdK6, wait: cmdWait, until: cmdUntil, curl: cmdCurl };
  function run(st, op) {
    if (op[0] === "delete") st.healFrom = st.t;
    if (op[0] === "node" && op[1] === false) st.nodeFrom = st.t;
    return OPS[op[0]].apply(null, [st].concat(op.slice(1)));
  }
  function startOf(name) { return { deployed: name !== "deploy" }; }
  function play(name, n, o) {
    var opt = startOf(name); o = o || {}; if (o.lag) opt.lag = o.lag;
    var st = create(opt), out = [];
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (step) { step.ops.forEach(function (op) { out.push(run(st, op)); }); });
    return { st: st, out: out };
  }
  /* experiment B on a deployed, warm cluster: k6 at rate for duration, rollout restart at rolloutAt */
  function experimentB(o) {
    o = o || {};
    var st = create({ deployed: true, lag: o.lag });
    if (o.readiness === false || o.preStop === 0) { cmdPatch(st, o.readiness !== false, o.preStop === 0 ? 0 : LAB.preStop); advance(st, 120); }
    cmdK6(st, LAB.rate, LAB.duration); advance(st, LAB.rolloutAt); cmdRollout(st);
    var r = cmdWait(st, LAB.duration);
    return r.k6;
  }

  var API = { LAB: LAB, MODEL: MODEL, NODES: NODES, APPLY: APPLY, SCRIPTS: SCRIPTS, create: create, advance: advance, run: run, play: play,
    experimentB: experimentB, traefik: traefik, status: status, accepting: accepting, startOf: startOf };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  function L(pair) { return pair ? (PT ? pair[1] : pair[0]) : ""; }
  var TONE = { Running: "ok", ContainerCreating: "warn", Pending: "warn", Error: "bad", CrashLoopBackOff: "bad", Terminating: "down" };

  C.style("kind-lab", [
    ".md-typeset .csim .csim-kl-frame { stroke-dasharray: 3 2; }",
    ".md-typeset .csim-log.csim-kl-term li { font-family: var(--md-code-font-family, monospace); font-size: .6rem; white-space: pre; overflow-x: auto; }",
    ".md-typeset .csim-log.csim-kl-term li b { font-weight: 600; }"
  ].join("\n"));

  C.register("kind-lab", function (root) {
    var o = C.opts(root, { script: "deploy" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st, lag = MODEL.lag;

    var svg = s("svg", { viewBox: "0 0 640 236", role: "img", "aria-label": t("kind cluster", "Cluster kind") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(6); term.className += " csim-kl-term";
    var tiles = C.stats([
      { key: "clock", label: t("time", "tempo") },
      { key: "ready", label: t("catalog ready", "catalog prontos") },
      { key: "nodes", label: t("nodes Ready", "nós Ready") },
      { key: "failed", label: t("k6 failed", "falhas no k6") }
    ]);
    function say(pair, tone) { note.textContent = L(pair); note.className = "csim-note" + (tone && tone !== "info" ? " csim-" + tone : ""); }
    function show(r) { term.add(el("span", {}, [el("b", { text: r.cmd }), r.out.length ? "\n" + r.out.join("\n") : ""]), r.tone === "info" ? "" : r.tone); }

    var cScript = C.choice({ label: t("Lab part", "Parte do lab"), value: script, options: [
      { value: "deploy", label: "apply -k" }, { value: "heal", label: t("self-healing", "autocorreção") },
      { value: "node", label: t("losing a node", "perder um nó") }, { value: "rollout", label: t("rollout (B)", "rollout (B)") },
      { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; player.reset(); } });

    function act(fn) { return function () { player.pause(); var r = fn(); if (r) { show(r); say(r.note, r.tone); } draw(); }; }
    var bApply = C.button("apply -k", act(function () { return run(st, ["apply"]); }));
    var bPods = C.button("get pods", act(function () { return run(st, ["pods"]); }));
    var bNodes = C.button("get nodes", act(function () { return run(st, ["nodes"]); }));
    var bCurl = C.button("curl", act(function () { return run(st, ["curl"]); }), { tone: "ok" });
    var bDel = C.button("delete pod -l app=catalog", act(function () { return run(st, ["delete"]); }), { tone: "bad" });
    var bRoll = C.button("rollout restart", act(function () { return run(st, ["rollout"]); }));
    var bNode = C.button("docker stop worker2", act(function () { return run(st, ["node", !node(st, NODES[2]).up]); }), { tone: "bad" });
    var bK6 = C.button("k6 100 req/s · 2m", act(function () { return run(st, ["k6", LAB.rate, LAB.duration]); }));
    var cWait = C.choice({ label: t("wait", "esperar"), value: 0, options: [5, 30, 120, 300].map(function (x) { return { value: x, label: "+" + age(x) }; }),
      onChange: act(function () { var r = run(st, ["wait", cWait.get()]); cWait.set(0); return r; }) });
    var sRdy = C.toggle({ label: "readinessProbe", checked: true, onChange: act(function () { return run(st, ["patch", sRdy.get(), sPre.get() ? LAB.preStop : 0]); }) });
    var sPre = C.toggle({ label: "preStop " + LAB.preStop + " s", checked: true, onChange: act(function () { return run(st, ["patch", sRdy.get(), sPre.get() ? LAB.preStop : 0]); }) });
    var sLag = C.slider({ label: t("Traefik sees endpoint changes after", "O Traefik vê mudanças de endpoint depois de"), min: 1, max: 8, value: lag, fmt: function (v) { return v + " s"; },
      onInput: function (v) { lag = v; if (st) st.lag = v; } });

    var player = C.player({ interval: 2200, onTick: function (k) { return step(k); }, onPrev: function (k) { replay(k); }, onReset: function () { reset(); } });

    function step(k) {
      var sc = SCRIPTS[script];
      if (!sc || k > sc.length) return false;
      var tone = "";
      sc[k - 1].ops.forEach(function (op) { var r = run(st, op); show(r); if (r.tone === "bad" || (r.tone === "warn" && tone !== "bad")) tone = r.tone; });
      say([sc[k - 1].en, sc[k - 1].pt], tone);
      draw();
    }
    function replay(k) { fresh(); for (var i = 1; i <= k; i++) step(i); if (!k) intro(); draw(); }
    function intro() {
      say(script === "free"
        ? ["The cluster after step 2, deployed and warm. Run a command, start k6, wait, and watch the pods and Traefik's endpoints.", "O cluster depois do passo 2, implantado e aquecido. Rode um comando, inicie o k6, espere e observe os pods e os endpoints do Traefik."]
        : ["Press play or → to run the page's commands; the buttons work at any time.", "Aperte play ou → para rodar os comandos da página; os botões funcionam a qualquer momento."], "");
    }
    function fresh() { st = create(script === "free" ? { deployed: true, lag: lag } : (function () { var x = startOf(script); x.lag = lag; return x; })()); term.clear(); }
    function reset() {
      fresh();
      player.total(SCRIPTS[script] ? SCRIPTS[script].length : 0);
      player.style.display = SCRIPTS[script] ? "" : "none";
      intro(); draw();
    }

    function box(x, y, w, h, cls, rx) { return s("rect", { x: x, y: y, width: w, height: h, rx: rx || 6, class: "c-box " + cls }); }
    function text(x, y, str, cls, anchor) { return s("text", { x: x, y: y, class: cls || "c-small", "text-anchor": anchor || "start" }, str); }
    function short(name) { return name === "db-0" ? name : name.replace(/-[0-9a-f]{9,10}-/, "-…-"); }

    function draw() {
      C.clear(svg);
      var view = traefik(st), k = st.k6, live = k && st.t > k.start && st.t <= k.end;
      /* k6 */
      svg.appendChild(box(2, 72, 78, 60, live ? "on" : ""));
      svg.appendChild(text(41, 90, "k6", "c-label", "middle"));
      svg.appendChild(text(41, 105, live ? k.rate + " req/s" : t("idle", "parado"), "c-small", "middle"));
      svg.appendChild(text(41, 120, k ? k.failed + t(" failed", " falhas") : "", "c-small" + (k && k.failed ? " c-bad" : ""), "middle"));
      svg.appendChild(s("line", { x1: 80, y1: 102, x2: 98, y2: 102, class: "c-wire" + (live ? " on" : "") }));
      /* nodes */
      var X = [90, 274, 458], W = 178;
      st.nodes.forEach(function (n, i) {
        svg.appendChild(s("rect", { x: X[i], y: 4, width: W, height: 228, rx: 9, class: "c-box csim-kl-frame" + (n.up ? (n.ready ? "" : " warn") : " bad") }));
        svg.appendChild(text(X[i] + 8, 18, n.name.replace(CLUSTER + "-", ""), "c-label"));
        svg.appendChild(text(X[i] + W - 8, 18, !n.up ? (n.ready ? t("stopped · Ready?", "parado · Ready?") : t("stopped · NotReady", "parado · NotReady")) : n.ready ? "Ready" : "NotReady",
          "c-small" + (n.up && n.ready ? " c-ok" : " c-bad"), "end"));
      });
      /* Traefik on the control plane, with the catalog endpoints it routes to */
      svg.appendChild(box(98, 70, 162, 30 + 14 * Math.max(1, view.length), "on"));
      svg.appendChild(text(105, 85, "Traefik → catalog:" + LAB.port, "c-label"));
      if (!view.length) svg.appendChild(text(105, 99, t("no endpoint → 503", "nenhum endpoint → 503"), "c-small c-bad"));
      var where = {};
      /* pods, per worker */
      [1, 2].forEach(function (i) {
        var ps = st.pods.filter(function (p) { return p.node === NODES[i]; }).sort(function (a, b) { return a.app === b.app ? a.created - b.created : (a.app < b.app ? -1 : 1); });
        ps.forEach(function (p, j) {
          var y = 28 + j * 34, x = X[i] + 8, stt = status(st, p);
          where[p.name] = [x, y + 15];
          svg.appendChild(box(x, y, W - 16, 30, (TONE[stt] || "") + (p.lost && p.term === null ? " warn" : ""), 5));
          svg.appendChild(text(x + 5, y + 12, short(p.name), "c-small c-mono"));
          svg.appendChild(text(x + 5, y + 25, (p.ready ? "1/1 " : "0/1 ") + stt + (p.restarts ? " · " + p.restarts + "↻" : ""),
            "c-small" + (TONE[stt] === "ok" && p.ready ? " c-ok" : TONE[stt] === "bad" ? " c-bad" : "")));
        });
      });
      var pending = st.pods.filter(function (p) { return !p.node; });
      if (pending.length) svg.appendChild(text(98, 226, pending.length + " Pending", "c-small c-bad"));
      view.forEach(function (name, j) {
        var p = st.pods.filter(function (x) { return x.name === name; })[0], okp = p && accepting(st, p);
        svg.appendChild(text(105, 99 + 14 * j, (okp ? "✓ " : "✗ ") + short(name), "c-small c-mono" + (okp ? "" : " c-bad")));
        if (where[name]) svg.appendChild(s("path", { d: "M260," + (95 + 14 * j) + " C300," + (95 + 14 * j) + " " + (where[name][0] - 30) + "," + where[name][1] + " " + where[name][0] + "," + where[name][1],
          class: "c-wire" + (okp ? (live ? " on" : "") : " cut"), style: "opacity:.7" }));
      });
      var cat = active(st, "catalog"), rd = cat.filter(function (p) { return p.ready; }).length;
      tiles.set("clock", clock(st.t), "");
      tiles.set("ready", st.applied ? rd + "/" + st.catalog.replicas : "–", st.applied ? (rd >= st.catalog.replicas ? "ok" : rd ? "warn" : "bad") : "");
      var nr = st.nodes.filter(function (n) { return n.ready; }).length;
      tiles.set("nodes", nr + "/3", nr === 3 ? "ok" : "warn");
      tiles.set("failed", k ? k.failed + " / " + k.total : "–", k ? (k.failed ? "bad" : "ok") : "");
      bNode.textContent = node(st, NODES[2]).up ? "docker stop worker2" : "docker start worker2";
      sRdy.set(st.catalog.readiness); sPre.set(st.catalog.preStop > 0);
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's cluster, without kind: convergence, self-healing, a lost node and a rollout under load",
        "O cluster do lab, sem kind: convergência, autocorreção, um nó perdido e um rollout sob carga") }),
      el("p", { class: "csim-sub", text: t("Three nodes, db-0, redis and two catalog pods as k8s/base/ declares them; Traefik routes to the endpoints it knows (✗: a pod that no longer accepts). Pod colours: green Running, amber starting, red crashing, dashed terminating.",
        "Três nós, db-0, redis e dois pods do catalog como o k8s/base/ declara; o Traefik roteia para os endpoints que conhece (✗: um pod que não aceita mais). Cores dos pods: verde Running, âmbar iniciando, vermelho caindo, tracejado terminando.") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-row" }, [bApply, bPods, bNodes, bCurl, bDel, bRoll, bNode, bK6]),
      el("div", { class: "csim-row" }, [cWait, sRdy, sPre]),
      el("div", { class: "csim-row" }, [sLag]),
      note,
      player,
      el("div", { class: "csim-cols" }, [tiles, term])
    ]);
    reset();
    return {};
  });
})();
