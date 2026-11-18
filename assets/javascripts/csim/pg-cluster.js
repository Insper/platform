/*
 * The PostgreSQL cluster of hands-on 9 (2026.2), as a lab twin:
 *
 *   <div class="csim" data-sim="pg-cluster" data-script="replication"></div>
 *
 * pg-primary, pg-replica1 and pg-replica2 (the services of the lab's compose.yaml), starting as the
 * lab does: the table orders with keyboard and mouse, both replicas streaming. Every button is a
 * command of the lab (INSERT, SELECT, pg_wal_replay_pause, docker compose stop/kill/start,
 * pg_promote, primary_conninfo, rejoin-as-replica.sh, a multi-host connection string,
 * synchronous_standby_names) and prints what the lab prints. A script (data-script) replays one page
 * of the lab step by step: replication, sync, failover or lost-write; "free" leaves only the buttons.
 *
 * The model: each node holds the WAL history it has received (hist) and how much of it it has
 * replayed (applied). Streaming is instantaneous (a replica that is up and connected has everything),
 * so lag only appears when the replay is paused or a node is down, as in the lab. A replica follows
 * its upstream only while its history is a prefix of the upstream's; pg_promote starts a new
 * timeline; pg_rewind cuts a stopped node back to the fork. A sequence WAL-logs 32 values ahead, so
 * a new primary skips the rest of the batch (the lab's id 34).
 */
(function () {
  "use strict";

  var NAMES = ["pg-primary", "pg-replica1", "pg-replica2"];
  var BYTES = 184;          /* WAL bytes of one INSERT of the lab, as pg_stat_replication shows it */
  var SEQ_LOG = 32;         /* a sequence WAL-logs this many values ahead */
  var ITEMS = ["monitor", "headset", "webcam", "cable", "charger", "speaker", "tablet", "printer"];

  var key = 0;
  function entry(o) { o.k = ++key; return o; }

  function create() {
    var hist = [entry({ kind: "create", seq: 0 })];
    var st = {
      nodes: NAMES.map(function (n, i) {
        return { name: n, up: true, role: i ? "replica" : "primary", tl: 1, hist: hist.slice(), applied: hist.length,
          paused: false, upstream: i ? "pg-primary" : null, seqLast: 0, sync: "", commit: "on", diverged: false };
      }),
      lost: [], blocked: 0, nextItem: 0
    };
    insert(st, "pg-primary", "keyboard");
    insert(st, "pg-primary", "mouse");
    return st;
  }

  function node(st, name) { return st.nodes.filter(function (n) { return n.name === name; })[0]; }
  function lastSeq(hist) { for (var i = hist.length - 1; i >= 0; i--) if (hist[i].seq !== undefined) return hist[i].seq; return 0; }
  function prefix(a, b) {
    if (a.length > b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i].k !== b[i].k) return false;
    return true;
  }
  function common(a, b) { var i = 0; while (i < a.length && i < b.length && a[i].k === b[i].k) i++; return i; }
  function rows(n) { return n.hist.slice(0, n.applied).filter(function (e) { return e.kind === "insert"; }); }
  function primaries(st) { return st.nodes.filter(function (n) { return n.up && n.role === "primary"; }); }
  function primary(st) { return primaries(st)[0] || null; }

  /* every replica that is up copies its upstream's history, if it is a continuation of its own */
  function stream(st) {
    for (var pass = 0; pass < 3; pass++) st.nodes.forEach(function (n) {
      if (!n.up || n.role !== "replica") return;
      var u = node(st, n.upstream);
      if (!u || !u.up) return;
      if (!prefix(n.hist, u.hist)) { n.diverged = true; return; }
      n.diverged = false;
      n.hist = u.hist.slice();
      n.tl = u.tl;
      if (!n.paused) n.applied = n.hist.length;
    });
  }
  function streaming(st, p) {
    return st.nodes.filter(function (n) { return n.up && n.role === "replica" && n.upstream === p.name && !n.diverged; });
  }

  /* the sync_state of each replica that streams from p */
  function syncState(p, r) {
    if (!p.sync) return "async";
    var m = p.sync.match(/^(FIRST|ANY) 1 \((.*)\)$/);
    var listed = m[2].indexOf('"' + r.name + '"') >= 0;
    if (!listed) return "async";
    return m[1] === "ANY" ? "quorum" : "sync";
  }

  function err(cmd, out, en, pt) { return { cmd: cmd, out: out, tone: "bad", note: [en, pt] }; }
  function psql(n, sql) { return n + "=# " + sql; }
  function noNode(cmd, name) {
    return err(cmd, ["service \"" + name + "\" is not running"], name + " is stopped: start it first.", name + " está parado: inicie-o antes.");
  }

  function insert(st, name, item) {
    item = item || ITEMS[st.nextItem++ % ITEMS.length];
    var n = node(st, name), cmd = psql(name, "INSERT INTO orders (item) VALUES ('" + item + "');");
    if (!n.up) return noNode(cmd, name);
    if (n.role === "replica") return err(cmd, ["ERROR:  cannot execute INSERT in a read-only transaction"],
      "A replica is a copy of the primary's pages: a local write would make it diverge. Writes go to the primary only.",
      "Uma réplica é uma cópia das páginas do primário: uma escrita local a faria divergir. Escritas vão só para o primário.");
    var id = n.seqLast + 1, logged = lastSeq(n.hist), e = { kind: "insert", id: id, item: item, tl: n.tl };
    if (id > logged) e.seq = id + SEQ_LOG;
    n.hist.push(entry(e));
    n.applied = n.hist.length;
    n.seqLast = id;
    stream(st);
    /* does the commit wait for a standby? */
    var res = { cmd: cmd, out: ["INSERT 0 1"], tone: "ok", id: id, item: item };
    if (n.sync) {
      var ok = streaming(st, n).some(function (r) {
        return syncState(n, r) !== "async" && (n.commit !== "remote_apply" || r.applied === r.hist.length);
      });
      if (!ok) {
        st.blocked++;
        res.blocked = true;
        res.tone = "warn";
        res.out = ["(hangs: waiting for a synchronous standby… Ctrl+C)",
          "WARNING:  canceling wait for synchronous replication due to user request",
          "DETAIL:  The transaction has already committed locally, but might not have been replicated to the standby.",
          "INSERT 0 1"];
        res.note = ["The commit hangs: synchronous_standby_names = '" + n.sync + "'" + (n.commit === "remote_apply" ? " with remote_apply" : "") +
          " and no listed standby can confirm. Ctrl+C cancels only the wait: '" + item + "' is committed on " + name + ".",
          "O commit trava: synchronous_standby_names = '" + n.sync + "'" + (n.commit === "remote_apply" ? " com remote_apply" : "") +
          " e nenhum standby da lista pode confirmar. Ctrl+C cancela só a espera: '" + item + "' está confirmado em " + name + "."];
        return res;
      }
      res.note = ["Committed after a standby of '" + n.sync + "' confirmed: one more copy exists before the client hears \"ok\".",
        "Confirmado depois que um standby de '" + n.sync + "' respondeu: existe mais uma cópia antes de o cliente ouvir \"ok\"."];
      return res;
    }
    var behind = st.nodes.filter(function (r) { return r.role === "replica" && (!r.up || r.applied < n.hist.length || r.upstream !== name || r.diverged); });
    res.note = behind.length
      ? ["Committed on " + name + " (async: it did not wait). " + behind.map(function (r) { return r.name; }).join(" and ") + " do not have '" + item + "' yet.",
         "Confirmado em " + name + " (async: não esperou). " + behind.map(function (r) { return r.name; }).join(" e ") + " ainda não têm '" + item + "'."]
      : ["Committed on " + name + " and streamed to both replicas.", "Confirmado em " + name + " e enviado às duas réplicas."];
    return res;
  }

  function select(st, name) {
    var n = node(st, name), cmd = psql(name, "SELECT id, item FROM orders;");
    if (!n.up) return noNode(cmd, name);
    var r = rows(n), p = primary(st);
    var res = { cmd: cmd, out: [r.map(function (e) { return e.id + " " + e.item; }).join(" · ") + "  (" + r.length + " rows)"], tone: "info", count: r.length, ids: r.map(function (e) { return e.id; }) };
    if (p && p !== n && rows(p).length !== r.length) {
      res.tone = "warn";
      res.note = ["Stale read: " + name + " shows " + r.length + " rows, the primary " + rows(p).length + ". The replica has not replayed everything yet.",
        "Leitura desatualizada: " + name + " mostra " + r.length + " linhas, o primário " + rows(p).length + ". A réplica ainda não aplicou tudo."];
    } else res.note = [name + " sees " + r.length + " rows.", name + " vê " + r.length + " linhas."];
    return res;
  }

  function pause(st, name, on) {
    var n = node(st, name), cmd = psql(name, on ? "SELECT pg_wal_replay_pause();" : "SELECT pg_wal_replay_resume();");
    if (!n.up) return noNode(cmd, name);
    if (n.role !== "replica") return err(cmd, ["ERROR:  recovery is not in progress"], name + " is a primary: there is no replay to pause.", name + " é primário: não há replay para pausar.");
    n.paused = on;
    if (!on) n.applied = n.hist.length;
    return { cmd: cmd, out: [on ? "pg_wal_replay_pause" : "pg_wal_replay_resume"], tone: "info",
      note: on ? [name + " keeps receiving the WAL, but stops applying it.", name + " continua recebendo o WAL, mas para de aplicá-lo."]
        : [name + " applies what it received: it catches up.", name + " aplica o que recebeu: alcança o primário."] };
  }

  function stop(st, name, kill) {
    var n = node(st, name), cmd = "$ docker compose " + (kill ? "kill " : "stop ") + name;
    n.up = false; n.paused = false;
    return { cmd: cmd, out: [(kill ? "Killed " : "Stopped ") + name], tone: n.role === "primary" ? "bad" : "warn",
      note: n.role === "primary"
        ? [name + " is down: the replicas still answer reads, but nobody accepts writes.", name + " caiu: as réplicas ainda respondem leituras, mas ninguém aceita escritas."]
        : [name + " is down: it stops receiving the WAL.", name + " caiu: para de receber o WAL."] };
  }

  function start(st, name) {
    var n = node(st, name), cmd = "$ docker compose start " + name;
    n.up = true;
    stream(st);
    var res = { cmd: cmd, out: ["Started " + name], tone: "info" };
    var ps = primaries(st);
    if (ps.length > 1) {
      res.tone = "bad";
      res.note = ["Split brain: " + ps.map(function (p) { return p.name; }).join(" and ") + " both run as primary and accept different writes. A stopped primary must rejoin with pg_rewind before it starts.",
        "Split brain: " + ps.map(function (p) { return p.name; }).join(" e ") + " rodam como primário e aceitam escritas diferentes. Um primário parado deve voltar com pg_rewind antes de iniciar."];
    } else if (n.role === "replica" && n.diverged) {
      res.tone = "bad";
      res.note = [name + " cannot follow " + n.upstream + ": its history has writes the other lacks.", name + " não consegue seguir " + n.upstream + ": sua história tem escritas que o outro não tem."];
    } else if (n.role === "replica" && !(node(st, n.upstream) || {}).up) {
      res.note = [name + " is up but cannot reach " + n.upstream + ": \"waiting for WAL to become available\".", name + " está no ar, mas não alcança " + n.upstream + ": \"waiting for WAL to become available\"."];
    } else res.note = [name + " is back and streams from " + (n.upstream || "nobody: it is a primary") + ".", name + " voltou e recebe o WAL de " + (n.upstream || "ninguém: é primário") + "."];
    return res;
  }

  function promote(st, name) {
    var n = node(st, name), cmd = psql(name, "SELECT pg_promote();");
    if (!n.up) return noNode(cmd, name);
    if (n.role !== "replica") return err(cmd, ["ERROR:  recovery is not in progress"], name + " is already a primary.", name + " já é primário.");
    if (n.paused) return err(cmd, ["(resume the replay first: pg_wal_replay_resume())"], "Resume the replay before promoting.", "Retome o replay antes de promover.");
    var others = primaries(st);
    n.role = "primary"; n.upstream = null; n.diverged = false;
    n.tl += 1;
    n.hist.push(entry({ kind: "timeline", tl: n.tl }));
    n.applied = n.hist.length;
    n.seqLast = lastSeq(n.hist);
    n.sync = ""; n.commit = "on";
    var res = { cmd: cmd, out: ["LOG:  selected new timeline ID: " + n.tl, "LOG:  database system is ready to accept connections"], tone: "ok" };
    if (others.length) {
      res.tone = "bad";
      res.note = ["Split brain: " + others[0].name + " is still up as primary, and now " + name + " is one too.", "Split brain: " + others[0].name + " ainda está no ar como primário e agora " + name + " também é."];
    } else res.note = [name + " leaves recovery, starts timeline " + n.tl + " and accepts writes.", name + " sai do recovery, começa a timeline " + n.tl + " e aceita escritas."];
    return res;
  }

  function follow(st, name, target) {
    var n = node(st, name), t = node(st, target);
    var cmd = psql(name, "ALTER SYSTEM SET primary_conninfo = 'host=" + target + " ...'; SELECT pg_reload_conf();");
    if (!n.up) return noNode(cmd, name);
    if (n.role !== "replica") return err(cmd, ["(a primary streams from nobody)"], name + " is a primary.", name + " é primário.");
    n.upstream = target;
    stream(st);
    if (!t.up) return { cmd: cmd, out: ["FATAL:  could not connect to the primary server"], tone: "warn", note: [target + " is down.", target + " está fora do ar."] };
    if (n.diverged) return err(cmd, ["FATAL:  highest timeline of the primary is behind recovery timeline, or histories diverged"],
      name + " has writes that " + target + " lacks: it cannot follow it without pg_rewind.", name + " tem escritas que " + target + " não tem: não consegue segui-lo sem pg_rewind.");
    return { cmd: cmd, out: ["LOG:  new target timeline is " + t.tl, "LOG:  restarted WAL streaming on timeline " + t.tl], tone: "ok",
      note: [name + " now streams from " + target + " and has its " + rows(n).length + " rows.", name + " agora recebe o WAL de " + target + " e tem suas " + rows(n).length + " linhas."] };
  }

  function rejoin(st, name, target) {
    var n = node(st, name), t = node(st, target);
    var cmd = "$ docker compose run --rm --no-deps --entrypoint bash " + name + " /scripts/rejoin-as-replica.sh " + target;
    if (n.up) return err(cmd, ["(refused: " + name + " is running)"], "Stop the node first: two servers on one data directory corrupt it.", "Pare o nó antes: dois servidores no mesmo diretório de dados o corrompem.");
    if (!t || !t.up || t.role !== "primary") return err(cmd, ["pg_rewind: error: could not connect to server"], target + " is not an available primary.", target + " não é um primário disponível.");
    var c = common(n.hist, t.hist), gone = n.hist.slice(c).filter(function (e) { return e.kind === "insert"; });
    var out = ["pg_rewind: connected to server"];
    if (!gone.length) out.push("pg_rewind: no rewind required");
    else { out.push("pg_rewind: servers diverged on timeline " + n.tl, "pg_rewind: rewinding from last common checkpoint", "pg_rewind: Done!"); }
    out.push("rejoin: " + name + " will follow " + target + " on its next start");
    n.hist = n.hist.slice(0, c); n.applied = c;
    n.role = "replica"; n.upstream = target; n.sync = ""; n.commit = "on"; n.diverged = false;
    gone.forEach(function (e) { if (st.lost.indexOf(e.item) < 0) st.lost.push(e.item); });
    return { cmd: cmd, out: out, tone: gone.length ? "warn" : "ok", discarded: gone.map(function (e) { return e.item; }),
      note: gone.length ? ["pg_rewind discards what " + name + " wrote after the fork: " + gone.map(function (e) { return "'" + e.item + "'"; }).join(", ") + ", lost for good.",
        "pg_rewind descarta o que " + name + " escreveu depois da bifurcação: " + gone.map(function (e) { return "'" + e.item + "'"; }).join(", ") + ", perdido de vez."]
        : ["No rewind required: " + name + " wrote nothing that " + target + " lacks.", "Nenhum rewind necessário: " + name + " não escreveu nada que " + target + " não tenha."] };
  }

  /* a client with the lab's multi-host connection string */
  function connect(st, attrs, pick) {
    var cmd = "$ psql \"host=" + NAMES.join(",") + " target_session_attrs=" + attrs + (attrs === "standby" ? " load_balance_hosts=random" : "") + "\"";
    var out = [], ok = [];
    NAMES.forEach(function (h) {
      var n = node(st, h);
      if (!n.up) { if (attrs === "read-write") out.push("connection to \"" + h + "\" failed: Connection refused"); return; }
      if (attrs === "read-write" && n.role !== "primary") out.push("connection to \"" + h + "\" failed: session is read-only");
      if ((attrs === "read-write") === (n.role === "primary")) ok.push(h);
    });
    if (!ok.length) return { cmd: cmd, out: out.concat(["psql: error: no server with the required role"]), tone: "bad",
      note: attrs === "read-write" ? ["No node accepts writes: writes are unavailable until a replica is promoted.", "Nenhum nó aceita escritas: escritas ficam indisponíveis até uma réplica ser promovida."]
        : ["No replica is up.", "Nenhuma réplica está no ar."] };
    var h = attrs === "read-write" ? ok[0] : ok[(pick || 0) % ok.length];
    return { cmd: cmd, out: (attrs === "read-write" ? out : []).concat(["→ connected to " + h]), tone: "ok", host: h,
      note: attrs === "read-write" ? ["The driver tried the hosts in order and kept the one that accepts writes: " + h + ".", "O driver tentou os hosts em ordem e ficou com o que aceita escritas: " + h + "."]
        : ["A random standby: " + h + ". Never the primary.", "Um standby aleatório: " + h + ". Nunca o primário."] };
  }

  /* pg_stat_replication on the primary */
  function stat(st) {
    var p = primary(st), cmd = psql(p ? p.name : "pg-primary", "SELECT application_name, sync_state, bytes_behind FROM pg_stat_replication;");
    if (!p) return err(cmd, ["(no primary is up)"], "There is no primary to ask.", "Não há primário para perguntar.");
    var rs = streaming(st, p);
    return { cmd: cmd, tone: "info", rows: rs.map(function (r) { return { name: r.name, sync: syncState(p, r), bytes: (r.hist.length - r.applied) * BYTES }; }),
      out: rs.length ? rs.map(function (r) { return r.name + " | " + syncState(p, r) + " | " + (r.hist.length - r.applied) * BYTES; }) : ["(0 rows)"],
      note: ["The primary sees each replica that streams from it, its sync_state and how many WAL bytes it has not replayed.",
        "O primário vê cada réplica que recebe seu WAL, o sync_state e quantos bytes de WAL ela ainda não aplicou."] };
  }

  function setSync(st, value, commit) {
    var p = primary(st), name = p ? p.name : "pg-primary";
    var cmd = psql(name, value ? "ALTER SYSTEM SET synchronous_standby_names = '" + value + "';" : "ALTER SYSTEM RESET synchronous_standby_names;") +
      (commit && commit !== "on" ? " SET synchronous_commit = " + commit + ";" : "");
    if (!p) return err(cmd, ["(no primary is up)"], "There is no primary to configure.", "Não há primário para configurar.");
    p.sync = value || ""; p.commit = commit || "on";
    var r = stat(st);
    return { cmd: cmd, out: r.out, rows: r.rows, tone: "info", note: value
      ? ["Commits on " + name + " now wait for '" + value + "'" + (p.commit === "remote_apply" ? ", until the standby has replayed the WAL" : "") + ".",
         "Commits em " + name + " agora esperam '" + value + "'" + (p.commit === "remote_apply" ? ", até o standby ter aplicado o WAL" : "") + "."]
      : ["Back to asynchronous replication: commits wait for nobody.", "De volta à replicação assíncrona: commits não esperam ninguém."] };
  }

  /* the lab's pages, step by step: each step is a list of [operation, args…] and a caption */
  var P = "pg-primary", R1 = "pg-replica1", R2 = "pg-replica2";
  var SCRIPTS = {
    replication: [
      { ops: [["select", R1]], en: "Experiment 1: nobody created the table on the replica, yet keyboard and mouse are there — they came through the WAL.", pt: "Experimento 1: ninguém criou a tabela na réplica e mesmo assim keyboard e mouse estão lá — vieram pelo WAL." },
      { ops: [["insert", R1, "monitor"]], en: "Experiment 2: a replica is read-only.", pt: "Experimento 2: uma réplica é só leitura." },
      { ops: [["pause", R1, true]], en: "Experiment 3: pause the replay on pg-replica1.", pt: "Experimento 3: pause o replay em pg-replica1." },
      { ops: [["insert", P, "monitor"]], en: "Insert a row on the primary.", pt: "Insira uma linha no primário." },
      { ops: [["select", R1], ["select", R2]], en: "pg-replica1 answers 2 rows, pg-replica2 answers 3: a stale read.", pt: "pg-replica1 responde 2 linhas, pg-replica2 responde 3: uma leitura desatualizada." },
      { ops: [["stat"]], en: "The primary sees how far behind each replica is, in bytes of WAL.", pt: "O primário vê quanto cada réplica está atrás, em bytes de WAL." },
      { ops: [["pause", R1, false], ["select", R1]], en: "Resume the replay: the row appears.", pt: "Retome o replay: a linha aparece." },
      { ops: [["connect", "read-write"]], en: "Experiment 4: the driver finds the node that accepts writes.", pt: "Experimento 4: o driver acha o nó que aceita escritas." },
      { ops: [["connect", "standby", 0], ["connect", "standby", 1]], en: "Reads on a random standby: never the primary.", pt: "Leituras num standby aleatório: nunca o primário." }
    ],
    sync: [
      { ops: [["setSync", 'FIRST 1 ("pg-replica1")']], en: "Experiment 5: pg-replica1 becomes synchronous.", pt: "Experimento 5: pg-replica1 fica síncrona." },
      { ops: [["stop", R1]], en: "Stop the synchronous replica.", pt: "Pare a réplica síncrona." },
      { ops: [["insert", P, "headset"]], en: "The INSERT hangs; Ctrl+C cancels only the wait — the row is committed on the primary.", pt: "O INSERT trava; Ctrl+C cancela só a espera — a linha está confirmada no primário." },
      { ops: [["setSync", 'ANY 1 ("pg-replica1", "pg-replica2")']], en: "A quorum: any one of the two replicas.", pt: "Um quórum: qualquer uma das duas réplicas." },
      { ops: [["insert", P, "webcam"]], en: "Returns at once: pg-replica2 confirmed it.", pt: "Retorna na hora: pg-replica2 confirmou." },
      { ops: [["start", R1], ["stat"]], en: "Both replicas are now quorum.", pt: "As duas réplicas agora são quorum." },
      { ops: [["setSync", ""]], en: "Back to asynchronous before the failover page.", pt: "De volta ao assíncrono antes da página de failover." }
    ],
    failover: [
      { ops: [["stop", P]], en: "Planned failover: the primary goes down.", pt: "Failover planejado: o primário cai." },
      { ops: [["connect", "read-write"]], en: "A client that needs to write finds no primary.", pt: "Um cliente que precisa escrever não acha primário." },
      { ops: [["promote", R1]], en: "Promote pg-replica1: a new timeline.", pt: "Promova pg-replica1: uma nova timeline." },
      { ops: [["insert", R1, "after-failover"]], en: "The new primary accepts writes.", pt: "O novo primário aceita escritas." },
      { ops: [["connect", "read-write"]], en: "The same connection string now finds pg-replica1.", pt: "A mesma string de conexão agora acha pg-replica1." },
      { ops: [["follow", R2, R1], ["select", R2]], en: "Re-point pg-replica2: it follows timeline 2 and has after-failover.", pt: "Reaponte pg-replica2: ela segue a timeline 2 e tem after-failover." },
      { ops: [["rejoin", P, R1]], en: "The old primary rejoins as a replica: no rewind required after a clean stop.", pt: "O primário antigo volta como réplica: nenhum rewind necessário após uma parada limpa." },
      { ops: [["start", P], ["stat"]], en: "The cluster is whole again, with the roles swapped.", pt: "O cluster está inteiro de novo, com os papéis trocados." }
    ],
    "lost-write": [
      { ops: [["stop", R1], ["stop", R2]], en: "Unplanned failover: keep the replicas away from the last write.", pt: "Failover não planejado: mantenha as réplicas longe da última escrita." },
      { ops: [["insert", P, "lost-write"]], en: "INSERT 0 1: for the client, the order exists.", pt: "INSERT 0 1: para o cliente, o pedido existe." },
      { ops: [["stop", P, true], ["start", R1], ["start", R2]], en: "Kill the primary, start the replicas.", pt: "Mate o primário, inicie as réplicas." },
      { ops: [["promote", R1], ["insert", R1, "after-failover"]], en: "Fail over as before.", pt: "Faça o failover como antes." },
      { ops: [["follow", R2, R1], ["select", R1]], en: "lost-write is gone; after-failover got id 34 (the sequence skipped the rest of its batch).", pt: "lost-write sumiu; after-failover recebeu o id 34 (a sequência pulou o resto do lote)." },
      { ops: [["rejoin", P, R1]], en: "pg_rewind has work to do this time: it discards lost-write.", pt: "Desta vez o pg_rewind tem trabalho: ele descarta lost-write." },
      { ops: [["start", P], ["select", P]], en: "pg-primary is a replica and agrees with the new primary.", pt: "pg-primary é réplica e concorda com o novo primário." }
    ]
  };
  var OPS = { insert: insert, select: select, pause: pause, stop: stop, start: start, promote: promote, follow: follow, rejoin: rejoin, connect: connect, stat: stat, setSync: setSync };
  function run(st, op) { return OPS[op[0]].apply(null, [st].concat(op.slice(1))); }
  /* the state after the first n steps of a script, and every result */
  function play(name, n) {
    var st = create(), out = [];
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (step) { step.ops.forEach(function (op) { out.push(run(st, op)); }); });
    return { st: st, out: out };
  }

  var API = { NAMES: NAMES, BYTES: BYTES, SEQ_LOG: SEQ_LOG, SCRIPTS: SCRIPTS, create: create, node: node, rows: rows, primaries: primaries, run: run, play: play,
    insert: insert, select: select, pause: pause, stop: stop, start: start, promote: promote, follow: follow, rejoin: rejoin, connect: connect, stat: stat, setSync: setSync };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  var POS = { "pg-primary": { x: 150, y: 88 }, "pg-replica1": { x: 420, y: 8 }, "pg-replica2": { x: 420, y: 168 } };
  var BW = 200, BH = 74, CL = { x: 6, y: 104, w: 92, h: 42 };
  function L(pair) { return PT ? pair[1] : pair[0]; }

  C.style("pg-cluster", [
    ".md-typeset .csim-pg-row { stroke-width: 1; }",
    ".md-typeset .csim-pg-row.have { fill: var(--c-tint2); stroke: var(--c-ink); }",
    ".md-typeset .csim-pg-row.wait { fill: var(--c-bg); stroke: var(--c-warn); stroke-dasharray: 3 2; }",
    ".md-typeset .csim-pg-row.lost { fill: color-mix(in srgb, var(--c-bad) 18%, var(--c-bg)); stroke: var(--c-bad); }",
    ".md-typeset .csim-pg-wire.on { marker-end: none; }",
    ".md-typeset .csim .csim-pg-node { cursor: pointer; }",
    ".md-typeset .csim .csim-pg-node.sel > rect:first-child { stroke-width: 3; }",
    ".md-typeset .csim .csim-pg-node.down text { fill: var(--c-fg3); }",
    ".md-typeset .csim-log.csim-pg-term li { font-family: var(--md-code-font-family, monospace); font-size: .62rem; white-space: pre-wrap; }",
    ".md-typeset .csim-log.csim-pg-term li b { font-weight: 600; }",
    ".md-typeset .csim-pg-acts .csim-btn[disabled] { opacity: .4; cursor: default; }"
  ].join("\n"));

  C.register("pg-cluster", function (root) {
    var o = C.opts(root, { script: "replication" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st, sel = P, lastHost = null, pickN = 0;

    var svg = s("svg", { viewBox: "0 0 630 250", role: "img", "aria-label": t("PostgreSQL cluster", "Cluster PostgreSQL") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(6); term.className += " csim-pg-term";
    var tiles = C.stats([
      { key: "prim", label: t("primaries up", "primários no ar") },
      { key: "rows", label: t("rows on the primary", "linhas no primário") },
      { key: "blocked", label: t("commits that hung", "commits que travaram") },
      { key: "lost", label: t("writes lost", "escritas perdidas") }
    ]);
    function say(pair, tone) { note.textContent = pair ? L(pair) : ""; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    function show(r) {
      var li = term.add(el("span", {}, [el("b", { text: r.cmd }), "\n" + r.out.join("\n")]), r.tone === "info" ? "" : r.tone);
      if (r.host) lastHost = r.host;
      return li;
    }

    var cScript = C.choice({ label: t("Lab page", "Página do lab"), value: script, options: [
      { value: "replication", label: t("Replication 1–4", "Replicação 1–4") },
      { value: "sync", label: t("Replication 5 (sync)", "Replicação 5 (sync)") },
      { value: "failover", label: t("Planned failover", "Failover planejado") },
      { value: "lost-write", label: t("Lost write", "Escrita perdida") },
      { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; reset(); } });

    function act(fn) { return function () { player.pause(); var r = fn(); if (r) { show(r); say(r.note, r.tone === "info" ? "" : r.tone); } draw(); }; }
    function current() { return primaries(st).filter(function (x) { return x.name !== sel; })[0] || null; }
    var B = {
      ins: C.button("INSERT", act(function () { return insert(st, sel); }), { tone: "ok" }),
      sel: C.button("SELECT", act(function () { return select(st, sel); })),
      pause: C.button("pg_wal_replay_pause", null),
      stop: C.button("stop", act(function () { return stop(st, sel); })),
      kill: C.button("kill", act(function () { return stop(st, sel, true); }), { tone: "bad" }),
      start: C.button("start", act(function () { return start(st, sel); })),
      promote: C.button("pg_promote()", act(function () { return promote(st, sel); }), { tone: "bad" }),
      follow: C.button(t("follow the primary", "seguir o primário"), act(function () { var p = current(); return p ? follow(st, sel, p.name) : null; })),
      rejoin: C.button("pg_rewind", act(function () { var p = current(); return p ? rejoin(st, sel, p.name) : null; }))
    };
    B.pause.onclick = act(function () { var n = node(st, sel); return pause(st, sel, !n.paused); });
    var cSync = C.choice({ label: "synchronous_standby_names", value: "", options: [
      { value: "", label: "async" }, { value: 'FIRST 1 ("pg-replica1")', label: "FIRST 1 (r1)" }, { value: 'ANY 1 ("pg-replica1", "pg-replica2")', label: "ANY 1 (r1, r2)" }
    ], onChange: act(function () { return setSync(st, cSync.get(), cCommit.get()); }) });
    var cCommit = C.choice({ label: "synchronous_commit", value: "on", options: [{ value: "on", label: "on" }, { value: "remote_apply", label: "remote_apply" }],
      onChange: act(function () { return setSync(st, cSync.get(), cCommit.get()); }) });
    var bRW = C.button(t("client: read-write", "cliente: read-write"), act(function () { return connect(st, "read-write"); }));
    var bSB = C.button(t("client: standby", "cliente: standby"), act(function () { return connect(st, "standby", pickN++); }));
    var bStat = C.button("pg_stat_replication", act(function () { return stat(st); }));

    var player = C.player({
      interval: 1600,
      onTick: function (k) { step(k); },
      onPrev: function (k) { replay(k); },
      onReset: function () { reset(); }
    });

    function step(k) {
      var sc = SCRIPTS[script];
      if (!sc || k > sc.length) return false;
      var tone = "";
      sc[k - 1].ops.forEach(function (op) { var r = run(st, op); show(r); if (r.tone === "bad" || r.tone === "warn") tone = r.tone; });
      say([sc[k - 1].en, sc[k - 1].pt], tone);
      draw();
    }
    function replay(k) {
      st = create(); term.clear(); lastHost = null;
      for (var i = 1; i <= k; i++) step(i);
      if (!k) intro();
      draw();
    }
    function intro() {
      say(script === "free"
        ? ["Click a node to select it, then run a command on it. Every button is a command of the lab.", "Clique num nó para selecioná-lo e rode um comando nele. Cada botão é um comando do lab."]
        : ["The lab's starting point: orders has keyboard and mouse, both replicas stream. Press play or → to run the page's commands; the buttons work at any time.",
           "O ponto de partida do lab: orders tem keyboard e mouse, as duas réplicas recebem o WAL. Aperte play ou → para rodar os comandos da página; os botões funcionam a qualquer momento."], "");
    }
    function reset() {
      st = create(); term.clear(); lastHost = null; pickN = 0;
      cSync.set(""); cCommit.set("on");
      player.total(SCRIPTS[script] ? SCRIPTS[script].length : 0);
      player.style.display = SCRIPTS[script] ? "" : "none";
      intro();
      draw();
    }

    function center(n) { var p = POS[n]; return { x: p.x + BW / 2, y: p.y + BH / 2 }; }

    function draw() {
      C.clear(svg);
      var p = primary(st), pHist = p ? p.hist : [];
      /* client wires */
      NAMES.forEach(function (h) {
        var c = center(h), x0 = CL.x + CL.w, y0 = CL.y + CL.h / 2;
        svg.appendChild(s("path", { d: "M" + x0 + "," + y0 + " C" + (x0 + 30) + "," + c.y + " " + (POS[h].x - 30) + "," + c.y + " " + POS[h].x + "," + c.y,
          class: "c-wire" + (lastHost === h ? " on" : "") }));
      });
      /* WAL wires, upstream → replica */
      st.nodes.forEach(function (n) {
        if (n.role !== "replica" || !n.upstream) return;
        var a = center(n.upstream), b = center(n.name);
        var u = node(st, n.upstream), live = n.up && u.up && !n.diverged;
        var cls = "c-wire" + (live ? " on" : n.diverged ? " cut" : "");
        var y1 = a.y + (b.y > a.y ? BH / 2 : b.y < a.y ? -BH / 2 : 0), y2 = b.y + (b.y > a.y ? -BH / 2 : b.y < a.y ? BH / 2 : 0);
        var x1 = a.x + (Math.abs(b.y - a.y) < 5 ? (b.x > a.x ? BW / 2 : -BW / 2) : 0), x2 = b.x + (Math.abs(b.y - a.y) < 5 ? (b.x > a.x ? -BW / 2 : BW / 2) : 0);
        svg.appendChild(s("line", { x1: x1, y1: y1, x2: x2, y2: y2, class: cls }));
        svg.appendChild(s("text", { x: (x1 + x2) / 2 + 6, y: (y1 + y2) / 2 + 3, class: "c-small" + (live ? "" : " c-bad") },
          live ? (n.paused ? t("WAL · replay paused", "WAL · replay pausado") : "WAL") : n.diverged ? t("diverged", "divergiu") : t("no stream", "sem stream")));
      });
      /* the client */
      svg.appendChild(s("rect", { x: CL.x, y: CL.y, width: CL.w, height: CL.h, rx: 6, class: "c-box on" }));
      svg.appendChild(s("text", { x: CL.x + CL.w / 2, y: CL.y + 18, "text-anchor": "middle", class: "c-label" }, t("client", "cliente")));
      svg.appendChild(s("text", { x: CL.x + CL.w / 2, y: CL.y + 32, "text-anchor": "middle", class: "c-small" }, "psql / JDBC"));
      /* the nodes */
      st.nodes.forEach(function (n) {
        var q = POS[n.name], split = primaries(st).length > 1;
        var box = !n.up ? "down" : n.role === "primary" ? (split ? "bad" : "hot") : n.diverged ? "bad" : p && rows(n).length !== rows(p).length ? "warn" : "on";
        var g = s("g", { class: "csim-pg-node" + (n.up ? "" : " down") + (n.name === sel ? " sel" : ""), onclick: function () { sel = n.name; draw(); } });
        g.appendChild(s("rect", { x: q.x, y: q.y, width: BW, height: BH, rx: 8, class: "c-box " + box }));
        g.appendChild(s("text", { x: q.x + 8, y: q.y + 16, class: "c-label" }, n.name));
        var role = !n.up ? t("down", "fora do ar") + (n.role === "primary" ? t(" (was primary)", " (era primário)") : "")
          : n.role === "primary" ? t("primary", "primário") : t("replica", "réplica") + (n.paused ? t(" · paused", " · pausada") : "");
        g.appendChild(s("text", { x: q.x + BW - 8, y: q.y + 16, "text-anchor": "end", class: "c-small" }, role + " · tl " + n.tl));
        /* the last rows it has: replayed, received but not replayed, or not in the primary's history */
        var ins = n.hist.map(function (e, i) { return { e: e, i: i }; }).filter(function (x) { return x.e.kind === "insert"; }).slice(-4);
        ins.forEach(function (x, j) {
          var cx = q.x + 6 + j * 48, lost = p && p !== n && !pHist.some(function (y) { return y.k === x.e.k; });
          g.appendChild(s("rect", { x: cx, y: q.y + 26, width: 46, height: 18, rx: 3, class: "csim-pg-row " + (lost ? "lost" : x.i < n.applied ? "have" : "wait") }));
          g.appendChild(s("text", { x: cx + 23, y: q.y + 38.5, "text-anchor": "middle", class: "c-small c-mono" }, x.e.id + " " + x.e.item.slice(0, x.e.id > 9 ? 4 : 5)));
        });
        var behind = n.hist.slice(n.applied).filter(function (e) { return e.kind === "insert"; }).length;
        var line = n.role === "primary" ? rows(n).length + t(" rows", " linhas") + (n.sync ? " · " + (n.sync.indexOf("ANY") === 0 ? "ANY 1" : "FIRST 1") : " · async")
          : behind ? behind + t(" not replayed", " não aplicada(s)") : n.diverged ? t("cannot follow " + n.upstream, "não segue " + n.upstream)
          : rows(n).length + t(" rows · from ", " linhas · de ") + n.upstream;
        g.appendChild(s("text", { x: q.x + 8, y: q.y + 62, class: "c-small" + (behind || n.diverged ? " c-warn" : "") }, line));
        svg.appendChild(g);
      });
      /* buttons that make sense for the selected node */
      var n = node(st, sel), other = current();
      B.ins.disabled = !n.up; B.sel.disabled = !n.up;
      B.pause.disabled = !n.up || n.role !== "replica"; B.pause.textContent = n.paused ? "pg_wal_replay_resume" : "pg_wal_replay_pause";
      B.stop.disabled = !n.up; B.kill.disabled = !n.up; B.start.disabled = n.up;
      B.promote.disabled = !n.up || n.role !== "replica";
      B.follow.disabled = !n.up || n.role !== "replica" || !other || n.upstream === other.name;
      B.rejoin.disabled = n.up || !other;
      selLabel.textContent = t("Selected: ", "Selecionado: ") + sel;
      var ps = primaries(st);
      tiles.set("prim", String(ps.length), ps.length === 1 ? "ok" : "bad");
      tiles.set("rows", p ? String(rows(p).length) : "–", "");
      tiles.set("blocked", String(st.blocked), st.blocked ? "warn" : "");
      tiles.set("lost", st.lost.length ? st.lost.join(", ") : "0", st.lost.length ? "bad" : "ok");
    }

    var selLabel = el("span", { class: "csim-lbl" });
    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's cluster, without Docker: replication, lag, synchronous commits and failover",
        "O cluster do lab, sem Docker: replicação, atraso, commits síncronos e failover") }),
      el("p", { class: "csim-sub", text: t("Each button runs a command of the lab on the selected node (click a node). Filled rows are replayed, dashed rows are received but not replayed, red rows are not in the primary's history.",
        "Cada botão roda um comando do lab no nó selecionado (clique num nó). Linhas cheias foram aplicadas, tracejadas foram recebidas e não aplicadas, vermelhas não estão na história do primário.") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-row csim-pg-acts" }, [selLabel, B.ins, B.sel, B.pause, B.stop, B.kill, B.start, B.promote, B.follow, B.rejoin]),
      el("div", { class: "csim-row" }, [cSync, cCommit]),
      el("div", { class: "csim-row" }, [bRW, bSB, bStat]),
      note,
      player,
      el("div", { class: "csim-cols" }, [tiles, term])
    ]);
    reset();
    return {};
  });
})();
