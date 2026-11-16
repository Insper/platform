/*
 * The messaging of hands-on 10 (2026.2), as a lab twin:
 *
 *   <div class="csim" data-sim="order-events" data-script="scale"></div>
 *
 * The order-service publishes OrderCreated with kafkaTemplate.send("order-events", id, json); the
 * notification-service (Spring Kafka, the consumer-service of the reference with its own group) reads the
 * topic with @KafkaListener in the group notification-group; the container commits after the listener
 * returns (AckMode.BATCH, enable.auto.commit=false). The topic is created on first use with the lab's
 * KAFKA_NUM_PARTITIONS: 1.
 *
 * The model is Kafka's: a keyed record goes to partition toPositive(murmur2(key)) % partitions (the
 * Java client's partitioner, murmur2 checked against Kafka's own test vectors); a partition is read by
 * one member of the group at a time, assigned by the range assignor (the Java client's first strategy;
 * Kafka sorts members by member id, the simulator by name); a member that leaves or joins triggers a
 * rebalance, and the new owner resumes at the committed offset, so a message processed but not
 * committed is processed again (at-least-once). Each poll, every live consumer processes one message.
 * A record the listener cannot process meets Spring Kafka's DefaultErrorHandler: 10 attempts, an ERROR
 * line, and the offset is committed past it (lost); with the DeadLetterPublishingRecoverer of section
 * 8.3, 3 attempts 1 s apart and the record goes to order-events-dlt.
 * Every button is a command of the lab and prints what the lab prints. A script (data-script) replays
 * a page step by step: test, scale or failures; "free" leaves only the buttons.
 */
(function () {
  "use strict";

  var TOPIC = "order-events", DLQ = "order-events-dlt", GROUP = "notification-group", SERVICE = "notification";
  var DEFAULT_PARTITIONS = 1;     /* KAFKA_NUM_PARTITIONS of the lab's compose: what auto-create gives */
  var ATTEMPTS = 10, DLT_ATTEMPTS = 3;   /* DefaultErrorHandler: FixedBackOff(0, 9); section 8.3: FixedBackOff(1000, 2) */
  var MAX_CONSUMERS = 4;
  var ORDERS = [
    ["ord-7f3a", "acc-42", 49.98], ["ord-2b91", "acc-17", 120.0], ["ord-c40e", "acc-08", 15.5], ["ord-91d7", "acc-23", 89.9],
    ["ord-5e62", "acc-42", 34.0], ["ord-a03f", "acc-31", 210.4], ["ord-6c18", "acc-05", 12.99], ["ord-e7b4", "acc-17", 64.5],
    ["ord-38fd", "acc-12", 99.0], ["ord-b526", "acc-08", 23.75], ["ord-0d4c", "acc-44", 150.0], ["ord-f1e9", "acc-23", 8.4]
  ];

  /* org.apache.kafka.common.utils.Utils.murmur2, on the UTF-8 bytes of the key */
  function utf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  function murmur2(str) {
    var data = utf8(str), length = data.length, m = 0x5bd1e995, r = 24;
    var h = (0x9747b28c ^ length) | 0, l4 = length >> 2, i, k;
    for (i = 0; i < l4; i++) {
      var i4 = i * 4;
      k = data[i4] + (data[i4 + 1] << 8) + (data[i4 + 2] << 16) + (data[i4 + 3] << 24);
      k = Math.imul(k, m); k ^= k >>> r; k = Math.imul(k, m);
      h = Math.imul(h, m); h ^= k;
    }
    var idx = l4 * 4, rest = length - idx;
    if (rest === 3) h ^= data[idx + 2] << 16;
    if (rest >= 2) h ^= data[idx + 1] << 8;
    if (rest >= 1) { h ^= data[idx]; h = Math.imul(h, m); }
    h ^= h >>> 13; h = Math.imul(h, m); h ^= h >>> 15;
    return h | 0;
  }
  function partitionFor(key, n) { return (murmur2(key) & 0x7fffffff) % n; }

  function consumerName(i) { return SERVICE + "-" + i; }
  function create(o) {
    o = o || {};
    var n = o.partitions || DEFAULT_PARTITIONS, st = { parts: n, logs: [], committed: [], cons: [], sent: {}, emails: 0, dups: 0, dlq: [], lost: [],
      idem: false, dlqOn: false, seq: 0, last: [] };
    for (var p = 0; p < n; p++) { st.logs.push([]); st.committed.push(0); }
    for (var i = 1; i <= (o.consumers || 1); i++) st.cons.push({ name: consumerName(i), up: true, member: true, parts: [], rr: 0 });
    rebalance(st);
    return st;
  }
  function con(st, name) { return st.cons.filter(function (c) { return c.name === name; })[0]; }
  function members(st) { return st.cons.filter(function (c) { return c.member; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; }); }
  function lagOf(st, p) { return st.logs[p].length - st.committed[p]; }
  function lag(st) { var s = 0; for (var p = 0; p < st.parts; p++) s += lagOf(st, p); return s; }
  function owner(st, p) { return members(st).filter(function (c) { return c.parts.indexOf(p) >= 0; })[0] || null; }

  /* the range assignor: each member gets a run of partitions, the first ones get one more */
  function rebalance(st) {
    var ms = members(st), n = ms.length, each = n ? Math.floor(st.parts / n) : 0, extra = n ? st.parts % n : 0, p = 0;
    st.cons.forEach(function (c) { c.parts = []; c.rr = 0; });
    ms.forEach(function (c, i) { var k = each + (i < extra ? 1 : 0); for (var j = 0; j < k; j++) c.parts.push(p++); });
    return ms.map(function (c) { return c.name + " ← " + (c.parts.length ? c.parts.join(", ") : "(none)"); });
  }
  function assignment(st) { return members(st).map(function (c) { return c.name + " ← " + (c.parts.length ? c.parts.join(", ") : "(none)"); }); }

  function order(st) {
    var i = st.seq++, d = ORDERS[i % ORDERS.length];
    var id = i < ORDERS.length ? d[0] : "ord-" + (((i + 1) * 2654435761) >>> 0).toString(16).slice(-4);
    var p = partitionFor(id, st.parts), msg = { id: id, account: d[1], total: d[2], part: p, offset: st.logs[p].length };
    st.logs[p].push(msg);
    return msg;
  }
  /* a Double as String.valueOf prints it: 120.0, 49.98 */
  function amount(x) { return x % 1 === 0 ? x.toFixed(1) : String(x); }
  function json(m) { return "{\"id\":\"" + m.id + "\",\"idAccount\":\"" + m.account + "\",\"total\":\"" + amount(m.total) + "\"}"; }
  function body(m) { return "{\"id\":\"" + m.id + "\",\"date\":\"…\",\"items\":[…],\"total\":" + amount(m.total) + "}"; }
  function sent(m) { return "send(\"" + TOPIC + "\", \"" + m.id + "\", json) → partition " + m.part + ", offset " + m.offset; }

  /* POST /orders: the order-service saves, publishes and answers at once */
  function post(st) {
    var m = order(st);
    var cmd = "$ curl -b cookies.txt -X POST http://localhost:8080/orders -H \"Content-Type: application/json\" -d '{\"items\":[…]}'";
    return { cmd: cmd, msg: m, out: [body(m), "  " + sent(m)], tone: "ok",
      note: ["Key " + m.id + " → partition " + m.part + " of " + st.parts + ". The order-service answered 201 without waiting for any consumer.",
             "Chave " + m.id + " → partição " + m.part + " de " + st.parts + ". O order-service respondeu 201 sem esperar consumidor algum."] };
  }
  /* section 8.2: a line that is not JSON, straight from the console producer (no key: the sticky partitioner, here partition 0) */
  function garbage(st) {
    var m = { id: "oops", bad: true, part: 0, offset: st.logs[0].length };
    st.logs[0].push(m);
    return { cmd: "$ echo 'oops' | docker compose exec -T kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server kafka:9092 --topic " + TOPIC,
      msg: m, out: ["  oops → partition 0, offset " + m.offset + " (no key)"], tone: "warn",
      note: ["Not JSON: readValue will throw on every attempt.", "Não é JSON: readValue vai lançar exceção em toda tentativa."] };
  }
  function burst(st, n) {
    var ms = []; for (var i = 0; i < n; i++) ms.push(order(st));
    var per = []; for (var p = 0; p < st.parts; p++) per.push(ms.filter(function (m) { return m.part === p; }).length);
    return { cmd: "$ for i in $(seq " + n + "); do curl -s -X POST http://localhost:8080/orders …; done", msgs: ms, per: per, tone: "ok",
      out: ms.map(function (m) { return m.id + " → partition " + m.part + ", offset " + m.offset; }),
      note: ["By key: " + per.map(function (k, p) { return k + " in partition " + p; }).join(", ") + ". Lag now " + lag(st) + ".",
        "Pela chave: " + per.map(function (k, p) { return k + " na partição " + p; }).join(", ") + ". Atraso agora " + lag(st) + "."] };
  }

  /* the next message a consumer reads: rotate over its partitions, from the committed offset */
  function next(st, c) {
    for (var j = 0; j < c.parts.length; j++) {
      var p = c.parts[(c.rr + j) % c.parts.length];
      if (st.committed[p] < st.logs[p].length) { c.rr = (c.rr + j + 1) % c.parts.length; return st.logs[p][st.committed[p]]; }
    }
    return null;
  }
  function logLine(c, m) {
    return c.name + "  | … INFO … NotificationService : sending confirmation email: order " + m.id + " (account " + m.account + ", total " + amount(m.total) + ")";
  }
  /* one record through the listener container; commit = false when the instance dies before the container commits */
  function process(st, c, m, commit) {
    var r = { consumer: c.name, msg: m, lines: [] };
    if (m.bad) {
      if (st.dlqOn) {
        for (var a = 1; a < DLT_ATTEMPTS; a++) r.lines.push(c.name + "  | … INFO … KafkaMessageListenerContainer : Record in retry and not yet recovered");
        r.lines.push(c.name + "  | (attempt " + DLT_ATTEMPTS + " fails: DeadLetterPublishingRecoverer → " + DLQ + ")");
        st.dlq.push(m.id); r.dlq = true;
      } else {
        r.lines.push(c.name + "  | … ERROR … DefaultErrorHandler : Backoff FixedBackOffExecution[interval=0, currentAttempts=" + ATTEMPTS + ", maxAttempts=" + (ATTEMPTS - 1) + "] exhausted for " + TOPIC + "-" + m.part + "@" + m.offset,
          c.name + "  | Caused by: tools.jackson.core.exc.StreamReadException: Unrecognized token 'oops'");
        st.lost.push(m.id); r.lost = true;
      }
    } else if (st.idem && st.sent[m.id]) {
      r.lines.push(c.name + "  | … INFO … NotificationService : " + m.id + " already notified — skipping"); r.skipped = true;
    } else {
      r.lines.push(logLine(c, m));
      st.sent[m.id] = (st.sent[m.id] || 0) + 1; st.emails++;
      if (st.sent[m.id] > 1) { st.dups++; r.dup = true; }
    }
    if (commit !== false) st.committed[m.part] = m.offset + 1;
    return r;
  }

  function poll(st) {
    var out = [], res = [], lost = false, dup = false, dlq = false, skipped = false;
    members(st).forEach(function (c) {
      if (!c.up) return;
      if (!c.parts.length) { out.push(c.name + "  | (idle: no partition assigned)"); res.push({ consumer: c.name, idle: true }); return; }
      var m = next(st, c);
      if (!m) { out.push(c.name + "  | (nothing new)"); res.push({ consumer: c.name, empty: true }); return; }
      var r = process(st, c, m);
      out = out.concat(r.lines); res.push(r);
      lost = lost || r.lost; dup = dup || r.dup; dlq = dlq || r.dlq; skipped = skipped || r.skipped;
    });
    st.last = res.filter(function (r) { return r.msg; }).map(function (r) { return r.consumer; });
    var idle = res.filter(function (r) { return r.idle; }).map(function (r) { return r.consumer; });
    var res2 = { cmd: "$ docker compose logs -f " + SERVICE, out: out.length ? out : ["(no consumer is running)"], results: res, idle: idle,
      tone: lost ? "bad" : dup ? "warn" : "ok" };
    res2.note = lost ? [ATTEMPTS + " attempts, one ERROR line, and the container committed past the record: the stream goes on, but the message is lost.",
      ATTEMPTS + " tentativas, uma linha de ERROR e o container confirmou o offset depois do registro: o fluxo segue, mas a mensagem se perdeu."]
      : dup ? ["A second email for the same order: the offset was not committed, so the message came again (at-least-once).",
        "Um segundo e-mail para o mesmo pedido: o offset não foi confirmado, então a mensagem veio de novo (at-least-once)."]
      : skipped ? ["Redelivered, but the consumer had already notified this orderId: no second email, and the offset is committed.",
        "Entregue de novo, mas o consumidor já tinha notificado esse orderId: nenhum segundo e-mail e o offset é confirmado."]
      : dlq ? [DLT_ATTEMPTS + " attempts, 1 s apart, then the record went to " + DLQ + " and the offset was committed: the stream moves on and nothing is lost.",
        DLT_ATTEMPTS + " tentativas, a 1 s uma da outra, e o registro foi para " + DLQ + " com o offset confirmado: o fluxo segue e nada se perde."]
      : idle.length ? [idle.join(", ") + " is in the group but has no partition: with " + st.parts + " partition(s), at most " + st.parts + " consumer(s) work. Lag " + lag(st) + ".",
        idle.join(", ") + " está no grupo mas não tem partição: com " + st.parts + " partição(ões), no máximo " + st.parts + " consumidor(es) trabalha(m). Atraso " + lag(st) + "."]
      : ["Each consumer processed one message and committed it. Lag " + lag(st) + ".", "Cada consumidor processou uma mensagem e a confirmou. Atraso " + lag(st) + "."];
    return res2;
  }

  function rebalanceNote(st, lines) {
    return lines.length ? "rebalance: " + lines.join(" · ") : "rebalance: (no member left in " + GROUP + ")";
  }

  function kill(st, name) {
    var c = con(st, name), cmd = "$ docker compose kill " + name;
    if (!c || !c.up) return { cmd: cmd, out: ["no such service: " + name], tone: "bad", note: [name + " is not running.", name + " não está rodando."] };
    var m = c.member ? next(st, c) : null, r = m ? process(st, c, m, false) : null;
    c.up = false; c.member = false;
    var lines = rebalance(st);
    st.last = [];
    var out = (r ? r.lines.concat(["  (killed before the container committed the offset)"]) : []).concat([name + " exited with code 137", rebalanceNote(st, lines)]);
    return { cmd: cmd, out: out, tone: "bad", lost: m, note: m
      ? ["The email for " + m.id + " went out, but offset " + m.offset + " of partition " + m.part + " was not committed: whoever reads that partition next (after session.timeout.ms, 45 s, or the restart) starts there again.",
         "O e-mail de " + m.id + " saiu, mas o offset " + m.offset + " da partição " + m.part + " não foi confirmado: quem ler essa partição depois (passado o session.timeout.ms, 45 s, ou no reinício) recomeça dali."]
      : [name + " is gone; after session.timeout.ms (45 s) the group rebalances.", name + " se foi; depois de session.timeout.ms (45 s) o grupo rebalanceia."] };
  }
  function stop(st, name) {
    var c = con(st, name), cmd = "$ docker compose stop " + name;
    if (!c || !c.up) return { cmd: cmd, out: ["no such service: " + name], tone: "bad", note: [name + " is not running.", name + " não está rodando."] };
    c.up = false; c.member = false;
    var lines = rebalance(st);
    return { cmd: cmd, out: [" ✔ Container " + name + "  Stopped", rebalanceNote(st, lines)], tone: "warn", assign: lines,
      note: ["A clean stop: Spring closes the consumer, which leaves " + GROUP + " at once; the group rebalances and its partitions move on, from the committed offsets.",
        "Uma parada limpa: o Spring fecha o consumidor, que sai do " + GROUP + " na hora; o grupo rebalanceia e as partições dele mudam de dono, a partir dos offsets confirmados."] };
  }
  function start(st, name) {
    var c = con(st, name), cmd = "$ docker compose start " + name;
    if (!c) { c = { name: name, parts: [], rr: 0 }; st.cons.push(c); }
    c.up = true; c.member = true;
    var lines = rebalance(st);
    return { cmd: cmd, out: [" ✔ Container " + name + "  Started", rebalanceNote(st, lines)], tone: "info", assign: lines,
      note: [name + " joins " + GROUP + ": the group rebalances. " + lines.join(" · "), name + " entra em " + GROUP + ": o grupo rebalanceia. " + lines.join(" · ")] };
  }
  function scale(st, n) {
    n = Math.max(0, Math.min(MAX_CONSUMERS, n));
    for (var i = 1; i <= MAX_CONSUMERS; i++) {
      var c = con(st, consumerName(i));
      if (i <= n) { if (!c) { c = { name: consumerName(i), parts: [], rr: 0 }; st.cons.push(c); } if (!c.up) { c.up = true; c.member = true; } }
      else if (c) { c.up = false; c.member = false; }
    }
    st.cons = st.cons.filter(function (c) { return c.up || +c.name.split("-").pop() <= n; });
    var lines = rebalance(st), idle = members(st).filter(function (c) { return !c.parts.length; }).map(function (c) { return c.name; });
    return { cmd: "$ docker compose up -d --scale " + SERVICE + "=" + n, out: [rebalanceNote(st, lines)], tone: idle.length ? "warn" : "ok", assign: lines, idle: idle,
      note: idle.length ? [n + " consumers, " + st.parts + " partition(s): " + idle.join(", ") + " get(s) nothing. A partition is read by one member of the group at a time.",
        n + " consumidores, " + st.parts + " partição(ões): " + idle.join(", ") + " não recebe(m) nada. Uma partição é lida por um membro do grupo por vez."]
        : [n + " consumer(s) share " + st.parts + " partition(s): " + lines.join(" · "), n + " consumidor(es) dividem " + st.parts + " partição(ões): " + lines.join(" · ")] };
  }
  function alter(st, n) {
    var cmd = "$ docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --alter --topic " + TOPIC + " --partitions " + n;
    if (n <= st.parts) return { cmd: cmd, tone: "bad", out: ["Error while executing topic command : Topic currently has " + st.parts + " partitions, which is higher than the requested " + n + "."],
      note: ["Kafka can add partitions, never remove them: the key → partition mapping of the existing messages would break.", "O Kafka acrescenta partições, nunca remove: o mapeamento chave → partição das mensagens existentes quebraria."] };
    while (st.parts < n) { st.logs.push([]); st.committed.push(0); st.parts++; }
    var lines = rebalance(st);
    return { cmd: cmd, out: [rebalanceNote(st, lines)], tone: "ok", assign: lines,
      note: [n + " partitions: the old messages stay where they are, new keys spread over all " + n + ". Once the clients refresh their metadata, the group rebalances: " + lines.join(" · "),
        n + " partições: as mensagens antigas ficam onde estão, as chaves novas se espalham pelas " + n + ". Quando os clientes atualizam os metadados, o grupo rebalanceia: " + lines.join(" · ")] };
  }
  /* rebuild the notification-service with other code: every instance restarts */
  function deploy(st, what, on) {
    st[what] = on;
    st.cons.forEach(function (c) { if (c.up) c.member = true; });
    var lines = rebalance(st);
    var en = what === "dlqOn" ? (on ? "the KafkaConsumerConfig of 8.3 (DefaultErrorHandler + DeadLetterPublishingRecoverer → " + DLQ + ")" : "the KafkaConsumerConfig of 6.2 (the default error handler: " + ATTEMPTS + " attempts, then log and skip)") : (on ? "an idempotent consumer (skips an order id already notified)" : "the consumer without the idempotency check");
    var pt = what === "dlqOn" ? (on ? "o KafkaConsumerConfig de 8.3 (DefaultErrorHandler + DeadLetterPublishingRecoverer → " + DLQ + ")" : "o KafkaConsumerConfig de 6.2 (o error handler padrão: " + ATTEMPTS + " tentativas, depois registra e pula)") : (on ? "um consumidor idempotente (pula um id de pedido já notificado)" : "o consumidor sem a checagem de idempotência");
    return { cmd: "$ docker compose up -d --build " + SERVICE, out: [rebalanceNote(st, lines)], tone: "info", note: ["Deployed " + en + ".", "Implantado " + pt + "."] };
  }
  function describe(st) {
    var ms = members(st).filter(function (c) { return c.up; });
    var rows = [];
    for (var p = 0; p < st.parts; p++) { var o = owner(st, p); rows.push({ part: p, current: st.committed[p], end: st.logs[p].length, lag: lagOf(st, p), consumer: o ? o.name : "-" }); }
    var pad = function (x, n) { x = String(x); while (x.length < n) x += " "; return x; };
    var out = (ms.length ? [] : ["Consumer group '" + GROUP + "' has no active members."]).concat(
      ["TOPIC " + TOPIC + " (columns shortened)", pad("PARTITION", 10) + pad("CURRENT", 8) + pad("LOG-END", 8) + pad("LAG", 4) + "CONSUMER"],
      rows.map(function (r) { return pad(r.part, 10) + pad(r.current, 8) + pad(r.end, 8) + pad(r.lag, 4) + r.consumer; }));
    var total = lag(st);
    return { cmd: "$ docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group " + GROUP,
      rows: rows, lag: total, out: out, tone: total ? "warn" : "info",
      note: ["Lag = log-end offset − committed offset, per partition: " + total + " message(s) waiting in total.",
        "Atraso = offset final do log − offset confirmado, por partição: " + total + " mensagem(ns) esperando no total."] };
  }
  function messages(st) {
    var all = [];
    st.logs.forEach(function (l) { all = all.concat(l); });
    var out = all.slice(-6).map(function (m) {
      return "Partition:" + m.part + "\tOffset:" + m.offset + "\t" + (m.bad ? "null\toops" : m.id + "\t" + json(m));
    });
    return { cmd: "$ docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic " + TOPIC + " --from-beginning --formatter-property print.partition=true --formatter-property print.offset=true --formatter-property print.key=true",
      out: out.length ? out : ["(no messages)"], tone: "info", count: all.length,
      note: ["The messages stay in the topic after they are read: a consumer only moves its offset.", "As mensagens ficam no tópico depois de lidas: um consumidor só move o seu offset."] };
  }

  var S1 = consumerName(1), S2 = consumerName(2);
  var SCRIPTS = {
    test: [
      { ops: [["post"]], en: "6.3 Create an order: the order-service publishes OrderCreated with the key ord-7f3a and answers at once.", pt: "6.3 Crie um pedido: o order-service publica OrderCreated com a chave ord-7f3a e responde na hora." },
      { ops: [["messages"]], en: "The console consumer: the event is in order-events, partition 0, offset 0.", pt: "O console consumer: o evento está em order-events, partição 0, offset 0." },
      { ops: [["poll"]], en: "The notification-service logs the email; the container commits the offset.", pt: "O notification-service registra o e-mail; o container confirma o offset." },
      { ops: [["describe"]], en: "Lag 0: the group has read everything.", pt: "Atraso 0: o grupo leu tudo." }
    ],
    scale: [
      { ops: [["burst", 6]], en: "Six orders at once. The auto-created topic has 1 partition: all six land in it.", pt: "Seis pedidos de uma vez. O tópico criado automaticamente tem 1 partição: os seis caem nela." },
      { ops: [["scale", 2]], en: "Two instances of the notification-service: the group rebalances, but one partition goes to one member only.", pt: "Duas instâncias do notification-service: o grupo rebalanceia, mas uma partição vai para um membro só." },
      { ops: [["poll"], ["poll"], ["describe"]], en: "Two polls, two messages: notification-2 is idle.", pt: "Dois polls, duas mensagens: notification-2 fica ocioso." },
      { ops: [["alter", 3]], en: "Three partitions: the group rebalances again.", pt: "Três partições: o grupo rebalanceia de novo." },
      { ops: [["burst", 6]], en: "Six more orders, spread by key.", pt: "Mais seis pedidos, espalhados pela chave." },
      { ops: [["poll"], ["poll"], ["describe"]], en: "Now both instances work.", pt: "Agora as duas instâncias trabalham." },
      { ops: [["stop", S2]], en: "Stop one instance: its partition moves to the other.", pt: "Pare uma instância: a partição dela passa para a outra." },
      { ops: [["poll"], ["poll"], ["poll"], ["describe"]], en: "One instance for three partitions: the lag drains, one message per poll.", pt: "Uma instância para três partições: o atraso diminui, uma mensagem por poll." }
    ],
    failures: [
      { ops: [["post"]], en: "One order.", pt: "Um pedido." },
      { ops: [["kill", S1]], en: "The consumer sends the email and is killed before the container commits.", pt: "O consumidor envia o e-mail e é morto antes de o container confirmar." },
      { ops: [["start", S1], ["poll"]], en: "Back up, it resumes at the committed offset: the same email again.", pt: "De volta, ele recomeça no offset confirmado: o mesmo e-mail de novo." },
      { ops: [["deploy", "idem", true]], en: "Make the consumer idempotent: it records, durably, the order ids it notified.", pt: "Torne o consumidor idempotente: ele registra, de forma durável, os ids de pedido que notificou." },
      { ops: [["post"], ["kill", S1], ["start", S1], ["poll"]], en: "Same crash: this time the repeat is skipped.", pt: "A mesma queda: desta vez a repetição é pulada." },
      { ops: [["garbage"], ["poll"]], en: "8.2 A message that is not JSON, with the default error handler: 10 attempts, an ERROR line, skipped.", pt: "8.2 Uma mensagem que não é JSON, com o error handler padrão: 10 tentativas, uma linha de ERROR e ela é pulada." },
      { ops: [["post"], ["post"], ["poll"], ["poll"], ["describe"]], en: "The next orders flow and the lag is 0: nothing shows the lost message but one log line.", pt: "Os próximos pedidos passam e o atraso é 0: nada mostra a mensagem perdida, só uma linha de log." },
      { ops: [["deploy", "dlqOn", true], ["garbage"], ["poll"], ["describe"]], en: "8.3 With the dead-letter topic: 3 attempts, then order-events-dlt. The stream moves on and nothing is lost.", pt: "8.3 Com o dead-letter topic: 3 tentativas e depois order-events-dlt. O fluxo segue e nada se perde." }
    ]
  };
  var OPS = { post: post, garbage: garbage, burst: burst, poll: poll, kill: kill, stop: stop, start: start, scale: scale, alter: alter, deploy: deploy, describe: describe, messages: messages };
  function run(st, op) { return OPS[op[0]].apply(null, [st].concat(op.slice(1))); }
  function play(name, n) {
    var st = create(), out = [];
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (step) { step.ops.forEach(function (op) { out.push(run(st, op)); }); });
    return { st: st, out: out };
  }

  var API = { TOPIC: TOPIC, DLQ: DLQ, GROUP: GROUP, SERVICE: SERVICE, DEFAULT_PARTITIONS: DEFAULT_PARTITIONS, ATTEMPTS: ATTEMPTS, DLT_ATTEMPTS: DLT_ATTEMPTS, ORDERS: ORDERS, SCRIPTS: SCRIPTS,
    murmur2: murmur2, partitionFor: partitionFor, create: create, members: members, lag: lag, run: run, play: play,
    post: post, garbage: garbage, burst: burst, poll: poll, kill: kill, stop: stop, start: start, scale: scale, alter: alter, deploy: deploy, describe: describe, messages: messages };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  function L(pair) { return pair ? (PT ? pair[1] : pair[0]) : ""; }

  C.style("order-events", [
    ".md-typeset .csim-log.csim-oe-term li { font-family: var(--md-code-font-family, monospace); font-size: .6rem; white-space: pre-wrap; }",
    ".md-typeset .csim-log.csim-oe-term li b { font-weight: 600; }",
    ".md-typeset .csim-oe-msg { stroke-width: 1; }",
    ".md-typeset .csim-oe-msg.done { fill: var(--c-tint2); stroke: var(--c-ink); }",
    ".md-typeset .csim-oe-msg.wait { fill: var(--c-bg); stroke: var(--c-warn); stroke-dasharray: 3 2; }",
    ".md-typeset .csim-oe-msg.bad { fill: color-mix(in srgb, var(--c-bad) 18%, var(--c-bg)); stroke: var(--c-bad); }",
    ".md-typeset .csim-oe-lane { fill: none; stroke: var(--c-line); }",
    ".md-typeset .csim-oe-frame { fill: none; stroke: var(--c-line); stroke-dasharray: 5 4; }",
    ".md-typeset .csim .csim-oe-con { cursor: pointer; }",
    ".md-typeset .csim .csim-oe-con.sel > rect:first-child { stroke-width: 3; }",
    ".md-typeset .csim-oe-acts .csim-btn[disabled] { opacity: .4; cursor: default; }"
  ].join("\n"));

  C.register("order-events", function (root) {
    var o = C.opts(root, { script: "test" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st, sel = S1;

    var svg = s("svg", { viewBox: "0 0 640 262", role: "img", "aria-label": t("The order-events topic and the notification-group", "O tópico order-events e o notification-group") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(7); term.className += " csim-oe-term";
    var tiles = C.stats([
      { key: "pub", label: t("orders published", "pedidos publicados") },
      { key: "mail", label: t("emails sent", "e-mails enviados") },
      { key: "dup", label: t("duplicate emails", "e-mails duplicados") },
      { key: "lag", label: t("group lag", "atraso do grupo") },
      { key: "lost", label: t("messages lost", "mensagens perdidas") },
      { key: "dlq", label: DLQ }
    ]);
    function say(pair, tone) { note.textContent = L(pair); note.className = "csim-note" + (tone && tone !== "info" ? " csim-" + tone : ""); }
    function show(r) { term.add(el("span", {}, [el("b", { text: r.cmd }), r.out.length ? "\n" + r.out.join("\n") : ""]), r.tone === "info" ? "" : r.tone); }

    var cScript = C.choice({ label: t("Lab page", "Página do lab"), value: script, options: [
      { value: "test", label: t("6.3 · Create an order", "6.3 · Criar um pedido") },
      { value: "scale", label: t("7 · Partitions and groups", "7 · Partições e grupos") },
      { value: "failures", label: t("8 · Failures", "8 · Falhas") },
      { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; reset(); } });

    function act(fn) { return function () { player.pause(); var r = fn(); if (r) { show(r); say(r.note, r.tone); } draw(); }; }
    var B = {
      post: C.button("POST /orders", act(function () { st.last = []; return post(st); }), { tone: "ok" }),
      burst: C.button("POST ×6", act(function () { st.last = []; return burst(st, 6); })),
      bad: C.button(t("console producer: oops", "console producer: oops"), act(function () { st.last = []; return garbage(st); }), { tone: "bad" }),
      poll: C.button("poll", act(function () { return poll(st); }), { tone: "ok" }),
      desc: C.button("kafka-consumer-groups --describe", act(function () { return describe(st); })),
      msgs: C.button("kafka-console-consumer", act(function () { return messages(st); })),
      stop: C.button("stop", act(function () { return stop(st, sel); })),
      kill: C.button(t("kill (before commit)", "kill (antes do commit)"), act(function () { return kill(st, sel); }), { tone: "bad" }),
      start: C.button("start", act(function () { return start(st, sel); }))
    };
    var cScale = C.choice({ label: "--scale " + SERVICE, value: "1", options: [1, 2, 3, 4].map(function (n) { return { value: String(n), label: String(n) }; }),
      onChange: function (v) { act(function () { return scale(st, +v); })(); } });
    var cParts = C.choice({ label: "--partitions", value: "1", options: [1, 2, 3, 4].map(function (n) { return { value: String(n), label: String(n) }; }),
      onChange: function (v) { act(function () { var r = alter(st, +v); cParts.set(String(st.parts)); return r; })(); } });
    var tIdem = C.toggle({ label: t("idempotent consumer", "consumidor idempotente"), onChange: function (v) { act(function () { return deploy(st, "idem", v); })(); } });
    var tDlq = C.toggle({ label: t("dead-letter topic (8.3)", "dead-letter topic (8.3)"), onChange: function (v) { act(function () { return deploy(st, "dlqOn", v); })(); } });

    var player = C.player({
      interval: 1700,
      onTick: function (k) { return step(k); },
      onPrev: function (k) { replay(k); },
      onReset: function () { reset(); }
    });

    function sync() {
      cScale.set(String(st.cons.filter(function (c) { return c.up; }).length || 0));
      cParts.set(String(st.parts)); tIdem.set(st.idem); tDlq.set(st.dlqOn);
    }
    function step(k) {
      var sc = SCRIPTS[script];
      if (!sc || k > sc.length) return false;
      var tone = "";
      sc[k - 1].ops.forEach(function (op) { if (op[0] !== "poll") st.last = []; var r = run(st, op); show(r); if (r.tone === "bad" || r.tone === "warn") tone = r.tone; });
      say([sc[k - 1].en, sc[k - 1].pt], tone);
      sync(); draw();
    }
    function replay(k) {
      st = create(); term.clear();
      for (var i = 1; i <= k; i++) step(i);
      if (!k) intro();
      sync(); draw();
    }
    function intro() {
      say(script === "free"
        ? ["Publish orders, poll, scale the consumer, add partitions, kill an instance before it commits. Click an instance to select it.",
           "Publique pedidos, chame poll, escale o consumidor, acrescente partições, mate uma instância antes do commit. Clique numa instância para selecioná-la."]
        : ["The store's part of the lab: order-events with 1 partition, one notification-service in notification-group. Press play or → to run the page's steps; the buttons work at any time.",
           "A parte da loja no lab: order-events com 1 partição, um notification-service no notification-group. Aperte play ou → para rodar os passos da página; os botões funcionam a qualquer momento."], "");
    }
    function reset() {
      st = create(); term.clear(); sel = S1;
      player.total(SCRIPTS[script] ? SCRIPTS[script].length : 0);
      player.style.display = SCRIPTS[script] ? "" : "none";
      intro(); sync(); draw();
    }

    var TX = 132, TW = 290, CX = 456, CW = 178, CELL = 31;
    function laneY(p) { var h = Math.min(56, 176 / st.parts); return 34 + p * h + h / 2; }
    function conY(i) { return 14 + i * 52; }

    function draw() {
      C.clear(svg);
      var lastMsg = null;
      /* producer */
      svg.appendChild(s("rect", { x: 6, y: 92, width: 104, height: 52, rx: 7, class: "c-box on" }));
      svg.appendChild(s("text", { x: 58, y: 113, "text-anchor": "middle", class: "c-label" }, "order-service"));
      svg.appendChild(s("text", { x: 58, y: 130, "text-anchor": "middle", class: "c-small" }, t("key = orderId", "chave = orderId")));
      /* topic */
      svg.appendChild(s("rect", { x: TX - 8, y: 8, width: TW + 16, height: 208, rx: 10, class: "csim-oe-frame" }));
      svg.appendChild(s("text", { x: TX, y: 24, class: "c-label" }, TOPIC));
      svg.appendChild(s("text", { x: TX + TW, y: 24, "text-anchor": "end", class: "c-small" }, st.parts + t(" partition(s)", " partição(ões)")));
      for (var p = 0; p < st.parts; p++) {
        var y = laneY(p), log = st.logs[p], shown = log.slice(-8);
        svg.appendChild(s("path", { d: "M110,118 C" + (TX - 10) + ",118 " + (TX - 30) + "," + y + " " + TX + "," + y, class: "c-wire" }));
        svg.appendChild(s("line", { x1: TX, y1: y + 12, x2: TX + TW, y2: y + 12, class: "csim-oe-lane" }));
        svg.appendChild(s("text", { x: TX, y: y - 14, class: "c-small" }, "P" + p + t(" · lag ", " · atraso ") + lagOf(st, p)));
        shown.forEach(function (m, j) {
          var x = TX + j * CELL, done = m.offset < st.committed[m.part];
          svg.appendChild(s("rect", { x: x, y: y - 10, width: CELL - 3, height: 20, rx: 3, class: "csim-oe-msg " + (m.bad ? "bad" : done ? "done" : "wait") }));
          svg.appendChild(s("text", { x: x + (CELL - 3) / 2, y: y + 3.5, "text-anchor": "middle", class: "c-small c-mono" }, m.bad ? "oops" : m.id.slice(4)));
        });
        if (log.length > 8) svg.appendChild(s("text", { x: TX + TW, y: y - 14, "text-anchor": "end", class: "c-small" }, "+" + (log.length - 8)));
        var ow = owner(st, p);
        if (ow) {
          var i = st.cons.indexOf(ow), cy = conY(i) + 21, on = st.last.indexOf(ow.name) >= 0;
          svg.appendChild(s("path", { d: "M" + (TX + TW) + "," + y + " C" + (TX + TW + 22) + "," + y + " " + (CX - 22) + "," + cy + " " + CX + "," + cy, class: "c-wire" + (on ? " on" : "") }));
        }
      }
      /* DLQ */
      svg.appendChild(s("rect", { x: TX - 8, y: 224, width: TW + 16, height: 32, rx: 7, class: "c-box " + (st.dlq.length ? "warn" : st.dlqOn ? "on" : "down") }));
      svg.appendChild(s("text", { x: TX, y: 244, class: "c-label" }, DLQ));
      svg.appendChild(s("text", { x: TX + TW, y: 244, "text-anchor": "end", class: "c-small c-mono" }, st.dlq.length ? st.dlq.join(", ") : st.dlqOn ? t("(empty)", "(vazio)") : t("(no recoverer: the default error handler)", "(sem recoverer: o error handler padrão)")));
      /* consumers */
      svg.appendChild(s("text", { x: CX, y: 8, class: "c-small" }, t("group ", "grupo ") + GROUP));
      st.cons.forEach(function (c, i) {
        var y = conY(i), cls = !c.up ? "down" : !c.parts.length ? "warn" : st.last.indexOf(c.name) >= 0 ? "hot" : "on";
        var g = s("g", { class: "csim-oe-con" + (c.name === sel ? " sel" : ""), onclick: function () { sel = c.name; draw(); } });
        g.appendChild(s("rect", { x: CX, y: y, width: CW, height: 42, rx: 7, class: "c-box " + cls }));
        g.appendChild(s("text", { x: CX + 8, y: y + 16, class: "c-label" }, c.name));
        var line = !c.up ? t("stopped", "parado") : c.parts.length ? t("reads P", "lê P") + c.parts.join(", P") : t("idle: no partition", "ocioso: sem partição");
        g.appendChild(s("text", { x: CX + 8, y: y + 33, class: "c-small" + (cls === "warn" || cls === "bad" ? " c-warn" : "") }, line));
        svg.appendChild(g);
      });
      var c = con(st, sel) || st.cons[0];
      if (c) sel = c.name;
      B.stop.disabled = !c || !c.up; B.kill.disabled = !c || !c.up; B.start.disabled = !c || (c.up && c.member);
      tiles.set("pub", String(st.seq), "");
      tiles.set("mail", String(st.emails), "");
      tiles.set("dup", String(st.dups), st.dups ? "bad" : "ok");
      var lg = lag(st);
      tiles.set("lag", String(lg), lg ? "warn" : "ok");
      tiles.set("lost", String(st.lost.length), st.lost.length ? "bad" : "ok");
      tiles.set("dlq", String(st.dlq.length), st.dlq.length ? "warn" : "");
      selLabel.textContent = t("Selected: ", "Selecionado: ") + sel;
    }

    var selLabel = el("span", { class: "csim-lbl" });
    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's topic and consumer group, without Docker: keys, partitions, rebalances, lag and the dead-letter topic",
        "O tópico e o grupo de consumidores do lab, sem Docker: chaves, partições, rebalanceamentos, atraso e o dead-letter topic") }),
      el("p", { class: "csim-sub", text: t("Each cell is a message (the end of its order id). Filled cells are committed by notification-group, dashed ones wait, red ones cannot be processed. A line joins a partition to the one instance that reads it.",
        "Cada célula é uma mensagem (o fim do id do pedido). Células cheias foram confirmadas pelo notification-group, tracejadas esperam, vermelhas não podem ser processadas. Uma linha liga a partição à única instância que a lê.") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-row" }, [B.post, B.burst, B.bad, B.poll, B.desc, B.msgs]),
      el("div", { class: "csim-row csim-oe-acts" }, [selLabel, B.stop, B.kill, B.start]),
      el("div", { class: "csim-row" }, [cScale, cParts, tIdem, tDlq]),
      note,
      player,
      el("div", { class: "csim-cols" }, [tiles, term])
    ]);
    reset();
    return {};
  });
})();
