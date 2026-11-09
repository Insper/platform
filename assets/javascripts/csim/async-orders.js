/*
 * The async pipeline of hands-on 7 (2027.1), as a lab twin:
 *
 *   <div class="csim" data-sim="async-orders" data-script="outbox"></div>
 *
 * order writes the order and an OrderPlaced row of `outbox` in one transaction (POST /orders, idempotent
 * by hold_id); the outbox relay, every 200 ms, sends the unpublished rows to order-events (key = orderId,
 * Kafka's murmur2 partitioner, 6 partitions) and marks them only after the acks, so Kafka down loses no
 * event and a crash after the ack publishes it again. notification consumes the topic in the group
 * notification (ack-mode record): it claims the eventId in processed_events in the same transaction as
 * the e-mail (NOTIFY_IDEMPOTENT), retries a transient failure after 0.5, 1 and 2 s and then dead-letters
 * it to order-events-dlt (same partition); IllegalArgumentException and JacksonException skip the
 * retries. DeadLetterListener stores every dead letter in dead_letters.
 *
 * A script (data-script) replays a lab page step by step: outbox (step 2), consumer (step 3) or drain
 * (step 5, experiments B and C, a per-second model of the lag: NOTIFY_CONCURRENCY threads share the 6
 * partitions with the range assignor, each sends one e-mail per EMAIL_LATENCY). "free" leaves the buttons.
 * Every value taken from the lab is in LAB (registered in scripts/csim/lab-values.mjs).
 */
(function () {
  "use strict";

  var LAB = { partitions: 6, concurrency: 3, emailMs: 50, idempotent: true, retries: 3, backoffMs: 500, backoffMult: 2,
    relayMs: 200, maxBlockMs: 5000, rate: 50, duration: 60, outageAt: 20, outageFor: 20, burstRate: 100 };
  var TOPIC = "order-events", DLT = "order-events-dlt", GROUP = "notification";
  var FIRST_ID = "28cb9305-e1ce-4b49-aba7-665bb1b244b5";   /* the order of the outbox page's curl */
  var FANS = { "hold-0001": "ana@example.com", "hold-0002": "bia@example.com", "hold-0003": "poison@example.com" };
  var TOUR = [["order-1", "{\"hello\":\"first\"}"], ["order-2", "{\"hello\":\"second\"}"], ["order-1", "{\"hello\":\"third\"}"]];
  var BASE = Date.UTC(2026, 9, 18, 17, 55, 45);

  /* org.apache.kafka.common.utils.Utils.murmur2 on the UTF-8 bytes of the key (keys here are ASCII) */
  function murmur2(str) {
    var length = str.length, m = 0x5bd1e995, r = 24;
    var h = (0x9747b28c ^ length) | 0, l4 = length >> 2, i, k;
    for (i = 0; i < l4; i++) {
      var i4 = i * 4;
      k = str.charCodeAt(i4) + (str.charCodeAt(i4 + 1) << 8) + (str.charCodeAt(i4 + 2) << 16) + (str.charCodeAt(i4 + 3) << 24);
      k = Math.imul(k, m); k ^= k >>> r; k = Math.imul(k, m);
      h = Math.imul(h, m); h ^= k;
    }
    var idx = l4 * 4, rest = length - idx;
    if (rest === 3) h ^= str.charCodeAt(idx + 2) << 16;
    if (rest >= 2) h ^= str.charCodeAt(idx + 1) << 8;
    if (rest >= 1) { h ^= str.charCodeAt(idx); h = Math.imul(h, m); }
    h ^= h >>> 13; h = Math.imul(h, m); h ^= h >>> 15;
    return h | 0;
  }
  function partitionFor(key, n) { return (murmur2(key) & 0x7fffffff) % n; }

  /* the range assignor, one topic: thread i gets a run of partitions, the first P % c get one more */
  function assign(P, c) {
    var each = Math.floor(P / c), extra = P % c, p = 0, out = [];
    for (var i = 0; i < c; i++) { var k = each + (i < extra ? 1 : 0), run = []; for (var j = 0; j < k; j++) run.push(p++); out.push(run); }
    return out;
  }
  function backoffs() { var out = [], d = LAB.backoffMs; for (var i = 0; i < LAB.retries; i++) { out.push(d); d *= LAB.backoffMult; } return out; }

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function uuid(rand) {
    var h = "";
    for (var i = 0; i < 32; i++) h += Math.floor(rand() * 16).toString(16);
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-a" + h.slice(17, 20) + "-" + h.slice(20);
  }
  function clock(st) {
    var d = new Date(BASE + Math.round(st.t * 1000));
    function two(n) { return (n < 10 ? "0" : "") + n; }
    return "2026-10-18 " + two(d.getUTCHours()) + ":" + two(d.getUTCMinutes()) + ":" + two(d.getUTCSeconds()) + "." + String(d.getUTCMilliseconds()).padStart(3, "0");
  }

  /* ------------------------------------------------------------------ the pipeline, one command at a time */

  /* o.notif = false: notification not running yet (steps 2 and 3 start that way) */
  function create(o) {
    o = o || {};
    var st = { t: 0, rand: rng(7), mode: "outbox", kafka: true, notif: o.notif !== false, unborn: o.notif === false, mail: true, idem: LAB.idempotent,
      orders: [], byHold: {}, outbox: [], logs: [], dlt: [], committed: [], seq: 0, holds: 3,
      processed: {}, inbox: [], deadLetters: [], hot: [], fans: {} };
    Object.keys(FANS).forEach(function (h) { st.fans[h] = FANS[h]; });
    for (var p = 0; p < LAB.partitions; p++) { st.logs.push([]); st.dlt.push([]); st.committed.push(0); }
    return st;
  }
  function lagOf(st, p) { return st.logs[p].length - st.committed[p]; }
  function lag(st) { var s = 0; for (var p = 0; p < LAB.partitions; p++) s += lagOf(st, p); return s; }
  function pending(st) { return st.outbox.filter(function (r) { return !r.published; }).length; }
  function emailsPerOrder(st) {
    var c = {}; st.inbox.forEach(function (e) { c[e.orderId] = (c[e.orderId] || 0) + 1; });
    return c;
  }
  function duplicates(st) { var c = emailsPerOrder(st), d = 0; Object.keys(c).forEach(function (k) { d += c[k] - 1; }); return d; }
  function produce(st, key, value) {
    var p = partitionFor(key, LAB.partitions), rec = { p: p, offset: st.logs[p].length, key: key, value: value, seq: st.seq++ };
    st.logs[p].push(rec);
    return rec;
  }
  function json(o) { return JSON.stringify(o); }
  function curl(hold, email) {
    return "curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' -d '{\"showId\":\"show-42\",\"holdId\":\"" + hold + "\",\"customerEmail\":\"" + email + "\",\"amount\":350.00}'";
  }

  /* step 1's tour: three keyed messages that are not BoxOffice events */
  function tour(st) {
    var out = TOUR.map(function (kv) { var r = produce(st, kv[0], kv[1]); return "Partition:" + r.p + "\t" + kv[0] + "\t" + kv[1]; });
    return { cmd: "kafka-console-producer.sh --topic order-events (parse.key=true): order-1, order-2, order-1", out: out, tone: "info",
      note: ["Same key, same partition: both order-1 messages are in partition 4.", "Mesma chave, mesma partição: as duas mensagens order-1 estão na partição 4."] };
  }

  /* POST /orders; without a hold, a new one (poison: a customerEmail that the e-mail provider rejects) */
  function post(st, hold, poison) {
    if (!hold) { hold = "hold-" + String(++st.holds).padStart(4, "0"); st.fans[hold] = (poison ? "poison" : "fan") + st.holds + "@example.com"; }
    var cmd = curl(hold, st.fans[hold]), o = st.byHold[hold];
    if (o) return { cmd: cmd, out: ["HTTP 200 " + view(o)], tone: "ok", status: 200, order: o,
      note: ["Same hold, same order: ON CONFLICT (hold_id) DO NOTHING inserted nothing, so no new outbox row.", "Mesmo hold, mesmo pedido: ON CONFLICT (hold_id) DO NOTHING não inseriu nada, então nenhuma linha nova no outbox."] };
    var id = st.orders.length ? uuid(st.rand) : FIRST_ID;
    o = { id: id, hold: hold, email: st.fans[hold], at: st.t };
    var ev = { eventId: uuid(st.rand), eventType: "OrderPlaced", orderId: id, holdId: hold, customerEmail: o.email };
    if (st.mode === "sync") {
      if (!st.notif) return { cmd: cmd, out: ["HTTP 500 (I/O error on POST request for \"http://notification:8086/notifications\")"], tone: "bad", status: 500,
        note: ["NOTIFY_MODE=sync: the e-mail is inside the request, so notification down means no order at all (the transaction rolls back).", "NOTIFY_MODE=sync: o e-mail está dentro da requisição, então notification fora do ar significa nenhum pedido (a transação é desfeita)."] };
      if (!st.mail) return { cmd: cmd, out: ["HTTP 500 (notification answered 500: Mail server connection failed)"], tone: "bad", status: 500,
        note: ["NOTIFY_MODE=sync: an e-mail provider outage became an ordering outage.", "NOTIFY_MODE=sync: uma queda do provedor de e-mail virou uma queda de pedidos."] };
      if (!o.email.indexOf("poison")) return { cmd: cmd, out: ["HTTP 500 (notification answered 500: mailbox rejected)"], tone: "bad", status: 500,
        note: ["NOTIFY_MODE=sync: the e-mail failed, so the order failed too.", "NOTIFY_MODE=sync: o e-mail falhou, então o pedido também falhou."] };
      st.t += LAB.emailMs / 1000;
      st.orders.push(o); st.byHold[hold] = o;
      st.inbox.push({ orderId: id, to: o.email, eventId: ev.eventId });
      return { cmd: cmd, out: ["HTTP 201 " + view(o)], tone: "warn", status: 201, order: o,
        note: ["NOTIFY_MODE=sync: the fan waited for the e-mail (" + LAB.emailMs + " ms) before the 201.", "NOTIFY_MODE=sync: o fã esperou o e-mail (" + LAB.emailMs + " ms) antes do 201."] };
    }
    st.orders.push(o); st.byHold[hold] = o;
    st.outbox.push({ ev: ev, created: st.t, published: null });
    return { cmd: cmd, out: ["HTTP 201 " + view(o)], tone: "ok", status: 201, order: o,
      note: ["One transaction: the order and its OrderPlaced row in outbox. The fan has the 201; nothing has reached Kafka yet.", "Uma transação: o pedido e a sua linha OrderPlaced no outbox. O fã já tem o 201; nada chegou ao Kafka ainda."] };
  }
  function view(o) {
    return json({ id: o.id, showId: "show-42", holdId: o.hold, customerEmail: o.email, amount: 350.00 }).replace("\"amount\":350", "\"amount\":350.00").replace("}", ",\"status\":\"PENDING_PAYMENT\"}");
  }

  /* one run of OutboxRelay.relay(): crash = the process dies after the acks, before the UPDATE */
  function relay(st, crash) {
    var batch = st.outbox.filter(function (r) { return !r.published; });
    var cmd = "docker compose logs order | grep -i relay";
    if (!batch.length) return { cmd: cmd, out: ["(no unpublished rows: the relay found nothing)"], tone: "info", n: 0, note: ["", ""] };
    if (!st.kafka) {
      st.t += LAB.maxBlockMs / 1000;
      return { cmd: cmd, out: ["order-1  | " + clock(st) + " ERROR … Unexpected error occurred in scheduled task (" + batch.length + " row(s) still unpublished)"], tone: "bad", n: 0,
        note: ["Kafka is down: the send fails after max.block.ms (" + LAB.maxBlockMs / 1000 + " s), the transaction rolls back and the rows wait for the next run.",
          "O Kafka está fora: o envio falha depois de max.block.ms (" + LAB.maxBlockMs / 1000 + " s), a transação é desfeita e as linhas esperam a próxima execução."] };
    }
    st.t += LAB.relayMs / 1000;
    var recs = batch.map(function (r) { var rec = produce(st, r.ev.orderId, r.ev); return rec.p + "@" + rec.offset; });
    if (crash) return { cmd: cmd, out: ["order-1  | (killed after the acks, before UPDATE outbox SET published_at: " + recs.join(", ") + " are in Kafka, the rows are still unpublished)"], tone: "bad", n: batch.length,
      note: ["The events are in Kafka, but the outbox still says unpublished: the next run sends them again, with the same eventId (at-least-once).",
        "Os eventos estão no Kafka, mas o outbox ainda diz não publicado: a próxima execução os envia de novo, com o mesmo eventId (pelo menos uma vez)."] };
    batch.forEach(function (r) { r.published = st.t; });
    return { cmd: cmd, out: ["order-1  | " + clock(st) + "  INFO … OutboxRelay : relayed " + batch.length + " event(s) to " + TOPIC + "  → " + recs.join(", ")], tone: "ok", n: batch.length,
      note: ["Sent with key = orderId, acks=all; only after every ack does the relay set published_at.", "Enviado com chave = orderId, acks=all; só depois de todos os acks o relay preenche published_at."] };
  }

  /* notification: every record after the committed offset, in production order (ack-mode record) */
  function consume(st) {
    var cmd = "docker compose logs notification";
    if (!st.notif) return { cmd: cmd, out: ["(notification is stopped: the lag grows, nothing is lost)"], tone: "warn", note: ["", ""] };
    var todo = [];
    st.logs.forEach(function (l, p) { for (var i = st.committed[p]; i < l.length; i++) todo.push(l[i]); });
    todo.sort(function (a, b) { return a.seq - b.seq; });
    var out = [], sent = 0, skipped = 0, dead = 0, tone = "ok";
    todo.forEach(function (rec) {
      var ev = rec.value, why = null, retried = false;
      if (typeof ev === "string") why = "java.lang.IllegalArgumentException";       /* not a BoxOffice event */
      else if (st.idem && st.processed[ev.eventId]) {
        out.push("notification-1  | INFO … duplicate event " + ev.eventId.slice(0, 8) + "… for order " + ev.orderId.slice(0, 8) + "… ignored"); skipped++;
      } else if (!ev.customerEmail.indexOf("poison")) why = "java.lang.IllegalArgumentException";
      else if (!st.mail) { why = "org.springframework.mail.MailSendException"; retried = true; }
      else {
        if (st.idem) st.processed[ev.eventId] = true;
        st.inbox.push({ orderId: ev.orderId, to: ev.customerEmail, eventId: ev.eventId }); sent++;
        out.push("notification-1  | e-mail to " + ev.customerEmail + " for order " + ev.orderId.slice(0, 8) + "…");
      }
      if (why) {
        if (retried) {
          var b = backoffs();
          out.push("notification-1  | " + rec.p + "@" + rec.offset + ": " + why + ", retried after " + b.map(function (x) { return x / 1000 + " s"; }).join(", ") + " (partition " + rec.p + " waits " + b.reduce(function (a, x) { return a + x; }, 0) / 1000 + " s)");
          st.t += b.reduce(function (a, x) { return a + x; }, 0) / 1000;
        }
        var d = { p: rec.p, offset: st.dlt[rec.p].length, from: rec.p + "@" + rec.offset, why: why, key: rec.key, n: st.deadLetters.length };
        st.dlt[rec.p].push(d); rec.dead = true; dead++; tone = "warn";
        /* DeadLetterListener (group notification-dlt) stores it in dead_letters */
        out.push("notification-1  | WARN … DeadLetterListener : dead letter at " + DLT + "-" + d.p + "@" + d.offset + ": " + d.why);
        st.deadLetters.push({ topic: DLT, partition: d.p, offset: d.offset, reason: d.why });
      }
      st.committed[rec.p] = rec.offset + 1;
      st.hot.push(rec.p);
    });
    /* DeadLetterListener (group notification-dlt) stores what just arrived */
    if (!todo.length) out.push("(nothing new: lag 0)");
    return { cmd: cmd, out: out, tone: tone, sent: sent, skipped: skipped, dead: dead, note: ["", ""] };
  }

  /* what the system does in about a second: a relay run, then the consumer */
  function tick(st) {
    var a = relay(st), b = consume(st);
    st.t += 1;
    return { cmd: "(+1 s) docker compose logs order notification", out: (a.n || !st.kafka && pending(st) ? a.out : []).concat(b.out), tone: a.tone === "bad" ? "bad" : b.tone, note: ["", ""] };
  }

  function stopKafka(st) { st.kafka = false; return { cmd: "docker compose stop kafka", out: [" ✔ Container boxoffice-kafka-1  Stopped"], tone: "warn", note: ["", ""] }; }
  function startKafka(st) {
    st.kafka = true; st.t += 60;
    return { cmd: "docker compose start kafka   (healthy again after about a minute)", out: [" ✔ Container boxoffice-kafka-1  Started"], tone: "ok", note: ["", ""] };
  }
  function stopNotif(st) { st.notif = false; return { cmd: "docker compose stop notification", out: [" ✔ Container boxoffice-notification-1  Stopped"], tone: "warn", note: ["", ""] }; }
  function startNotif(st) { st.notif = true; st.unborn = false; st.t += 20; return { cmd: "docker compose start --wait notification", out: [" ✔ Container boxoffice-notification-1  Healthy"], tone: "ok", note: ["", ""] }; }
  function stopMail(st) { st.mail = false; return { cmd: "docker compose stop mailpit", out: [" ✔ Container boxoffice-mailpit-1  Stopped"], tone: "warn", note: ["", ""] }; }
  function startMail(st) { st.mail = true; return { cmd: "docker compose start mailpit", out: [" ✔ Container boxoffice-mailpit-1  Started"], tone: "ok", note: ["", ""] }; }
  function setIdem(st, v) {
    st.idem = !!v; st.notif = true; st.unborn = false; st.t += 20;
    return { cmd: (v ? "" : "NOTIFY_IDEMPOTENT=false ") + "docker compose up -d --wait notification", out: [" ✔ Container boxoffice-notification-1  Healthy"], tone: v ? "ok" : "warn",
      note: v ? ["Dedupe on: processed_events is checked again (it kept the eventIds claimed before).", "Dedupe ligado: processed_events volta a ser consultada (ela guardou os eventIds já reivindicados)."]
        : ["Dedupe off: the consumer no longer claims the eventId before sending.", "Dedupe desligado: o consumidor não reivindica mais o eventId antes de enviar."] };
  }
  function setMode(st, m) {
    st.mode = m; st.t += 20;
    return { cmd: "NOTIFY_MODE=" + m + " docker compose up -d --wait order", out: [" ✔ Container boxoffice-order-1  Healthy"], tone: m === "sync" ? "warn" : "ok", note: ["", ""] };
  }
  function resetOffsets(st) {
    var cmd = "kafka-consumer-groups.sh --group notification --topic order-events --reset-offsets --to-earliest --execute";
    if (st.notif) return { cmd: cmd, out: ["Error: Assignments can only be reset if the group 'notification' is inactive, but the current state is Stable."], tone: "bad",
      note: ["Stop notification first: Kafka only rewinds a group with no active members.", "Pare o notification antes: o Kafka só rebobina um grupo sem membros ativos."] };
    var out = ["GROUP          TOPIC          PARTITION  NEW-OFFSET"];
    for (var p = 0; p < LAB.partitions; p++) { st.committed[p] = 0; out.push("notification   " + TOPIC + "   " + p + "          0"); }
    return { cmd: cmd, out: out, tone: "warn", note: ["The whole topic will be delivered again.", "O tópico inteiro será entregue de novo."] };
  }

  /* queries */
  function outboxRows(st) {
    var rows = st.outbox.slice(-3).reverse().map(function (r) {
      var c = clock({ t: r.created }), pub = r.published === null ? "" : clock({ t: r.published });
      return " OrderPlaced | " + c + "+00 | " + (pub ? pub + "+00" : "") + (pub ? "   (" + (r.published - r.created).toFixed(1) + " s after the commit)" : "");
    });
    return { cmd: "psql -c \"SELECT event_type, created_at, published_at FROM orders.outbox ORDER BY created_at DESC LIMIT 3;\"",
      out: [" event_type  |          created_at           |         published_at"].concat(rows.length ? rows : ["(0 rows)"]), tone: "info", note: ["", ""] };
  }
  function mailTotal(st) {
    return { cmd: "curl -s localhost:8025/api/v1/messages | jq '.total'", out: [String(st.inbox.length)], tone: duplicates(st) ? "bad" : "ok", total: st.inbox.length,
      note: duplicates(st) ? ["Mailpit has more e-mails than orders: " + duplicates(st) + " duplicate(s).", "O Mailpit tem mais e-mails que pedidos: " + duplicates(st) + " duplicado(s)."]
        : ["One e-mail per order.", "Um e-mail por pedido."] };
  }
  function deadRows(st) {
    return { cmd: "psql -c \"SELECT topic, partition, record_offset, reason FROM notification.dead_letters;\"",
      out: ["    topic     | partition | record_offset | reason"].concat(st.deadLetters.map(function (d) { return " " + d.topic + " | " + d.partition + " | " + d.offset + " | " + d.reason; })), tone: "info", rows: st.deadLetters.length, note: ["", ""] };
  }
  function lagCmd(st) {
    return { cmd: "sh scripts/kafka-lag.sh", out: [clock(st).slice(11, 19) + " lag=" + lag(st)], tone: lag(st) ? "warn" : "ok", lag: lag(st), note: ["", ""] };
  }

  /* ------------------------------------------------------------------ step 5: the lag, second by second */

  /*
   * One k6 run of load/orders-load.js: `rate` orders per second for `duration` s. In outbox mode every
   * order is accepted and lands on a partition by its key; each consumer thread sends at most
   * 1000 / emailMs e-mails per second, taking one record from each of its partitions in turn. With
   * `outage`, notification is stopped for outageFor s from outageAt s (it restarts instantly here; in the
   * lab add the JVM start and the rebalance). In sync mode the e-mail is in the request: orders fail while
   * notification is down and there is no lag.
   */
  function drain(o) {
    o = o || {};
    var P = LAB.partitions, c = o.concurrency || LAB.concurrency, rate = o.rate || LAB.rate, dur = o.duration || LAB.duration;
    var mode = o.mode || "outbox", per = Math.round(1000 / LAB.emailMs), threads = assign(P, c);
    var down = function (sec) { return !!o.outage && sec >= LAB.outageAt && sec < LAB.outageAt + LAB.outageFor; };
    var q = [], n = 0, failed = 0, accepted = 0, delays = [], series = [], peak = 0, peakAt = 0, peakParts = [], end = null;
    for (var p = 0; p < P; p++) q.push([]);
    for (var sec = 0; sec < 3600; sec++) {
      if (sec < dur) {
        for (var i = 0; i < rate; i++, n++) {
          var at = sec + i / rate;
          if (mode === "sync") { if (down(sec)) failed++; else { accepted++; delays.push(LAB.emailMs / 1000); } continue; }
          accepted++;
          q[partitionFor("order-" + n, P)].push(at);
        }
      }
      if (mode === "outbox" && !down(sec)) {
        threads.forEach(function (parts) {
          var budget = per, k = 0, idle = 0;
          while (budget > 0 && parts.length && idle < parts.length) {
            var part = parts[k++ % parts.length];
            if (!q[part].length) { idle++; continue; }
            idle = 0;
            var done = sec + (per - budget + 1) / per;
            delays.push(Math.max(LAB.emailMs / 1000, done - q[part].shift()));
            budget--;
          }
        });
      }
      var l = 0; q.forEach(function (x) { l += x.length; });
      series.push(l);
      if (l > peak) { peak = l; peakAt = sec + 1; peakParts = q.map(function (x) { return x.length; }); }
      if (sec + 1 >= dur && l === 0) { end = sec + 1; break; }
    }
    delays.sort(function (a, b) { return a - b; });
    var pct = function (f) { return delays.length ? delays[Math.min(delays.length - 1, Math.ceil(f * delays.length) - 1)] : 0; };
    return { mode: mode, concurrency: c, rate: rate, duration: dur, outage: !!o.outage, series: series, peak: peak, peakAt: peakAt,
      parts: peakParts.length ? peakParts : q.map(function () { return 0; }), end: end, drain: end === null ? null : end - dur,
      accepted: accepted, failed: failed, total: rate * dur, failRate: failed / (rate * dur), p50: pct(0.5), p95: pct(0.95),
      threads: threads, idle: threads.filter(function (t) { return !t.length; }).length, perThread: per };
  }

  /* ------------------------------------------------------------------ scripts */

  var SCRIPTS = {
    outbox: [
      { ops: [["post", "hold-0001"]], en: "POST /orders: the order and its OrderPlaced row commit together, and the fan gets 201 at once.", pt: "POST /orders: o pedido e a sua linha OrderPlaced são confirmados juntos e o fã recebe 201 na hora." },
      { ops: [["relay"]], en: "Within 200 ms the relay sends the row to order-events, key = order id, and marks it published after the ack.", pt: "Em até 200 ms o relay envia a linha para order-events, chave = id do pedido, e a marca como publicada depois do ack." },
      { ops: [["post", "hold-0001"], ["relay"]], en: "The same curl again: 200, the same id, no new row, nothing for the relay. The API is idempotent.", pt: "O mesmo curl de novo: 200, o mesmo id, nenhuma linha nova, nada para o relay. A API é idempotente." },
      { ops: [["stopKafka"], ["post", "hold-0002"], ["outboxRows"]], en: "Kafka stopped, a new order: 201 anyway, and its outbox row has an empty published_at.", pt: "Kafka parado, um pedido novo: 201 mesmo assim, e a linha dele no outbox tem published_at vazio." },
      { ops: [["relay"], ["relay"]], en: "Every relay run fails after max.block.ms and rolls back: the row waits, the fan noticed nothing.", pt: "Cada execução do relay falha depois de max.block.ms e é desfeita: a linha espera, o fã não percebeu nada." },
      { ops: [["startKafka"], ["relay"], ["outboxRows"]], en: "Kafka is back: the next run publishes the row. No event was lost.", pt: "O Kafka voltou: a próxima execução publica a linha. Nenhum evento se perdeu." },
      { ops: [["post"], ["crashRelay"], ["relay"]], en: "Not on the page: the relay dies after the ack, before the UPDATE. The next run sends the same event again: at-least-once, which is why step 3's consumer dedupes.", pt: "Fora da página: o relay morre depois do ack, antes do UPDATE. A próxima execução envia o mesmo evento de novo: pelo menos uma vez, e é por isso que o consumidor do passo 3 deduplica." }
    ],
    consumer: [
      { ops: [["tour"], ["post", "hold-0001"], ["relay"], ["post", "hold-0002"], ["relay"]], en: "Where steps 1 and 2 left the topic: the three tour messages and the two real orders, and no notification yet.", pt: "Onde os passos 1 e 2 deixaram o tópico: as três mensagens do passeio e os dois pedidos reais, e ainda nenhum notification." },
      { ops: [["startNotif"], ["consume"], ["mailTotal"]], en: "notification starts at the earliest offset: the tour messages go straight to the DLT (not retryable), the two orders become two e-mails.", pt: "O notification começa no offset mais antigo: as mensagens do passeio vão direto para a DLT (não repetíveis), os dois pedidos viram dois e-mails." },
      { ops: [["stopNotif"], ["resetOffsets"], ["startNotif"], ["consume"], ["mailTotal"]], en: "Replay the whole topic: both orders are duplicates now, Mailpit still has 2 e-mails.", pt: "Reprocesse o tópico inteiro: os dois pedidos agora são duplicados, o Mailpit continua com 2 e-mails." },
      { ops: [["stopNotif"], ["resetOffsets"], ["setIdem", false], ["consume"], ["mailTotal"]], en: "The same replay with NOTIFY_IDEMPOTENT=false: every e-mail goes out again.", pt: "O mesmo reprocessamento com NOTIFY_IDEMPOTENT=false: todos os e-mails saem de novo." },
      { ops: [["setIdem", true], ["post", "hold-0003"], ["relay"], ["consume"], ["deadRows"]], en: "Dedupe back on, then a poison order: 201 for the fan, IllegalArgumentException for the e-mail, straight to the DLT. The last row of dead_letters is the poison order.", pt: "Dedupe de volta, depois um pedido envenenado: 201 para o fã, IllegalArgumentException para o e-mail, direto para a DLT. A última linha de dead_letters é o pedido envenenado." },
      { ops: [["stopMail"], ["post"], ["relay"], ["consume"], ["startMail"]], en: "Not on the page: Mailpit down is a transient failure. Three retries, after 0.5, 1 and 2 s, block that partition 3.5 s; then the order goes to the DLT, to be replayed once Mailpit is back.", pt: "Fora da página: Mailpit fora do ar é uma falha transitória. Três novas tentativas, depois de 0,5, 1 e 2 s, bloqueiam aquela partição por 3,5 s; depois o pedido vai para a DLT, para ser reprocessado quando o Mailpit voltar." }
    ],
    drain: [
      { run: { mode: "sync", rate: LAB.rate, concurrency: LAB.concurrency, outage: true }, en: "B, NOTIFY_MODE=sync: " + LAB.rate + " orders/s, notification stopped for " + LAB.outageFor + " s in the middle. Every order in that window fails.", pt: "B, NOTIFY_MODE=sync: " + LAB.rate + " pedidos/s, notification parado por " + LAB.outageFor + " s no meio. Todo pedido nessa janela falha." },
      { run: { mode: "outbox", rate: LAB.rate, concurrency: LAB.concurrency, outage: true }, en: "B, NOTIFY_MODE=outbox: no order fails. The lag climbs while notification is down and drains once it is back.", pt: "B, NOTIFY_MODE=outbox: nenhum pedido falha. O lag sobe enquanto o notification está fora e drena quando ele volta." },
      { run: { mode: "outbox", rate: LAB.burstRate, concurrency: 1 }, en: "C, " + LAB.burstRate + " orders/s with NOTIFY_CONCURRENCY=1: one thread, 20 e-mails/s, for six partitions.", pt: "C, " + LAB.burstRate + " pedidos/s com NOTIFY_CONCURRENCY=1: uma thread, 20 e-mails/s, para seis partições." },
      { run: { mode: "outbox", rate: LAB.burstRate, concurrency: LAB.concurrency }, en: "The lab's default, 3 threads: 60 e-mails/s, still below 100 orders/s.", pt: "O padrão do lab, 3 threads: 60 e-mails/s, ainda abaixo de 100 pedidos/s." },
      { run: { mode: "outbox", rate: LAB.burstRate, concurrency: 6 }, en: "C with NOTIFY_CONCURRENCY=6: one thread per partition, 120 e-mails/s. The lag stays near zero.", pt: "C com NOTIFY_CONCURRENCY=6: uma thread por partição, 120 e-mails/s. O lag fica perto de zero." },
      { run: { mode: "outbox", rate: LAB.burstRate, concurrency: 8 }, en: "Eight threads change nothing: six partitions, so two threads sit idle.", pt: "Oito threads não mudam nada: seis partições, então duas threads ficam ociosas." }
    ]
  };
  var OPS = { post: post, relay: relay, crashRelay: function (st) { return relay(st, true); }, consume: consume, tick: tick, tour: tour,
    stopKafka: stopKafka, startKafka: startKafka, stopNotif: stopNotif, startNotif: startNotif, stopMail: stopMail, startMail: startMail,
    setIdem: setIdem, setMode: setMode, resetOffsets: resetOffsets, outboxRows: outboxRows, mailTotal: mailTotal, deadRows: deadRows, lag: lagCmd };
  function run(st, op) { return OPS[op[0]].apply(null, [st].concat(op.slice(1))); }
  var INIT = { outbox: { notif: false }, consumer: { notif: false } };
  function play(name, n) {
    var st = create(INIT[name]), out = [];
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (step) { (step.ops || []).forEach(function (op) { out.push(run(st, op)); }); });
    return { st: st, out: out };
  }

  var API = { LAB: LAB, TOPIC: TOPIC, DLT: DLT, GROUP: GROUP, FIRST_ID: FIRST_ID, SCRIPTS: SCRIPTS, murmur2: murmur2, partitionFor: partitionFor,
    INIT: INIT, assign: assign, backoffs: backoffs, create: create, run: run, play: play, lag: lag, pending: pending, duplicates: duplicates, drain: drain };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  function L(pair) { return pair ? (PT ? pair[1] : pair[0]) : ""; }
  function num(x, d) { return x.toLocaleString(PT ? "pt-BR" : "en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }

  C.style("async-orders", [
    ".md-typeset .csim-log.csim-ao-term li { font-family: var(--md-code-font-family, monospace); font-size: .6rem; white-space: pre-wrap; overflow-wrap: anywhere; }",
    ".md-typeset .csim-log.csim-ao-term li b { font-weight: 600; }",
    ".md-typeset .csim-ao-msg { stroke-width: 1; }",
    ".md-typeset .csim-ao-msg.done { fill: var(--c-tint2); stroke: var(--c-ink); }",
    ".md-typeset .csim-ao-msg.wait { fill: var(--c-bg); stroke: var(--c-warn); stroke-dasharray: 3 2; }",
    ".md-typeset .csim-ao-msg.bad { fill: color-mix(in srgb, var(--c-bad) 18%, var(--c-bg)); stroke: var(--c-bad); }",
    ".md-typeset .csim-ao-bar { fill: color-mix(in srgb, var(--c-warn) 45%, var(--c-bg)); stroke: var(--c-warn); }",
    ".md-typeset .csim-ao-lane { fill: none; stroke: var(--c-line); }",
    ".md-typeset .csim-ao-frame { fill: none; stroke: var(--c-line); stroke-dasharray: 5 4; }",
    ".md-typeset .csim-ao-frame.down { stroke: var(--c-bad); }",
    ".md-typeset .csim-ao-hide { display: none !important; }"
  ].join("\n"));

  C.register("async-orders", function (root) {
    var o = C.opts(root, { script: "outbox" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st, res = null, knobs = { mode: "outbox", concurrency: LAB.concurrency, rate: LAB.burstRate, outage: false };

    var svg = s("svg", { viewBox: "0 0 640 250", role: "img", "aria-label": t("The order service, its outbox, the order-events topic and notification", "O serviço order, o seu outbox, o tópico order-events e o notification") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(8); term.className += " csim-ao-term";
    var tiles = C.stats([
      { key: "orders", label: t("orders (201)", "pedidos (201)") },
      { key: "pend", label: t("outbox rows unpublished", "linhas do outbox não publicadas") },
      { key: "mail", label: t("e-mails in Mailpit", "e-mails no Mailpit") },
      { key: "dup", label: t("duplicate e-mails", "e-mails duplicados") },
      { key: "lag", label: t("group lag", "lag do grupo") },
      { key: "dlt", label: "dead_letters" }
    ]);
    var dtiles = C.stats([
      { key: "fail", label: t("orders failed", "pedidos com falha") },
      { key: "peak", label: t("peak lag", "lag máximo") },
      { key: "drain", label: t("drain after the load", "drenagem após a carga") },
      { key: "p95", label: t("e-mail delay p95", "atraso do e-mail p95") }
    ]);
    /* the chart keeps a fixed number of points: a new one per run, sized to it */
    function newChart(len) {
      return C.chart({ series: [{ label: t("lag (messages)", "lag (mensagens)"), cls: "tone-warn" }, { label: t("failed orders, cumulative", "pedidos com falha, acumulado"), cls: "tone-bad" }],
        len: len, title: t("kafka-lag.sh, every second of the run", "kafka-lag.sh, a cada segundo da execução") });
    }
    var chartBox = el("div", {}, newChart(2));
    var axis = el("p", { class: "csim-sub" });
    function say(pair, tone) { note.textContent = L(pair); note.className = "csim-note" + (tone && tone !== "info" ? " csim-" + tone : ""); }
    function show(r) { if (r) term.add(el("span", {}, [el("b", { text: r.cmd }), r.out.length ? "\n" + r.out.join("\n") : ""]), r.tone === "info" ? "" : r.tone); }

    var cScript = C.choice({ label: t("Lab page", "Página do lab"), value: script, options: [
      { value: "outbox", label: t("2 · Outbox", "2 · Outbox") },
      { value: "consumer", label: t("3 · Consumer", "3 · Consumidor") },
      { value: "drain", label: t("5 · Measure (B, C)", "5 · Medir (B, C)") },
      { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; reset(); } });

    function act(fn) { return function () { player.pause(); if (st) st.hot = []; var r = fn(); show(r); if (r) say(L(r.note) ? r.note : ["", ""], r.tone); sync(); draw(); }; }
    var B = {
      post: C.button("POST /orders", act(function () { return post(st); }), { tone: "ok" }),
      again: C.button(t("POST again (same hold)", "POST de novo (mesmo hold)"), act(function () { var last = st.orders[st.orders.length - 1]; return post(st, last ? last.hold : "hold-0001"); })),
      poison: C.button(t("POST poison@…", "POST poison@…"), act(function () { return post(st, null, true); }), { tone: "bad" }),
      tick: C.button(t("+1 s (relay, consumer)", "+1 s (relay, consumidor)"), act(function () { return tick(st); }), { tone: "ok" }),
      crash: C.button(t("relay dies after the ack", "relay morre depois do ack"), act(function () { return relay(st, true); }), { tone: "bad" }),
      kafka: C.button("kafka", act(function () { return st.kafka ? stopKafka(st) : startKafka(st); })),
      notif: C.button("notification", act(function () { return st.notif ? stopNotif(st) : startNotif(st); })),
      mail: C.button("mailpit", act(function () { return st.mail ? stopMail(st) : startMail(st); })),
      reset: C.button("--reset-offsets --to-earliest", act(function () { return resetOffsets(st); })),
      rows: C.button("SELECT … outbox", act(function () { return outboxRows(st); })),
      total: C.button(t("Mailpit total", "total do Mailpit"), act(function () { return mailTotal(st); })),
      dead: C.button("SELECT … dead_letters", act(function () { return deadRows(st); }))
    };
    var tIdem = C.toggle({ label: "NOTIFY_IDEMPOTENT", onChange: function (v) { act(function () { return setIdem(st, v); })(); } });
    var tSync = C.toggle({ label: "NOTIFY_MODE=sync", onChange: function (v) { act(function () { return setMode(st, v ? "sync" : "outbox"); })(); } });

    function rerun() { res = drain(knobs); draw(); }
    var kMode = C.choice({ label: "NOTIFY_MODE", value: "outbox", options: [{ value: "sync", label: "sync" }, { value: "outbox", label: "outbox" }],
      onChange: function (v) { player.pause(); knobs.mode = v; rerun(); say(["", ""], ""); } });
    var kConc = C.choice({ label: "NOTIFY_CONCURRENCY", value: String(LAB.concurrency), options: [1, 2, 3, 4, 5, 6, 8].map(function (n) { return { value: String(n), label: String(n) }; }),
      onChange: function (v) { player.pause(); knobs.concurrency = +v; rerun(); say(["", ""], ""); } });
    var kRate = C.choice({ label: "RATE", value: String(LAB.burstRate), options: [LAB.rate, LAB.burstRate].map(function (n) { return { value: String(n), label: n + "/s" }; }),
      onChange: function (v) { player.pause(); knobs.rate = +v; rerun(); say(["", ""], ""); } });
    var kOut = C.toggle({ label: t("stop notification " + LAB.outageFor + " s", "parar o notification " + LAB.outageFor + " s"), onChange: function (v) { player.pause(); knobs.outage = v; rerun(); say(["", ""], ""); } });

    var player = C.player({
      interval: 2200,
      onTick: function (k) { return step(k); },
      onPrev: function (k) { replay(k); },
      onReset: function () { reset(); }
    });

    var rowsDiscrete = [
      el("div", { class: "csim-row" }, [B.post, B.again, B.poison, B.tick, B.crash]),
      el("div", { class: "csim-row" }, [el("span", { class: "csim-lbl", text: t("start / stop:", "iniciar / parar:") }), B.kafka, B.notif, B.mail, B.reset]),
      el("div", { class: "csim-row" }, [tIdem, tSync, B.rows, B.total, B.dead])
    ];
    var rowDrain = el("div", { class: "csim-row" }, [kMode, kConc, kRate, kOut]);
    var colsDiscrete = el("div", { class: "csim-cols" }, [tiles, term]);
    var colsDrain = el("div", { class: "csim-cols" }, [dtiles, el("div", {}, [chartBox, axis])]);

    function sync() {
      if (st) { tIdem.set(st.idem); tSync.set(st.mode === "sync"); }
      kMode.set(knobs.mode); kConc.set(String(knobs.concurrency)); kRate.set(String(knobs.rate)); kOut.set(knobs.outage);
    }
    function step(k) {
      var sc = SCRIPTS[script];
      if (!sc || k > sc.length) return false;
      var cur = sc[k - 1], tone = "";
      if (cur.run) { Object.keys(cur.run).forEach(function (key) { knobs[key] = cur.run[key]; }); res = drain(knobs); }
      else {
        st.hot = [];
        cur.ops.forEach(function (op) { var r = run(st, op); show(r); if (r.tone === "bad" || r.tone === "warn") tone = r.tone; });
      }
      say([cur.en, cur.pt], cur.run ? (res.failed ? "bad" : res.drain > 60 ? "warn" : "ok") : tone);
      sync(); draw();
    }
    function replay(k) {
      st = create(INIT[script]); term.clear(); knobs = { mode: "outbox", concurrency: LAB.concurrency, rate: LAB.burstRate, outage: false }; res = drain(knobs);
      for (var i = 1; i <= k; i++) step(i);
      if (!k) intro();
      sync(); draw();
    }
    function intro() {
      say(script === "free"
        ? ["Place orders, let a second pass (+1 s), stop Kafka, notification or Mailpit, rewind the group, turn the dedupe off, switch to NOTIFY_MODE=sync.",
          "Faça pedidos, deixe passar um segundo (+1 s), pare o Kafka, o notification ou o Mailpit, rebobine o grupo, desligue o dedupe, mude para NOTIFY_MODE=sync."]
        : script === "drain"
          ? ["load/orders-load.js for " + LAB.duration + " s against the lab's pipeline: 6 partitions, one e-mail per " + LAB.emailMs + " ms per thread. Press play or → for the experiments; the knobs re-run at any time.",
            "load/orders-load.js por " + LAB.duration + " s contra o pipeline do lab: 6 partições, um e-mail a cada " + LAB.emailMs + " ms por thread. Aperte play ou → para os experimentos; os controles rodam de novo a qualquer momento."]
          : ["The lab's stack: order with its outbox, the relay, order-events with 6 partitions, notification with 3 threads, Mailpit and the DLT. Press play or → to run the page's steps; the buttons work at any time.",
            "A stack do lab: order com o seu outbox, o relay, order-events com 6 partições, notification com 3 threads, Mailpit e a DLT. Aperte play ou → para rodar os passos da página; os botões funcionam a qualquer momento."], "");
    }
    function reset() {
      st = create(INIT[script]); term.clear(); knobs = { mode: "outbox", concurrency: LAB.concurrency, rate: LAB.burstRate, outage: false }; res = drain(knobs);
      player.total(SCRIPTS[script] ? SCRIPTS[script].length : 0);
      player.style.display = SCRIPTS[script] ? "" : "none";
      var dr = script === "drain";
      rowsDiscrete.forEach(function (r) { r.classList.toggle("csim-ao-hide", dr); });
      colsDiscrete.classList.toggle("csim-ao-hide", dr);
      rowDrain.classList.toggle("csim-ao-hide", !dr);
      colsDrain.classList.toggle("csim-ao-hide", !dr);
      intro(); sync(); draw();
    }

    var TX = 196, TW = 232, NX = 470, NW = 164, CELL = 22;
    function laneY(p) { return 34 + p * 23; }
    function box(x, y, w, h, cls, title, sub, sub2) {
      svg.appendChild(s("rect", { x: x, y: y, width: w, height: h, rx: 7, class: "c-box " + cls }));
      svg.appendChild(s("text", { x: x + 8, y: y + 15, class: "c-label" }, title));
      if (sub) svg.appendChild(s("text", { x: x + 8, y: y + 29, class: "c-small" }, sub));
      if (sub2) svg.appendChild(s("text", { x: x + 8, y: y + 41, class: "c-small" }, sub2));
    }
    function wire(d, on, cut) { svg.appendChild(s("path", { d: d, class: "c-wire" + (cut ? " cut" : on ? " on" : "") })); }

    function draw() {
      C.clear(svg);
      if (script === "drain") return drawDrain();
      var threads = assign(LAB.partitions, LAB.concurrency);
      /* order + outbox */
      box(6, 8, 172, 40, st.mode === "sync" ? "warn" : "on", "order :8084", "NOTIFY_MODE=" + st.mode);
      svg.appendChild(s("rect", { x: 6, y: 56, width: 172, height: 112, rx: 7, class: "c-box" }));
      svg.appendChild(s("text", { x: 14, y: 71, class: "c-label" }, "orders.outbox"));
      var rows = st.outbox.slice(-5);
      if (!rows.length) svg.appendChild(s("text", { x: 14, y: 90, class: "c-small" }, t("(no rows)", "(sem linhas)")));
      rows.forEach(function (r, i) {
        svg.appendChild(s("text", { x: 14, y: 90 + i * 16, class: "c-small c-mono" }, r.ev.holdId));
        svg.appendChild(s("text", { x: 170, y: 90 + i * 16, "text-anchor": "end", class: "c-small " + (r.published === null ? "c-warn" : "c-ok") },
          r.published === null ? t("unpublished", "não publicada") : t("published", "publicada")));
      });
      /* relay */
      box(6, 176, 172, 44, pending(st) ? (st.kafka ? "hot" : "bad") : "on", t("outbox relay", "relay do outbox"), t("every ", "a cada ") + LAB.relayMs + " ms · acks=all");
      wire("M178,198 C" + (TX - 20) + ",198 " + (TX - 30) + ",120 " + (TX - 8) + ",120", pending(st) > 0 && st.kafka, pending(st) > 0 && !st.kafka);
      /* topic */
      svg.appendChild(s("rect", { x: TX - 8, y: 8, width: TW + 16, height: 168, rx: 10, class: "csim-ao-frame" + (st.kafka ? "" : " down") }));
      svg.appendChild(s("text", { x: TX, y: 24, class: "c-label" }, TOPIC));
      svg.appendChild(s("text", { x: TX + TW, y: 24, "text-anchor": "end", class: "c-small" + (st.kafka ? "" : " c-bad") }, st.kafka ? LAB.partitions + t(" partitions · Kafka 4 (KRaft)", " partições · Kafka 4 (KRaft)") : t("kafka stopped", "kafka parado")));
      for (var p = 0; p < LAB.partitions; p++) {
        var y = laneY(p), log = st.logs[p], shown = log.slice(-8);
        svg.appendChild(s("text", { x: TX, y: y + 14, class: "c-small" }, "P" + p));
        shown.forEach(function (m, j) {
          var x = TX + 18 + j * CELL, done = m.offset < st.committed[p], bad = m.dead || typeof m.value === "string" || (m.value.customerEmail && !m.value.customerEmail.indexOf("poison"));
          svg.appendChild(s("rect", { x: x, y: y, width: CELL - 3, height: 18, rx: 3, class: "csim-ao-msg " + (bad ? "bad" : done ? "done" : "wait") }));
          svg.appendChild(s("text", { x: x + (CELL - 3) / 2, y: y + 12.5, "text-anchor": "middle", class: "c-small" }, typeof m.value === "string" ? "?" : m.key.slice(0, 2)));
        });
        svg.appendChild(s("text", { x: TX + TW, y: y + 13, "text-anchor": "end", class: "c-small" + (lagOf(st, p) ? " c-warn" : "") }, t("lag ", "lag ") + lagOf(st, p)));
        var ti = threads.findIndex(function (r) { return r.indexOf(p) >= 0; });
        if (!st.unborn) wire("M" + (TX + TW + 8) + "," + (y + 9) + " C" + (NX - 12) + "," + (y + 9) + " " + (TX + TW + 20) + "," + (62 + ti * 13) + " " + NX + "," + (62 + ti * 13), st.notif && st.hot.indexOf(p) >= 0, !st.notif);
      }
      /* DLT */
      var dl = st.deadLetters.map(function (d) { return "P" + d.partition + "@" + d.offset; });
      svg.appendChild(s("rect", { x: TX - 8, y: 184, width: TW + 16, height: 36, rx: 7, class: "c-box " + (dl.length ? "warn" : "") }));
      svg.appendChild(s("text", { x: TX, y: 199, class: "c-label" }, DLT));
      svg.appendChild(s("text", { x: TX, y: 213, class: "c-small c-mono" }, dl.length ? (dl.length > 6 ? "… " : "") + dl.slice(-6).join(" ") : t("(empty) · same partition as the original", "(vazio) · mesma partição do original")));
      /* notification */
      box(NX, 8, NW, 100, !st.notif ? "down" : "on", "notification :8086", st.notif ? t("group notification · 3 threads", "grupo notification · 3 threads") : st.unborn ? t("not running yet (step 3)", "ainda não roda (passo 3)") : t("stopped", "parado"),
        "NOTIFY_IDEMPOTENT=" + st.idem);
      threads.forEach(function (r, i) {
        svg.appendChild(s("text", { x: NX + 8, y: 66 + i * 13, class: "c-small" }, t("thread ", "thread ") + (i + 1) + " ← P" + r.join(", P")));
      });
      box(NX, 116, NW, 44, st.mail ? (duplicates(st) ? "bad" : "ok") : "down", "Mailpit :8025", st.mail ? st.inbox.length + t(" e-mail(s)", " e-mail(s)") + (duplicates(st) ? " · " + duplicates(st) + t(" duplicate(s)", " duplicado(s)") : "") : t("stopped: SMTP fails", "parado: o SMTP falha"));
      box(NX, 168, NW, 52, "", "notification DB", "processed_events: " + Object.keys(st.processed).length, "dead_letters: " + st.deadLetters.length);
      wire("M" + (NX + NW / 2) + ",108 L" + (NX + NW / 2) + ",116", false, false);
      /* tiles and buttons */
      tiles.set("orders", String(st.orders.length), "");
      tiles.set("pend", String(pending(st)), pending(st) ? "warn" : "ok");
      tiles.set("mail", String(st.inbox.length), "");
      tiles.set("dup", String(duplicates(st)), duplicates(st) ? "bad" : "ok");
      tiles.set("lag", String(lag(st)), lag(st) ? "warn" : "ok");
      tiles.set("dlt", String(st.deadLetters.length), st.deadLetters.length ? "warn" : "");
      B.kafka.textContent = (st.kafka ? "stop " : "start ") + "kafka";
      B.notif.textContent = (st.notif ? "stop " : "start ") + "notification";
      B.mail.textContent = (st.mail ? "stop " : "start ") + "mailpit";
    }

    function drawDrain() {
      var r = res, max = Math.max.apply(null, [1].concat(r.parts));
      box(6, 8, 172, 44, r.mode === "sync" ? "warn" : "on", "k6 · orders-load.js", r.rate + t(" orders/s for ", " pedidos/s por ") + r.duration + " s", "NOTIFY_MODE=" + r.mode);
      box(6, 60, 172, 52, r.failed ? "bad" : "ok", t("orders accepted", "pedidos aceitos"), num(r.accepted) + " / " + num(r.total), r.failed ? num(r.failed) + t(" failed (", " falharam (") + num(r.failRate * 100) + " %)" : t("none failed", "nenhum falhou"));
      if (r.mode === "sync") {
        svg.appendChild(s("text", { x: TX, y: 40, class: "c-label" }, t("NOTIFY_MODE=sync: no Kafka in the path", "NOTIFY_MODE=sync: sem Kafka no caminho")));
        (PT ? ["order chama notification dentro da requisição", "e da transação: com o notification fora,", "todo pedido falha.", "", "No lab é pior: cada pedido esperando segura", "uma conexão do pool do banco, e pedidos falham", "também logo depois da queda."]
          : ["order calls notification inside the request", "and its transaction: with notification down,", "every order fails.", "", "In the lab it is worse: each waiting order holds", "a database connection of the pool, so orders", "fail for a while after the outage too."]).forEach(function (line, i) {
          svg.appendChild(s("text", { x: TX, y: 62 + i * 14, class: "c-small" }, line));
        });
      } else {
        svg.appendChild(s("rect", { x: TX - 8, y: 8, width: TW + 16, height: 176, rx: 10, class: "csim-ao-frame" }));
        svg.appendChild(s("text", { x: TX, y: 24, class: "c-label" }, TOPIC));
        svg.appendChild(s("text", { x: TX + TW, y: 24, "text-anchor": "end", class: "c-small" }, t("lag per partition at the peak (t = ", "lag por partição no pico (t = ") + r.peakAt + " s)"));
        for (var p = 0; p < LAB.partitions; p++) {
          var y = laneY(p), w = (TW - 70) * r.parts[p] / max;
          svg.appendChild(s("text", { x: TX, y: y + 13, class: "c-small" }, "P" + p));
          svg.appendChild(s("line", { x1: TX + 18, y1: y + 18, x2: TX + TW - 50, y2: y + 18, class: "csim-ao-lane" }));
          if (r.parts[p]) svg.appendChild(s("rect", { x: TX + 18, y: y + 2, width: Math.max(2, w), height: 15, rx: 2, class: "csim-ao-bar" }));
          svg.appendChild(s("text", { x: TX + TW, y: y + 13, "text-anchor": "end", class: "c-small" }, num(r.parts[p])));
          var ti = r.threads.findIndex(function (a) { return a.indexOf(p) >= 0; });
          wire("M" + (TX + TW + 8) + "," + (y + 9) + " C" + (NX - 12) + "," + (y + 9) + " " + (TX + TW + 20) + "," + (34 + ti * 13) + " " + NX + "," + (34 + ti * 13), true, false);
        }
      }
      var h = 26 + Math.min(r.threads.length, 8) * 13;
      box(NX, 8, NW, Math.max(h, 50), r.outage ? "warn" : "on", "notification", r.mode === "sync" ? t("answers POST /notifications", "responde POST /notifications") : "");
      if (r.mode !== "sync") r.threads.forEach(function (a, i) {
        svg.appendChild(s("text", { x: NX + 8, y: 38 + i * 13, class: "c-small" + (a.length ? "" : " c-warn") }, t("thread ", "thread ") + (i + 1) + (a.length ? " ← P" + a.join(", P") + " · " + r.perThread + "/s" : t(" · idle", " · ociosa"))));
      });
      if (r.outage) svg.appendChild(s("text", { x: NX + 8, y: Math.max(h, 50) + 22, class: "c-small c-warn" }, t("stopped from t = ", "parado de t = ") + LAB.outageAt + t(" s to ", " s a ") + (LAB.outageAt + LAB.outageFor) + " s"));
      /* chart */
      var ser = r.series, fails = [], cum = 0, per = r.mode === "sync" ? r.rate : 0;
      ser.forEach(function (v, i) { if (r.outage && i >= LAB.outageAt && i < LAB.outageAt + LAB.outageFor) cum += per; fails.push(cum); });
      var len = ser.length, stepN = Math.max(1, Math.ceil(len / 160));
      var pts = []; for (var i = 0; i < len; i += stepN) pts.push(i); if (pts[pts.length - 1] !== len - 1) pts.push(len - 1);
      var chart = newChart(pts.length + 1);
      chart.push([0, 0]);
      for (var k = 0; k < pts.length; k++) chart.push([ser[pts[k]], fails[pts[k]]]);
      C.clear(chartBox).appendChild(chart);
      axis.textContent = t("x axis: 0 to ", "eixo x: 0 a ") + len + " s" + t(" (the load stops at ", " (a carga para em ") + r.duration + " s)";
      dtiles.set("fail", num(r.failed) + (r.failed ? " (" + num(r.failRate * 100) + " %)" : ""), r.failed ? "bad" : "ok");
      dtiles.set("peak", num(r.peak), r.peak > 500 ? "warn" : "ok");
      dtiles.set("drain", r.drain === null ? "—" : num(r.drain) + " s", r.drain > 60 ? "warn" : "ok");
      dtiles.set("p95", num(r.p95, r.p95 < 10 ? 2 : 0) + " s", r.p95 > 10 ? "warn" : "ok");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("Lab 7 without Docker: outbox, relay, Kafka, the idempotent consumer, the DLT and the lag",
        "O lab 7 sem Docker: outbox, relay, Kafka, o consumidor idempotente, a DLT e o lag") }),
      el("p", { class: "csim-sub", text: t("Each cell is a record of order-events (the first characters of its key; ? is a tour message). Filled cells are committed by the group notification, dashed ones wait, red ones cannot be processed.",
        "Cada célula é um registro de order-events (os primeiros caracteres da chave; ? é uma mensagem do passeio). Células cheias foram confirmadas pelo grupo notification, tracejadas esperam, vermelhas não podem ser processadas.") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-stage" }, svg),
      rowsDiscrete[0], rowsDiscrete[1], rowsDiscrete[2], rowDrain,
      note,
      player,
      colsDiscrete, colsDrain
    ]);
    reset();
    return {};
  });
})();
