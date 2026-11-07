/*
 * The database pair of lab 6 (2027.1), as a lab twin:
 *
 *   <div class="csim" data-sim="boxoffice-db" data-script="crash"></div>
 *
 * db (primary) and db-replica (streaming standby), the services of the lab's docker-compose.yaml,
 * with the two Docker names the services connect to: "db" (PgBouncer, auth, catalog: holds and every
 * other read and write) and "db-replica" (inventory's readOnly transactions: the seat map). Every
 * button is a command of the lab (curl a hold, the seat map or Ana's hold; the probes; docker compose
 * stop/kill/start/up --no-deps; pg_promote; moving the name db with a network alias; pg_rewind;
 * synchronous_standby_names, synchronous_commit, REPLICA_DELAY) and prints what the lab prints.
 * A script (data-script) replays one part of the lab step by step: replica (step 2, read-your-writes),
 * sync (step 4, sections 1–2), crash (sections 3–4), split-brain (sections 5–7, after crash); "free"
 * leaves only the buttons.
 *
 * The model: each node holds the WAL history it has received (hist) and replays an entry
 * REPLICA_DELAY after receiving it. Streaming is instantaneous while both nodes are up. A name
 * resolves to the running containers that hold it; the services' pools take LAB.reconnect ms to drop
 * broken connections after the name moves; a request the gateway cannot finish answers 504 after
 * LAB.timeout ms. pg_promote starts a new timeline; pg_rewind (only with wal_log_hints) cuts the old
 * primary back to the fork, discarding what only it had.
 */
(function () {
  "use strict";

  var LAB = { delay: 1000, timeout: 5000, reconnect: 15000 };   /* ms: REPLICA_DELAY=1s, gateway response-timeout, sleep 15 */
  var NAMES = ["db", "db-replica"];
  var IP = { db: "172.23.0.8", "db-replica": "172.23.0.3" };     /* the addresses the lab's getent prints */
  var SEATS = [1, 10, 20, 21, 30, 40, 90];                       /* the seats the lab's commands touch */
  var WRITE_S = 0.03, READ_S = 0.02;                             /* seconds of an answer that does not wait */

  var key = 0;
  function entry(o) { o.k = ++key; return o; }

  function create() {
    var hist = [entry({ kind: "seed", t: 0 })];
    var st = {
      now: 0, nextHold: 1, acked: [], hung: 0, rr: 0, movedAt: null, gone: [],
      alias: { db: ["db"], "db-replica": ["db-replica"] },
      nodes: NAMES.map(function (n, i) {
        var recv = {}; recv[hist[0].k] = 0;
        return { name: n, up: true, role: i ? "replica" : "primary", tl: 1, hist: hist.slice(), recv: recv,
          upstream: i ? "db" : null, sync: "", commit: "on", delay: 0, hints: false, diverged: false };
      })
    };
    return st;
  }

  function node(st, name) { return st.nodes.filter(function (n) { return n.name === name; })[0]; }
  function prefix(a, b) {
    if (a.length > b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i].k !== b[i].k) return false;
    return true;
  }
  function common(a, b) { var i = 0; while (i < a.length && i < b.length && a[i].k === b[i].k) i++; return i; }
  function primaries(st) { return st.nodes.filter(function (n) { return n.up && n.role === "primary"; }); }
  /* the primary that wins: the newest timeline */
  function primary(st) { return primaries(st).sort(function (a, b) { return b.tl - a.tl; })[0] || null; }

  /* every running replica copies its upstream's history, if it continues its own */
  function stream(st) {
    st.nodes.forEach(function (n) {
      if (!n.up || n.role !== "replica") return;
      var u = node(st, n.upstream);
      if (!u || !u.up) return;
      if (!prefix(n.hist, u.hist)) { n.diverged = true; return; }
      n.diverged = false;
      u.hist.forEach(function (e) { if (n.recv[e.k] === undefined) n.recv[e.k] = st.now; });
      n.hist = u.hist.slice();
      n.tl = u.tl;
    });
  }
  function connected(st, r) {
    var u = node(st, r.upstream);
    return r.up && r.role === "replica" && !r.diverged && u && u.up && prefix(r.hist, u.hist);
  }
  /* how many entries a node has replayed: a primary all; a replica those received REPLICA_DELAY ago */
  function applied(st, n) {
    if (n.role === "primary") return n.hist.length;
    var i = 0;
    while (i < n.hist.length && n.recv[n.hist[i].k] !== undefined && n.recv[n.hist[i].k] + n.delay <= st.now) i++;
    return i;
  }
  /* the seats as a node sees them: replay its applied entries */
  function seats(st, n) {
    var s = {};
    SEATS.forEach(function (x) { s[x] = "AVAILABLE"; });
    n.hist.slice(0, applied(st, n)).forEach(function (e) {
      if (e.kind === "hold") e.seats.forEach(function (x) { s[x] = "HELD"; });
      if (e.kind === "reset") SEATS.forEach(function (x) { s[x] = "AVAILABLE"; });
    });
    return s;
  }
  function hasHold(st, n, id) {
    var live = false;
    n.hist.slice(0, applied(st, n)).forEach(function (e) {
      if (e.kind === "hold" && e.id === id) live = true;
      if (e.kind === "reset") live = false;
    });
    return live;
  }
  /* the holds that answered 201 and are not on the winning primary */
  function lost(st) {
    var p = primary(st);
    if (!p) return st.gone.slice();
    var out = st.gone.slice();
    st.acked.forEach(function (a) {
      if (out.indexOf(a.id) < 0 && !p.hist.some(function (e) { return e.k === a.k; }) && !a.reset) out.push(a.id);
    });
    return out;
  }
  function holdName(id) { return "hold-" + id; }

  /* the running containers that answer for a Docker name */
  function resolve(st, name) {
    return (st.alias[name] || []).map(function (c) { return node(st, c); }).filter(function (n) { return n.up; });
  }
  function reconnecting(st) { return st.movedAt !== null && st.now < st.movedAt + LAB.reconnect; }
  function sec(x) { return x.toFixed(2) + "s"; }

  function tell(cmd, out, tone, en, pt, extra) {
    var r = { cmd: cmd, out: out, tone: tone, note: [en, pt] };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
  }

  /* a write through PgBouncer to the name db: a hold, or reset-inventory.sh */
  function write(st, e) {
    var pool = resolve(st, "db");
    if (!pool.length || reconnecting(st)) return { status: 504, why: pool.length ? "reconnect" : "down" };
    var n = pool[st.rr++ % pool.length];
    if (n.role !== "primary") return { status: 500, why: "readonly", node: n };
    if (e.kind === "hold") {
      var s = seats(st, n), taken = e.seats.filter(function (x) { return s[x] !== "AVAILABLE"; });
      if (taken.length) return { status: 409, node: n, taken: taken };
    }
    e.t = st.now;
    n.hist.push(entry(e));
    stream(st);
    var wait = 0;
    if (n.sync) {
      var standby = st.nodes.filter(function (r) { return r.upstream === n.name && connected(st, r) && n.sync.indexOf('"' + r.name + '"') >= 0; })[0];
      if (!standby) { st.hung++; return { status: 504, why: "sync", node: n, committed: true }; }
      if (n.commit === "remote_apply") wait = Math.max(0, standby.recv[e.k] + standby.delay - st.now) / 1000;
    }
    st.now += Math.round((wait + WRITE_S) * 1000);
    return { status: e.kind === "hold" ? 201 : 200, node: n, secs: wait + WRITE_S };
  }

  var CURL = "$ curl -X POST localhost/inventory/holds";
  function hold(st, list) {
    list = list || [nextSeat(st)];
    var id = st.nextHold, e = { kind: "hold", id: id, seats: list };
    var cmd = CURL + " -d '{\"eventId\":1,\"seatIds\":[" + list.join(",") + "]}'";
    var w = write(st, e);
    if (w.status === 504) {
      st.now += LAB.timeout;
      if (w.why === "sync") {
        st.nextHold++;
        return tell(cmd, ["504 after " + sec(LAB.timeout / 1000) + " (gateway timeout)", "db: WARNING: canceling wait for synchronous replication",
          "DETAIL: The transaction has already committed locally, but might not have been replicated to the standby."], "warn",
          "The fan sees 504, but the hold is committed on db: the commit only waits for a standby of '" + w.node.sync + "', and none is streaming. Seat " + list.join(", ") + " is HELD.",
          "O fã vê 504, mas o hold está confirmado em db: o commit só espera um standby de '" + w.node.sync + "' e nenhum está recebendo o WAL. O assento " + list.join(", ") + " está HELD.",
          { status: 504, committed: true });
      }
      return tell(cmd, ["504 after " + sec(LAB.timeout / 1000) + " (gateway timeout)"], "bad",
        w.why === "reconnect" ? "The name db already points at the new primary, but the pools still hold broken connections: wait about " + LAB.reconnect / 1000 + " s." : "No running primary answers the name db: every write waits until the gateway gives up.",
        w.why === "reconnect" ? "O nome db já aponta para o novo primário, mas os pools ainda têm conexões quebradas: espere uns " + LAB.reconnect / 1000 + " s." : "Nenhum primário no ar responde pelo nome db: toda escrita espera até o gateway desistir.",
        { status: 504 });
    }
    if (w.status === 500) {
      return tell(cmd, ["500 Internal Server Error", "ERROR: cannot execute INSERT in a read-only transaction"], "bad",
        "This connection to db landed on " + w.node.name + ", a standby: the name db resolves to two containers. Finish the switchback.",
        "Esta conexão a db caiu em " + w.node.name + ", um standby: o nome db resolve para dois contêineres. Termine o switchback.", { status: 500 });
    }
    if (w.status === 409) {
      return tell(cmd, ["409 Conflict"], "warn", "Seat " + w.taken.join(", ") + " is already held on " + w.node.name + ".",
        "O assento " + w.taken.join(", ") + " já está reservado em " + w.node.name + ".", { status: 409 });
    }
    st.nextHold++;
    st.acked.push({ id: id, k: e.k });
    var behind = st.nodes.filter(function (r) { return r !== w.node && (r.role === "replica" || r.up) && !(connected(st, r) && r.upstream === w.node.name); });
    var lag = (node(st, "db-replica").delay / 1000) + " s";
    return tell(cmd, ["201 Created after " + sec(w.secs), "{\"id\":\"" + holdName(id) + "\",\"status\":\"ACTIVE\",\"seatIds\":[" + list.join(",") + "]}"], "ok",
      w.node.sync ? (w.node.commit === "remote_apply" ? "remote_apply: the commit waited until db-replica replayed the hold (REPLICA_DELAY " + lag + "), so a read on the replica now sees it." : "Committed after db-replica had the WAL on disk: one more copy exists before Ana hears 201.")
        : behind.length ? "Committed on " + w.node.name + " only: " + behind.map(function (r) { return r.name; }).join(", ") + " does not stream from it, so " + w.node.name + " holds the only copy." : "Committed on " + w.node.name + " (asynchronous: it did not wait for db-replica).",
      w.node.sync ? (w.node.commit === "remote_apply" ? "remote_apply: o commit esperou db-replica aplicar o hold (REPLICA_DELAY " + lag + "), então uma leitura na réplica já o vê." : "Confirmado depois que db-replica gravou o WAL em disco: existe mais uma cópia antes de Ana ouvir 201.")
        : behind.length ? "Confirmado só em " + w.node.name + ": " + behind.map(function (r) { return r.name; }).join(", ") + " não recebe seu WAL, então " + w.node.name + " tem a única cópia." : "Confirmado em " + w.node.name + " (assíncrono: não esperou db-replica).",
      { status: 201, id: id, secs: w.secs });
  }
  function nextSeat(st) {
    var p = primary(st), s = p ? seats(st, p) : {};
    for (var i = 0; i < SEATS.length; i++) if (s[SEATS[i]] === "AVAILABLE") return SEATS[i];
    return SEATS[SEATS.length - 1];
  }

  function reset(st) {
    var cmd = "$ bash scripts/reset-inventory.sh";
    var w = write(st, { kind: "reset" });
    if (w.status === 200) {
      st.acked.forEach(function (a) { a.reset = true; });
      return tell(cmd, ["UPDATE 60000" + (w.secs > WRITE_S + 0.001 ? "  (" + sec(w.secs) + ")" : "")], "info", "Every seat back on sale.", "Todos os assentos de volta à venda.");
    }
    if (w.status === 504 && w.why === "sync") return tell(cmd, ["(hangs: waiting for a synchronous standby… Ctrl+C)"], "warn", "Even the reset waits for a synchronous standby.", "Até o reset espera um standby síncrono.");
    return tell(cmd, ["psql: error: connection to server failed"], "bad", "No primary answers the name db.", "Nenhum primário responde pelo nome db.");
  }

  /* GET /inventory/events/1/availability: a readOnly transaction, on the name db-replica */
  function seatMap(st) {
    var cmd = "$ curl localhost/inventory/events/1/availability";
    var pool = resolve(st, "db-replica");
    if (!pool.length) { st.now += LAB.timeout; return tell(cmd, ["504 after " + sec(LAB.timeout / 1000)], "bad", "The seat map reads from db-replica, and db-replica is down.", "O mapa de assentos lê de db-replica e db-replica está fora do ar.", { status: 504, held: [] }); }
    var n = pool[0], s = seats(st, n), p = primary(st);
    st.now += Math.round(READ_S * 1000);
    var shown = SEATS.filter(function (x) { return s[x] === "HELD"; });
    var res = tell(cmd, ["200 " + (shown.length ? "held: " + shown.join(", ") : "every listed seat AVAILABLE")], "info",
      "Read on " + n.name + ".", "Lido em " + n.name + ".", { status: 200, held: shown });
    if (p && p !== n) {
      var ps = seats(st, p), stale = SEATS.filter(function (x) { return ps[x] !== s[x]; });
      if (stale.length) {
        res.tone = "warn"; res.stale = stale;
        res.note = ["Stale read: seat " + stale.join(", ") + " is " + ps[stale[0]] + " on " + p.name + ", " + s[stale[0]] + " on " + n.name + ", which has not replayed it yet (REPLICA_DELAY " + n.delay / 1000 + " s).",
          "Leitura desatualizada: o assento " + stale.join(", ") + " está " + ps[stale[0]] + " em " + p.name + " e " + s[stale[0]] + " em " + n.name + ", que ainda não o aplicou (REPLICA_DELAY " + n.delay / 1000 + " s)."];
      }
    }
    return res;
  }

  /* GET /inventory/holds/{id}: read-your-writes, on the primary */
  function myHold(st, id) {
    id = id || (st.acked.length ? st.acked[st.acked.length - 1].id : 1);
    var cmd = "$ curl localhost/inventory/holds/" + holdName(id);
    var pool = resolve(st, "db");
    if (!pool.length || reconnecting(st)) { st.now += LAB.timeout; return tell(cmd, ["504 after " + sec(LAB.timeout / 1000)], "bad", "No primary answers the name db.", "Nenhum primário responde pelo nome db.", { status: 504 }); }
    var n = pool[st.rr++ % pool.length];
    st.now += Math.round(READ_S * 1000);
    if (hasHold(st, n, id)) return tell(cmd, ["{\"status\":\"ACTIVE\"}"], "ok", "Read on " + n.name + ": the fan sees the hold just created.", "Lido em " + n.name + ": o fã vê o hold que acabou de criar.", { status: 200 });
    return tell(cmd, ["{\"status\":404,\"title\":\"Not Found\"}"], "bad",
      "Ana's 201 hold is not on " + n.name + ": it existed only in the WAL of the old primary. That is the recovery point objective (RPO) of asynchronous replication.",
      "O hold 201 de Ana não está em " + n.name + ": existia só no WAL do primário antigo. É o objetivo de ponto de recuperação (RPO) da replicação assíncrona.", { status: 404 });
  }

  /* psql on one node: SELECT id, status FROM inventory.seats WHERE id IN (…) */
  function query(st, name, list) {
    var n = node(st, name), cmd = "$ docker compose exec " + name + " psql -c \"SELECT id, status FROM inventory.seats WHERE id IN (" + list.join(", ") + ")\"";
    if (!n.up) return tell(cmd, ["service \"" + name + "\" is not running"], "bad", name + " is stopped.", name + " está parado.");
    var s = seats(st, n);
    return tell(cmd, list.map(function (x) { return " " + x + " | " + s[x]; }), "info", name + (n.role === "primary" ? " (primary, timeline " + n.tl + ")" : " (standby)") + " answers.",
      name + (n.role === "primary" ? " (primário, timeline " + n.tl + ")" : " (standby)") + " responde.", { seats: list.map(function (x) { return s[x]; }) });
  }

  function insertOn(st, name) {
    var n = node(st, name), cmd = "$ docker compose exec " + name + " psql -c \"INSERT INTO inventory.holds VALUES (…)\"";
    if (!n.up) return tell(cmd, ["service \"" + name + "\" is not running"], "bad", name + " is stopped.", name + " está parado.");
    if (n.role === "replica") return tell(cmd, ["ERROR:  cannot execute INSERT in a read-only transaction"], "bad",
      "A standby replays the primary's WAL: a write of its own would make it diverge.", "Um standby aplica o WAL do primário: uma escrita própria o faria divergir.");
    return tell(cmd, ["INSERT 0 1"], "ok", name + " is a primary: it accepts the write.", name + " é primário: aceita a escrita.");
  }

  function probe(st, seat) {
    var out = [], tones = [];
    function line(code, secs, label) { out.push(code + " " + sec(secs) + "  " + label); tones.push(code >= 500 ? "bad" : "ok"); }
    var t0 = st.now, m = seatMap(st);
    line(m.status, (st.now - t0) / 1000, "seat map (replica)");
    t0 = st.now;
    var h = hold(st, [seat]);
    line(h.status, h.status === 504 ? LAB.timeout / 1000 : h.secs || WRITE_S, "hold (primary)");
    ["login (auth → db)", "event 1 (catalog)"].forEach(function (label) {
      var pool = resolve(st, "db");
      if (!pool.length || reconnecting(st)) { st.now += LAB.timeout; line(504, LAB.timeout / 1000, label); }
      else { st.now += Math.round(READ_S * 1000); line(200, READ_S, label); }
    });
    var bad = tones.filter(function (x) { return x === "bad"; }).length;
    var cmd = "$ probe seat-map; probe hold " + seat + "; probe login; probe event-1";
    if (!bad) return tell(cmd, out, "ok", "Every path of the stack answers.", "Todos os caminhos da pilha respondem.", { codes: [m.status, h.status, 200, 200] });
    var codes = out.map(function (l) { return +l.slice(0, 3); });
    if (codes[0] === 200 && bad === 3) return tell(cmd, out, "bad",
      "The replica keeps the seat maps alive; everything that writes, or reads from the primary, waits " + LAB.timeout / 1000 + " s for the gateway to give up.",
      "A réplica mantém o mapa de assentos vivo; tudo que escreve, ou lê do primário, espera " + LAB.timeout / 1000 + " s até o gateway desistir.", { codes: codes });
    return tell(cmd, out, "bad", h.note[0], h.note[1], { codes: codes });
  }

  function sleep(st, ms) {
    st.now += ms;
    stream(st);
    return tell("$ sleep " + ms / 1000, [], "info", (ms / 1000) + " s later.", (ms / 1000) + " s depois.");
  }

  function stop(st, name, kill) {
    var n = node(st, name), cmd = "$ docker compose " + (kill ? "kill " : "stop ") + name;
    var caught = n.role === "primary" && st.nodes.some(function (r) { return r.upstream === name && connected(st, r); });
    n.up = false;
    var rest = primaries(st);
    if (n.role === "primary" && rest.length) return tell(cmd, ["Stopped " + name], "ok",
      "Fenced: " + name + " no longer accepts writes, and " + rest[0].name + " is the only primary again.",
      "Isolado: " + name + " não aceita mais escritas e " + rest[0].name + " volta a ser o único primário.");
    if (n.role === "primary" && !kill && caught) return tell(cmd, ["Stopped " + name], "warn",
      "A clean shutdown waits until every streaming standby has the last WAL record: nothing is lost. Writes pause until a standby is promoted.",
      "Uma parada limpa espera todo standby conectado receber o último registro do WAL: nada se perde. As escritas param até um standby ser promovido.");
    if (n.role === "primary") return tell(cmd, [(kill ? "Killed " : "Stopped ") + name], "bad",
      name + " is down: nobody accepts writes" + (name === "db" ? "; the seat map still works while db-replica is up." : "."),
      name + " caiu: ninguém aceita escritas" + (name === "db" ? "; o mapa de assentos ainda funciona enquanto db-replica está no ar." : "."));
    return tell(cmd, [(kill ? "Killed " : "Stopped ") + name], "warn",
      name + " is down: it stops receiving the WAL" + (node(st, "db").sync && name === "db-replica" ? ", and every commit on db now waits for it." : "."),
      name + " caiu: para de receber o WAL" + (node(st, "db").sync && name === "db-replica" ? " e todo commit em db agora espera por ele." : "."));
  }

  function bootNode(st, n) {
    n.up = true;
    if (n.role === "replica") stream(st);
  }
  /* docker compose start: db-replica depends on db, so starting it starts db too */
  function start(st, name, noDeps) {
    var n = node(st, name), cmd = noDeps ? "$ docker compose up -d --no-deps " + name : "$ docker compose start " + name;
    var started = [];
    if (!noDeps && name === "db-replica" && !node(st, "db").up) { bootNode(st, node(st, "db")); started.push("db"); }
    bootNode(st, n); started.push(name);
    var res = tell(cmd, started.map(function (x) { return "Started " + x; }), "info", name + " is back.", name + " voltou.");
    var ps = primaries(st);
    if (ps.length > 1) {
      res.tone = "bad";
      res.note = ["Split brain: db and db-replica both run as primary, and the name db resolves to both. Each new connection lands on either one.",
        "Split brain: db e db-replica rodam como primário e o nome db resolve para os dois. Cada nova conexão cai em um deles."];
    } else if (started.length > 1) {
      res.tone = "warn";
      res.note = ["db-replica depends on db, so start brought the dead primary back too: there is nothing left to fail over. Use up -d --no-deps.",
        "db-replica depende de db, então start trouxe o primário morto de volta: não sobra nada para o failover. Use up -d --no-deps."];
    } else if (n.role === "replica" && n.diverged) {
      res.tone = "bad"; res.note = [name + " cannot follow " + n.upstream + ": its history has writes the other lacks.", name + " não consegue seguir " + n.upstream + ": sua história tem escritas que o outro não tem."];
    } else if (n.role === "replica" && !(node(st, n.upstream) || {}).up) {
      res.note = [name + " is up as a standby, but " + n.upstream + " is down: it serves what it has and waits for the WAL.", name + " está no ar como standby, mas " + n.upstream + " caiu: serve o que tem e espera o WAL."];
    } else if (n.role === "replica") res.note = [name + " streams from " + n.upstream + ".", name + " recebe o WAL de " + n.upstream + "."];
    return res;
  }

  function promote(st, name) {
    var n = node(st, name), cmd = "$ docker compose exec " + name + " psql -c \"SELECT pg_promote()\" -c \"SELECT pg_is_in_recovery()\"";
    if (!n.up) return tell(cmd, ["service \"" + name + "\" is not running"], "bad", name + " is stopped.", name + " está parado.");
    if (n.role !== "replica") return tell(cmd, ["ERROR:  recovery is not in progress"], "bad", name + " is already a primary.", name + " já é primário.");
    var others = primaries(st);
    n.role = "primary"; n.upstream = null; n.diverged = false; n.sync = ""; n.commit = "on";
    n.hist = n.hist.slice(0, applied(st, n));
    n.tl += 1;
    n.hist.push(entry({ kind: "timeline", tl: n.tl, t: st.now }));
    n.recv[n.hist[n.hist.length - 1].k] = st.now;
    var res = tell(cmd, [" pg_promote", "---", " t", " pg_is_in_recovery", "---", " f"], "ok",
      name + " now accepts writes, on timeline " + n.tl + ". The services still connect to the name db.",
      name + " agora aceita escritas, na timeline " + n.tl + ". Os serviços ainda se conectam ao nome db.", { tl: n.tl });
    if (others.length) { res.tone = "bad"; res.note = ["Split brain: " + others[0].name + " is still a primary.", "Split brain: " + others[0].name + " ainda é primário."]; }
    return res;
  }

  /* docker network disconnect/connect --alias db --alias db-replica: the name db moves */
  function moveName(st) {
    var cmd = "$ docker network connect --alias db --alias db-replica boxoffice_default boxoffice-db-replica-1";
    if (st.alias.db.indexOf("db-replica") < 0) st.alias.db.push("db-replica");
    st.movedAt = st.now;
    var r = getent(st, ["db", "db-replica"]);
    return tell(cmd, r.out, "ok", "Both names now lead to db-replica. No file changed, no service restarted: the pools reconnect within about " + LAB.reconnect / 1000 + " s.",
      "Os dois nomes agora levam a db-replica. Nenhum arquivo mudou, nenhum serviço reiniciou: os pools reconectam em uns " + LAB.reconnect / 1000 + " s.");
  }
  function getent(st, names) {
    var out = [];
    names.forEach(function (nm) { resolve(st, nm).forEach(function (n) { out.push(IP[n.name] + "        " + nm); }); });
    return tell("$ docker compose exec pgbouncer getent hosts " + names.join(" "), out.length ? out : ["(no address)"], "info",
      "Docker's DNS answers each name with the running containers that hold it.", "O DNS do Docker responde cada nome com os contêineres no ar que o têm.", { ips: out.map(function (l) { return l.split(" ")[0]; }) });
  }

  function rejoin(st, name, target) {
    var n = node(st, name), u = node(st, target);
    var cmd = "$ docker compose run --rm --no-deps --entrypoint bash " + name + " /scripts/rejoin-as-replica.sh " + target;
    if (n.up) return tell(cmd, ["(refused: " + name + " is running)"], "bad", "Fence it first: stop " + name + ".", "Isole-o antes: pare " + name + ".");
    if (!u || !u.up || u.role !== "primary") return tell(cmd, ["pg_rewind: error: could not connect to server"], "bad", target + " is not a running primary.", target + " não é um primário no ar.");
    if (!n.hints) return tell(cmd, ["pg_rewind: error: target server needs to use either data checksums or \"wal_log_hints = on\""], "bad",
      "Without wal_log_hints (section 1), the old primary cannot rejoin: the only way back is a full copy.",
      "Sem wal_log_hints (seção 1), o primário antigo não volta: o único caminho é uma cópia completa.");
    var c = common(n.hist, u.hist), gone = n.hist.slice(c).filter(function (e) { return e.kind === "hold"; });
    n.hist = n.hist.slice(0, c);
    var recv = {}; n.hist.forEach(function (e) { recv[e.k] = n.recv[e.k] === undefined ? st.now : n.recv[e.k]; }); n.recv = recv;
    n.role = "replica"; n.upstream = target; n.sync = ""; n.commit = "on"; n.diverged = false;
    gone.forEach(function (e) { if (st.gone.indexOf(e.id) < 0 && st.acked.some(function (a) { return a.id === e.id && !a.reset; })) st.gone.push(e.id); });
    var out = ["pg_rewind: connected to server"];
    if (gone.length) out.push("pg_rewind: servers diverged at WAL location … on timeline " + n.tl, "pg_rewind: rewinding from last common checkpoint", "pg_rewind: Done!");
    else out.push("pg_rewind: no rewind required");
    out.push("rejoin: " + name + " will follow " + target + " on its next start");
    return tell(cmd, out, gone.length ? "warn" : "ok",
      gone.length ? "pg_rewind discards what only " + name + " had: " + gone.map(function (e) { return holdName(e.id) + " (seats " + e.seats.join(", ") + ")"; }).join(", ") + ", gone for good." : "No rewind required: " + name + " wrote nothing that " + target + " lacks.",
      gone.length ? "pg_rewind descarta o que só " + name + " tinha: " + gone.map(function (e) { return holdName(e.id) + " (assentos " + e.seats.join(", ") + ")"; }).join(", ") + ", perdido de vez." : "Nenhum rewind necessário: " + name + " não escreveu nada que " + target + " não tenha.",
      { discarded: gone.map(function (e) { return e.id; }) });
  }

  /* section 1: ALTER SYSTEM SET wal_log_hints = on, restart, recreate the replica */
  function prepare(st) {
    var p = node(st, "db");
    p.hints = true;
    return tell("$ docker compose exec db psql -c \"ALTER SYSTEM SET wal_log_hints = on\"; docker compose restart db", [" wal_log_hints", "---", " on"], "info",
      "db now logs whole pages after a checkpoint: pg_rewind will be able to rewind it in section 6.",
      "db agora registra páginas inteiras depois de um checkpoint: o pg_rewind poderá rebobiná-lo na seção 6.");
  }

  function setSync(st, value) {
    var p = primary(st) || node(st, "db");
    p.sync = value || "";
    var cmd = "$ psql -c \"ALTER SYSTEM " + (value ? "SET synchronous_standby_names = '" + value + "'" : "RESET synchronous_standby_names") + "\" -c \"SELECT pg_reload_conf()\"";
    var r = stat(st);
    return tell(cmd, r.out, "info", value ? "Commits on " + p.name + " now wait for db-replica." : "Back to asynchronous replication: commits wait for nobody.",
      value ? "Commits em " + p.name + " agora esperam db-replica." : "De volta à replicação assíncrona: commits não esperam ninguém.");
  }
  function setCommit(st, value) {
    var p = primary(st) || node(st, "db");
    p.commit = value;
    return tell("$ psql -c \"ALTER SYSTEM " + (value === "on" ? "RESET synchronous_commit" : "SET synchronous_commit = '" + value + "'") + "\" -c \"SELECT pg_reload_conf()\"", ["ALTER SYSTEM"], "info",
      value === "remote_apply" ? "A commit now waits until the standby has replayed it." : "A commit waits until the standby has the WAL on disk (the default).",
      value === "remote_apply" ? "Um commit agora espera o standby aplicá-lo." : "Um commit espera o standby ter o WAL em disco (o padrão).");
  }
  function setDelay(st, ms) {
    var r = node(st, "db-replica");
    r.delay = ms;
    st.now += 1;
    return tell("$ REPLICA_DELAY=" + ms / 1000 + "s docker compose up -d --wait db-replica", ["Container boxoffice-db-replica-1 Healthy"], "info",
      ms ? "db-replica now replays each transaction " + ms / 1000 + " s after receiving it (recovery_min_apply_delay)." : "db-replica replays at once again: milliseconds behind.",
      ms ? "db-replica agora aplica cada transação " + ms / 1000 + " s depois de recebê-la (recovery_min_apply_delay)." : "db-replica volta a aplicar na hora: milissegundos atrás.");
  }

  function stat(st) {
    var p = primary(st), cmd = "$ psql -c \"SELECT application_name, state, sync_state FROM pg_stat_replication\"";
    if (!p) return tell(cmd, ["(no primary is up)"], "bad", "There is no primary to ask.", "Não há primário para perguntar.");
    var rs = st.nodes.filter(function (r) { return r.upstream === p.name && connected(st, r); });
    return tell(cmd, rs.length ? rs.map(function (r) { return " " + r.name + " | streaming | " + (p.sync.indexOf('"' + r.name + '"') >= 0 ? "sync" : "async"); }) : ["(0 rows)"], "info",
      "The primary lists each standby streaming from it.", "O primário lista cada standby que recebe seu WAL.", { rows: rs.map(function (r) { return r.name + ":" + (p.sync ? "sync" : "async"); }) });
  }

  /* section 7: LSNs, stop db-replica, promote db, clone a fresh db-replica */
  function lsn(st) {
    var p = primary(st), r = st.nodes.filter(function (x) { return x !== p && x.up && x.role === "replica"; })[0];
    var cmd = "$ docker compose exec " + (p ? p.name : "db") + " psql -c \"SELECT pg_current_wal_lsn(), replay_lsn FROM pg_stat_replication\"";
    if (!p || !r || !connected(st, r)) return tell(cmd, ["(0 rows)"], "warn", "No standby is streaming.", "Nenhum standby está recebendo o WAL.");
    var same = applied(st, r) === p.hist.length;
    return tell(cmd, [" 0/" + (0x9000000 + p.hist.length * 0x1c8).toString(16).toUpperCase() + " | 0/" + (0x9000000 + applied(st, r) * 0x1c8).toString(16).toUpperCase()], same ? "ok" : "warn",
      same ? "The two LSNs are equal: " + r.name + " has replayed everything, so a planned switch loses nothing." : r.name + " is behind: wait before switching.",
      same ? "Os dois LSNs são iguais: " + r.name + " aplicou tudo, então uma troca planejada não perde nada." : r.name + " está atrás: espere antes de trocar.", { equal: same });
  }
  function recreate(st, name) {
    var n = node(st, name), src = primary(st);
    var cmd = "$ docker compose rm -sf " + name + "; docker volume rm boxoffice_replica-data; docker compose up -d --wait " + name;
    if (!src) return tell(cmd, ["pg_basebackup: error: could not connect to server"], "bad", "There is no primary to clone.", "Não há primário para clonar.");
    n.up = true; n.role = "replica"; n.upstream = src.name; n.sync = ""; n.commit = "on"; n.delay = 0; n.diverged = false; n.hints = false;
    n.hist = src.hist.slice(); n.recv = {}; n.hist.forEach(function (e) { n.recv[e.k] = st.now; }); n.tl = src.tl;
    st.alias = { db: ["db"], "db-replica": ["db-replica"] };
    if (src.name !== "db") st.alias.db.push(src.name);
    st.movedAt = null;
    return tell(cmd, ["Container boxoffice-" + name + "-1 Healthy"], "ok",
      name + " is a fresh clone of " + src.name + " (pg_basebackup), streaming on timeline " + src.tl + ". Recreating the container dropped the alias added by hand.",
      name + " é um clone novo de " + src.name + " (pg_basebackup), recebendo o WAL na timeline " + src.tl + ". Recriar o contêiner removeu o alias adicionado à mão.");
  }

  /* the lab, step by step: each step is a list of [operation, args…] and a caption */
  var R = "db-replica";
  var SCRIPTS = {
    replica: [
      { ops: [["stat"]], en: "Step 2: db-replica streams the primary's WAL, asynchronously.", pt: "Passo 2: db-replica recebe o WAL do primário, de forma assíncrona." },
      { ops: [["insertOn", R]], en: "A standby is read-only.", pt: "Um standby é só leitura." },
      { ops: [["hold", [1]], ["seatMap"]], en: "Ana holds seat 1 and reloads the seat map: the replica is milliseconds behind, and she sees her hold.", pt: "Ana reserva o assento 1 e recarrega o mapa: a réplica está milissegundos atrás e ela vê o hold." },
      { ops: [["reset"], ["setDelay", LAB.delay]], en: "The read-your-writes experiment: REPLICA_DELAY of " + LAB.delay / 1000 + " s.", pt: "O experimento read-your-writes: REPLICA_DELAY de " + LAB.delay / 1000 + " s." },
      { ops: [["hold", [1]], ["seatMap"]], en: "Same hold, same reload: the seat map still shows seat 1 AVAILABLE.", pt: "Mesmo hold, mesmo recarregamento: o mapa ainda mostra o assento 1 AVAILABLE." },
      { ops: [["myHold"]], en: "GET /inventory/holds/{id} reads on the primary: Ana does see her own hold there.", pt: "GET /inventory/holds/{id} lê no primário: ali Ana vê o próprio hold." },
      { ops: [["sleep", LAB.delay], ["seatMap"]], en: LAB.delay / 1000 + " s later the replica has replayed it.", pt: LAB.delay / 1000 + " s depois a réplica o aplicou." },
      { ops: [["setDelay", 0], ["reset"]], en: "Back to no artificial lag.", pt: "De volta a nenhum atraso artificial." }
    ],
    sync: [
      { ops: [["prepare"]], en: "Section 1: wal_log_hints, which pg_rewind needs later.", pt: "Seção 1: wal_log_hints, de que o pg_rewind precisará depois." },
      { ops: [["setSync", 'FIRST 1 ("db-replica")'], ["setDelay", LAB.delay]], en: "Section 2: synchronous replication, with the replica " + LAB.delay / 1000 + " s behind.", pt: "Seção 2: replicação síncrona, com a réplica " + LAB.delay / 1000 + " s atrás." },
      { ops: [["hold", [1]], ["seatMap"]], en: "synchronous_commit = on: the WAL is on the standby's disk, not replayed: the read is still stale.", pt: "synchronous_commit = on: o WAL está no disco do standby, não aplicado: a leitura ainda é desatualizada." },
      { ops: [["reset"], ["setCommit", "remote_apply"]], en: "remote_apply: the commit waits for the replay.", pt: "remote_apply: o commit espera a aplicação." },
      { ops: [["hold", [1]], ["seatMap"]], en: "The hold takes " + LAB.delay / 1000 + " s, and the read is fresh: staleness became latency.", pt: "O hold leva " + LAB.delay / 1000 + " s e a leitura vem atualizada: o atraso virou latência." },
      { ops: [["setCommit", "on"], ["setDelay", 0], ["reset"], ["stop", R]], en: "When the replica fails: stop the synchronous standby.", pt: "Quando a réplica falha: pare o standby síncrono." },
      { ops: [["hold", [10]], ["seatMap"]], en: "The hold gets 504, the seat map too (it reads from the replica).", pt: "O hold recebe 504 e o mapa também (ele lê da réplica)." },
      { ops: [["start", R], ["query", "db", [10]]], en: "Seat 10 is HELD: the fan saw an error, and the hold exists.", pt: "O assento 10 está HELD: o fã viu um erro e o hold existe." },
      { ops: [["setSync", ""], ["reset"]], en: "Back to asynchronous replication.", pt: "De volta à replicação assíncrona." }
    ],
    crash: [
      { ops: [["prepare"]], en: "Section 1 done: wal_log_hints is on.", pt: "Seção 1 feita: wal_log_hints está ligado." },
      { ops: [["stop", R]], en: "Section 3: stop the replica for a moment, to open the window.", pt: "Seção 3: pare a réplica por um momento, para abrir a janela." },
      { ops: [["hold", [20, 21]]], en: "Ana's hold answers 201: for her, seats 20 and 21 are hers.", pt: "O hold de Ana responde 201: para ela, os assentos 20 e 21 são dela." },
      { ops: [["stop", "db", true], ["start", R, true]], en: "Kill the primary (no clean shutdown) and start only the replica.", pt: "Mate o primário (sem parada limpa) e inicie só a réplica." },
      { ops: [["sleep", 10000], ["probe", 30]], en: "What still works? The seat map; every write and every read on db waits for the gateway's timeout.", pt: "O que ainda funciona? O mapa de assentos; toda escrita e toda leitura em db esperam o timeout do gateway." },
      { ops: [["promote", R]], en: "Section 4: promote the replica.", pt: "Seção 4: promova a réplica." },
      { ops: [["moveName"]], en: "Move the name db to it: the local version of a DNS endpoint.", pt: "Mova o nome db para ela: a versão local de um endpoint de DNS." },
      { ops: [["sleep", LAB.reconnect], ["probe", 40]], en: LAB.reconnect / 1000 + " s later the pools reconnected: every path answers.", pt: LAB.reconnect / 1000 + " s depois os pools reconectaram: todos os caminhos respondem." },
      { ops: [["myHold", 1], ["query", R, [20, 21]]], en: "Ana's hold is 404, and seats 20 and 21 are back on sale.", pt: "O hold de Ana é 404 e os assentos 20 e 21 estão de volta à venda." }
    ],
    "split-brain": [
      { ops: [["start", "db"]], en: "Section 5: the old primary comes back as it was.", pt: "Seção 5: o primário antigo volta como estava." },
      { ops: [["getent", ["db"]], ["query", "db", [20]], ["query", R, [20]]], en: "Two primaries, one name, two answers about seat 20.", pt: "Dois primários, um nome, duas respostas sobre o assento 20." },
      { ops: [["stop", "db"]], en: "Fence the old primary before anything writes to it.", pt: "Isole o primário antigo antes que algo escreva nele." },
      { ops: [["rejoin", "db", R]], en: "Section 6: pg_rewind cuts db back to the fork.", pt: "Seção 6: o pg_rewind corta db de volta à bifurcação." },
      { ops: [["start", "db"], ["query", "db", [20]]], en: "db is a standby now, and agrees: seat 20 AVAILABLE. But the name db resolves to two containers.", pt: "db agora é standby e concorda: assento 20 AVAILABLE. Mas o nome db resolve para dois contêineres." },
      { ops: [["lsn"], ["stop", R]], en: "Section 7, the switchback: the LSNs are equal, stop db-replica.", pt: "Seção 7, o switchback: os LSNs são iguais, pare db-replica." },
      { ops: [["promote", "db"]], en: "Promote db: one fork per promotion.", pt: "Promova db: uma bifurcação por promoção." },
      { ops: [["recreate", R], ["getent", ["db", "db-replica"]]], en: "A fresh db-replica: one name, one address each.", pt: "Um db-replica novo: um nome, um endereço cada." },
      { ops: [["probe", 90]], en: "The stack is as lab 7 expects it, with db primary again.", pt: "A pilha está como o lab 7 espera, com db primário de novo." }
    ]
  };
  var FROM = { "split-brain": "crash" };
  var OPS = { hold: hold, reset: reset, seatMap: seatMap, myHold: myHold, query: query, insertOn: insertOn, probe: probe, sleep: sleep, stop: stop,
    start: start, promote: promote, moveName: moveName, getent: getent, rejoin: rejoin, prepare: prepare, setSync: setSync, setCommit: setCommit,
    setDelay: setDelay, stat: stat, lsn: lsn, recreate: recreate };
  function run(st, op) {
    var r = OPS[op[0]].apply(null, [st].concat(op.slice(1)));
    stream(st);
    return r;
  }
  /* the state a script starts from (its prerequisite script already played) */
  function base(name) {
    var st = create();
    if (FROM[name]) SCRIPTS[FROM[name]].forEach(function (step) { step.ops.forEach(function (op) { run(st, op); }); });
    return st;
  }
  /* the state after the first n steps of a script, and every result */
  function play(name, n) {
    var st = base(name), out = [];
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (step) { step.ops.forEach(function (op) { out.push(run(st, op)); }); });
    return { st: st, out: out };
  }

  var API = { LAB: LAB, NAMES: NAMES, SEATS: SEATS, SCRIPTS: SCRIPTS, FROM: FROM, create: create, base: base, play: play, run: run, node: node,
    primaries: primaries, primary: primary, seats: seats, applied: applied, lost: lost, resolve: resolve,
    hold: hold, reset: reset, seatMap: seatMap, myHold: myHold, query: query, probe: probe, sleep: sleep, stop: stop, start: start, promote: promote,
    moveName: moveName, getent: getent, rejoin: rejoin, prepare: prepare, setSync: setSync, setCommit: setCommit, setDelay: setDelay, stat: stat, lsn: lsn, recreate: recreate };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  var POS = { db: { x: 330, y: 8 }, "db-replica": { x: 330, y: 158 } };
  var BW = 300, BH = 92;
  var CLI = { w: { x: 6, y: 30, w: 160, h: 46 }, r: { x: 6, y: 182, w: 160, h: 46 } };
  function L(pair) { return PT ? pair[1] : pair[0]; }

  C.style("boxoffice-db", [
    ".md-typeset .csim-bd-seat { stroke-width: 1; }",
    ".md-typeset .csim-bd-seat.held { fill: var(--c-tint2); stroke: var(--c-ink); }",
    ".md-typeset .csim-bd-seat.free { fill: var(--c-bg); stroke: var(--c-line); }",
    ".md-typeset .csim-bd-seat.wait { fill: var(--c-bg); stroke: var(--c-warn); stroke-dasharray: 3 2; }",
    ".md-typeset .csim .csim-bd-node { cursor: pointer; }",
    ".md-typeset .csim .csim-bd-node.sel > rect:first-child { stroke-width: 3; }",
    ".md-typeset .csim .csim-bd-node.down text { fill: var(--c-fg3); }",
    ".md-typeset .csim-log.csim-bd-term li { font-family: var(--md-code-font-family, monospace); font-size: .62rem; white-space: pre-wrap; }",
    ".md-typeset .csim-log.csim-bd-term li b { font-weight: 600; }"
  ].join("\n"));

  C.register("boxoffice-db", function (root) {
    var o = C.opts(root, { script: "crash" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st, sel = "db", lastName = null;

    var svg = s("svg", { viewBox: "0 0 640 258", role: "img", "aria-label": t("BoxOffice database pair", "Par de bancos do BoxOffice") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(6); term.className += " csim-bd-term";
    var tiles = C.stats([
      { key: "prim", label: t("primaries up", "primários no ar") },
      { key: "tl", label: t("timeline of the primary", "timeline do primário") },
      { key: "hung", label: t("commits that hung", "commits que travaram") },
      { key: "lost", label: t("201 holds lost", "holds 201 perdidos") }
    ]);
    function say(pair, tone) { note.textContent = pair ? L(pair) : ""; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    function show(r, op) {
      term.add(el("span", {}, [el("b", { text: r.cmd }), r.out.length ? "\n" + r.out.join("\n") : ""]), r.tone === "info" ? "" : r.tone);
      lastName = /seatMap/.test(op) ? "db-replica" : /hold|probe|reset|myHold/.test(op) ? "db" : lastName;
    }

    var cScript = C.choice({ label: t("Lab part", "Parte do lab"), value: script, options: [
      { value: "replica", label: t("Replica (step 2)", "Réplica (passo 2)") },
      { value: "sync", label: t("Synchronous (4.1–2)", "Síncrona (4.1–2)") },
      { value: "crash", label: t("Crash (4.3–4)", "Queda (4.3–4)") },
      { value: "split-brain", label: t("Split brain (4.5–7)", "Split brain (4.5–7)") },
      { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; resetAll(); } });

    function act(name, fn) { return function () { player.pause(); var r = fn(); stream(st); if (r) { show(r, name); say(r.note, r.tone === "info" ? "" : r.tone); } draw(); }; }
    function other() { return primaries(st).filter(function (x) { return x.name !== sel; })[0] || null; }
    var B = {
      stop: C.button("stop", act("stop", function () { return stop(st, sel); })),
      kill: C.button("kill", act("kill", function () { return stop(st, sel, true); }), { tone: "bad" }),
      start: C.button("start", act("start", function () { return start(st, sel); })),
      nodeps: C.button("up --no-deps", act("start", function () { return start(st, sel, true); })),
      promote: C.button("pg_promote()", act("promote", function () { return promote(st, sel); }), { tone: "bad" }),
      rewind: C.button("pg_rewind", act("rejoin", function () { var p = other(); return p ? rejoin(st, sel, p.name) : null; })),
      clone: C.button(t("recreate (clone)", "recriar (clone)"), act("recreate", function () { return recreate(st, sel); }))
    };
    var H = {
      hold: C.button(t("POST hold", "POST hold"), act("hold", function () { return hold(st); }), { tone: "ok" }),
      map: C.button(t("GET seat map", "GET mapa"), act("seatMap", function () { return seatMap(st); })),
      mine: C.button(t("GET Ana's hold", "GET hold de Ana"), act("myHold", function () { return myHold(st); })),
      probe: C.button(t("probe the stack", "sondar a pilha"), act("probe", function () { return probe(st, nextSeat(st)); })),
      wait: C.button("sleep 15", act("sleep", function () { return sleep(st, LAB.reconnect); })),
      move: C.button(t("move the name db", "mover o nome db"), act("moveName", function () { return moveName(st); }), { tone: "bad" }),
      hints: C.button("wal_log_hints = on", act("prepare", function () { return prepare(st); })),
      reset: C.button("reset-inventory.sh", act("reset", function () { return reset(st); }))
    };
    var cSync = C.choice({ label: "synchronous_standby_names", value: "", options: [{ value: "", label: "async" }, { value: 'FIRST 1 ("db-replica")', label: "FIRST 1" }],
      onChange: act("setSync", function () { return setSync(st, cSync.get()); }) });
    var cCommit = C.choice({ label: "synchronous_commit", value: "on", options: [{ value: "on", label: "on" }, { value: "remote_apply", label: "remote_apply" }],
      onChange: act("setCommit", function () { return setCommit(st, cCommit.get()); }) });
    var cDelay = C.choice({ label: "REPLICA_DELAY", value: 0, options: [{ value: 0, label: "0" }, { value: LAB.delay, label: LAB.delay / 1000 + "s" }],
      onChange: act("setDelay", function () { return setDelay(st, cDelay.get()); }) });

    var player = C.player({
      interval: 1800,
      onTick: function (k) { return step(k); },
      onPrev: function (k) { replay(k); },
      onReset: function () { resetAll(); }
    });

    function step(k) {
      var sc = SCRIPTS[script];
      if (!sc || k > sc.length) return false;
      var tone = "";
      sc[k - 1].ops.forEach(function (op) {
        var r = run(st, op);
        show(r, op[0]);
        if (r.tone === "bad" || (r.tone === "warn" && tone !== "bad")) tone = r.tone;
      });
      say([sc[k - 1].en, sc[k - 1].pt], tone);
      syncControls();
      draw();
    }
    function replay(k) {
      st = base(script); term.clear(); lastName = null;
      for (var i = 1; i <= k; i++) step(i);
      if (!k) intro();
      syncControls();
      draw();
    }
    function intro() {
      say(script === "free"
        ? ["Click a node to select it, then run a command; the requests go through the names db and db-replica, as in the lab.", "Clique num nó para selecioná-lo e rode um comando; as requisições passam pelos nomes db e db-replica, como no lab."]
        : script === "split-brain"
          ? ["Where the crash part ends: db-replica is the primary on timeline 2 and holds the name db; db is down with Ana's hold. Press play or →.", "Onde a parte da queda termina: db-replica é o primário na timeline 2 e tem o nome db; db está parado com o hold de Ana. Aperte play ou →."]
          : ["Where the lab starts: db primary, db-replica streaming asynchronously, every seat on sale. Press play or → to run the lab's commands; the buttons work at any time.",
             "Onde o lab começa: db primário, db-replica recebendo o WAL de forma assíncrona, todos os assentos à venda. Aperte play ou → para rodar os comandos do lab; os botões funcionam a qualquer momento."], "");
    }
    function syncControls() {
      var p = primary(st) || node(st, "db");
      cSync.set(p.sync); cCommit.set(p.commit); cDelay.set(node(st, "db-replica").delay);
    }
    function resetAll() {
      st = base(script); term.clear(); lastName = null;
      player.total(SCRIPTS[script] ? SCRIPTS[script].length : 0);
      player.style.display = SCRIPTS[script] ? "" : "none";
      syncControls();
      intro();
      draw();
    }

    function anchor(nm) { var p = POS[nm]; return { x: p.x, y: p.y + BH / 2 }; }

    function draw() {
      C.clear(svg);
      var p = primary(st), ps = primaries(st);
      /* clients → the containers that answer their name */
      [["w", "db", t("holds, login, catalog", "reservas, login, catálogo"), "PgBouncer · auth · catalog"],
       ["r", "db-replica", t("seat map (inventory)", "mapa (inventory)"), "readOnly = true"]].forEach(function (c) {
        var b = CLI[c[0]], x0 = b.x + b.w, y0 = b.y + b.h / 2;
        var pool = resolve(st, c[1]);
        (st.alias[c[1]] || []).forEach(function (cn) {
          var a = anchor(cn), up = node(st, cn).up;
          svg.appendChild(s("path", { d: "M" + x0 + "," + y0 + " C" + (x0 + 70) + "," + y0 + " " + (a.x - 70) + "," + a.y + " " + a.x + "," + a.y,
            class: "c-wire" + (up ? (lastName === c[1] ? " on" : "") : " cut") }));
        });
        svg.appendChild(s("text", { x: x0 + 40, y: y0 - 8, class: "c-small c-mono" + (pool.length ? "" : " c-bad") }, t("name ", "nome ") + "\"" + c[1] + "\"" + (pool.length > 1 ? " → " + pool.length : "")));
        svg.appendChild(s("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 6, class: "c-box on" }));
        svg.appendChild(s("text", { x: b.x + 8, y: b.y + 18, class: "c-label" }, c[2]));
        svg.appendChild(s("text", { x: b.x + 8, y: b.y + 34, class: "c-small c-mono" }, c[3]));
      });
      /* WAL between the nodes */
      st.nodes.forEach(function (n) {
        if (n.role !== "replica" || !n.upstream) return;
        var u = node(st, n.upstream), live = connected(st, n);
        var x = POS.db.x + BW - 40, y1 = POS.db.y + BH, y2 = POS["db-replica"].y;
        svg.appendChild(s("line", { x1: x, y1: y1, x2: x, y2: y2, class: "c-wire" + (live ? " on" : n.diverged ? " cut" : "") }));
        var label = live ? "WAL " + (u.sync ? "sync" : "async") + (n.delay ? " · " + t("replay +", "aplica +") + n.delay / 1000 + "s" : "") : n.diverged ? t("diverged", "divergiu") : t("no stream", "sem stream");
        svg.appendChild(s("text", { x: x - 6, y: (y1 + y2) / 2 + 4, "text-anchor": "end", class: "c-small" + (live ? "" : " c-bad") },
          (n.upstream === "db" ? "↓ " : "↑ ") + label));
      });
      /* the nodes */
      st.nodes.forEach(function (n) {
        var q = POS[n.name], ss = seats(st, n), pSeats = p ? seats(st, p) : null;
        var box = !n.up ? "down" : n.role === "primary" ? (ps.length > 1 ? "bad" : "hot") : n.diverged ? "bad" : "on";
        var g = s("g", { class: "csim-bd-node" + (n.up ? "" : " down") + (n.name === sel ? " sel" : ""), onclick: function () { sel = n.name; draw(); } });
        g.appendChild(s("rect", { x: q.x, y: q.y, width: BW, height: BH, rx: 8, class: "c-box " + box }));
        g.appendChild(s("text", { x: q.x + 8, y: q.y + 16, class: "c-label" }, n.name + "  " + IP[n.name]));
        var role = !n.up ? t("down", "fora do ar") + (n.role === "primary" ? t(" (primary)", " (primário)") : "")
          : n.role === "primary" ? t("primary", "primário") : t("standby", "standby");
        g.appendChild(s("text", { x: q.x + BW - 8, y: q.y + 16, "text-anchor": "end", class: "c-small" }, role + " · tl " + n.tl));
        g.appendChild(s("text", { x: q.x + 8, y: q.y + 34, class: "c-small" }, t("seats", "assentos")));
        SEATS.forEach(function (x, j) {
          var cx = q.x + 48 + j * 35, held = ss[x] === "HELD", pending = n.role === "replica" && pSeats && pSeats[x] !== ss[x] && connected(st, n);
          g.appendChild(s("rect", { x: cx, y: q.y + 24, width: 32, height: 16, rx: 3, class: "csim-bd-seat " + (pending ? "wait" : held ? "held" : "free") }));
          g.appendChild(s("text", { x: cx + 16, y: q.y + 35.5, "text-anchor": "middle", class: "c-small c-mono" }, String(x)));
        });
        var behind = n.role === "replica" ? n.hist.length - applied(st, n) : 0;
        var info = n.role === "primary"
          ? (n.sync ? "FIRST 1 · " + n.commit : "async") + " · wal_log_hints " + (n.hints ? "on" : "off")
          : n.diverged ? t("cannot follow " + n.upstream, "não segue " + n.upstream) : behind ? behind + t(" not replayed yet", " ainda não aplicada(s)") : t("from ", "de ") + n.upstream + (n.delay ? " · REPLICA_DELAY " + n.delay / 1000 + "s" : "");
        g.appendChild(s("text", { x: q.x + 8, y: q.y + 58, class: "c-small" + (behind || n.diverged ? " c-warn" : "") }, info));
        var names = Object.keys(st.alias).filter(function (nm) { return st.alias[nm].indexOf(n.name) >= 0; });
        g.appendChild(s("text", { x: q.x + 8, y: q.y + 78, class: "c-small c-mono" }, t("answers for: ", "responde por: ") + names.map(function (x) { return "\"" + x + "\""; }).join(" ")));
        svg.appendChild(g);
      });
      svg.appendChild(s("text", { x: 6, y: 130, class: "c-small" }, "t = " + (st.now / 1000).toFixed(1) + " s"));
      /* buttons that make sense for the selected node */
      var n = node(st, sel), oth = other();
      B.stop.disabled = !n.up; B.kill.disabled = !n.up; B.start.disabled = n.up; B.nodeps.disabled = n.up || sel !== "db-replica";
      B.promote.disabled = !n.up || n.role !== "replica";
      B.rewind.disabled = n.up || !oth;
      B.clone.disabled = sel !== "db-replica" || !primary(st) || primary(st).name === "db-replica";
      selLabel.textContent = t("Selected: ", "Selecionado: ") + sel;
      tiles.set("prim", String(ps.length), ps.length === 1 ? "ok" : "bad");
      tiles.set("tl", p ? String(p.tl) : "–", "");
      tiles.set("hung", String(st.hung), st.hung ? "warn" : "");
      var ls = lost(st);
      tiles.set("lost", ls.length ? ls.map(holdName).join(", ") : "0", ls.length ? "bad" : "ok");
    }

    var selLabel = el("span", { class: "csim-lbl" });
    C.add(root, [
      el("p", { class: "csim-title", text: t("Lab 6's database pair, without Docker: lag, synchronous commits, a crash, a failover and a split brain",
        "O par de bancos do lab 6, sem Docker: atraso, commits síncronos, uma queda, um failover e um split brain") }),
      el("p", { class: "csim-sub", text: t("The services reach PostgreSQL only through two Docker names. Filled seats are HELD on that node, dashed ones are received but not replayed yet; click a node to run node commands on it.",
        "Os serviços chegam ao PostgreSQL só por dois nomes do Docker. Assentos cheios estão HELD naquele nó, tracejados foram recebidos e ainda não aplicados; clique num nó para rodar nele os comandos de nó.") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-row" }, [H.hold, H.map, H.mine, H.probe, H.wait, H.reset]),
      el("div", { class: "csim-row" }, [selLabel, B.stop, B.kill, B.start, B.nodeps, B.promote, B.rewind, B.clone, H.move, H.hints]),
      el("div", { class: "csim-row" }, [cSync, cCommit, cDelay]),
      note,
      player,
      el("div", { class: "csim-cols" }, [tiles, term])
    ]);
    resetAll();
    return {};
  });
})();
