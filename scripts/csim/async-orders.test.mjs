import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, fmt, ROOT } from "./lib.mjs";

const M = load("async-orders");
const read = rel => readFileSync(path.join(ROOT, "docs/2027.1/hands-on/7", rel), "utf8");
const kafkaPage = read("kafka/index.md"), outboxPage = read("outbox/index.md"), consumerPage = read("consumer/index.md"), measurePage = read("measure/index.md");
const code = rel => read("code/" + rel);
const lines = r => r.out.flatMap(x => x.out);

test("murmur2 is Kafka's (the test vectors of Kafka's UtilsTest)", () => {
  const cases = { "21": -973932308, "foobar": -790332482, "a-little-bit-long-string": -985981536,
    "a-little-bit-longer-string": -1486304829, "lkjh234lh9fiuh90y23oiuhsafujhadof229phr9h19h89h8": -58897971, "abc": 479470107 };
  for (const [k, v] of Object.entries(cases)) eq(M.murmur2(k), v, k);
});

test("the tour of step 1: order-1 → partition 4, order-2 → partition 3, as the page prints", () => {
  const r = M.play("consumer", 1);
  for (const l of r.out[0].out) ok(kafkaPage.includes(l), "kafka page prints " + JSON.stringify(l));
});

test("the names are the lab's: topic, DLT, group, the first order's id", () => {
  ok(code("services/order/src/main/resources/application.yaml").includes(`topic: ${M.TOPIC}`), "topic");
  ok(code("compose.yaml").includes(`--topic ${M.DLT} --partitions ${M.LAB.partitions}`), "DLT with as many partitions");
  ok(code("services/notification/src/main/java/boxoffice/notification/OrderEventListener.java").includes(`groupId = "${M.GROUP}"`), "group");
  ok(outboxPage.includes(`{"id":"${M.FIRST_ID}"`), "the id of the outbox page's curl");
  eq(M.backoffs(), [500, 1000, 2000], "0.5 s, 1 s, 2 s");
  ok(consumerPage.includes("0.5 + 1 + 2 = 3.5 s"), "the page's sum");
  ok(code("services/notification/src/main/java/boxoffice/notification/EmailSender.java").includes('startsWith("poison")'), "poison addresses fail");
});

test("outbox: idempotent POST, no event lost with Kafka down, at-least-once after a crash", () => {
  const r = M.play("outbox");
  ok(outboxPage.includes("relayed 1 event(s) to order-events"), "the page's relay line");
  ok(r.out[1].out[0].includes("relayed 1 event(s) to order-events"), "relayed");
  eq(r.out[2].status, 200, "the same curl again");
  eq(r.out[2].order.id, M.FIRST_ID, "the same id");
  eq(r.out[3].n, 0, "nothing for the relay");
  const kafkaDown = r.out.find(x => x.cmd.includes("SELECT event_type"));
  ok(/\| $/.test(kafkaDown.out[1]), "the new row has an empty published_at");
  ok(r.out.filter(x => x.out.some(l => l.includes("Unexpected error occurred in scheduled task"))).length === 2, "two failed relay runs");
  ok(outboxPage.includes("Unexpected error") && outboxPage.includes("max.block.ms"), "the page names the error and max.block.ms");
  eq(M.pending(r.st), 0, "every row published in the end");
  const ids = r.st.logs.flat().map(x => x.value.eventId);
  eq(ids.length - new Set(ids).size, 1, "one event published twice after the relay crash");
});

test("consumer: tour → DLT, 2 e-mails, replay keeps 2, NOTIFY_IDEMPOTENT=false makes 4, poison last", () => {
  const two = M.play("consumer", 2);
  const dead = lines(two).filter(l => l.includes("dead letter at"));
  eq(dead.length, 3, "three dead letters");
  for (const l of dead) ok(consumerPage.includes(l.split("|")[1].replace("WARN … DeadLetterListener ", "").trim().replace(/^:\s*/, "")), "page prints " + l);
  eq(two.st.inbox.length, 2, "two e-mails");
  ok(consumerPage.includes("jq '.total'\n2"), "the page's total");
  eq(M.play("consumer", 3).st.inbox.length, 2, "replay with dedupe: still 2");
  ok(lines(M.play("consumer", 3)).filter(l => l.includes("duplicate event")).length === 2, "two duplicates ignored");
  const four = M.play("consumer", 4);
  eq(four.st.inbox.length, 4, "replay without dedupe");
  eq(M.duplicates(four.st), 2, "two duplicate e-mails");
  const five = M.play("consumer", 5);
  const rows = five.st.deadLetters;
  eq(rows.length, 10, "three tour messages per pass, three passes, then the poison order");
  ok(rows.slice(0, 9).every(x => x.reason === "java.lang.IllegalArgumentException"), "tour rows");
  const poison = five.st.logs.flat().find(x => x.value.customerEmail === "poison@example.com");
  eq([rows[9].partition], [poison.p], "the last row is the poison order's partition");
  const all = M.play("consumer");
  const retry = lines(all).find(l => l.includes("retried after"));
  ok(retry.includes("0.5 s, 1 s, 2 s") && retry.includes("waits 3.5 s"), "transient failure retried: " + retry);
  ok(all.st.deadLetters[10].reason.includes("MailSendException"), "then dead-lettered");
});

test("drain: experiments B and C against the page", () => {
  const sync = M.drain({ mode: "sync", outage: true });
  eq([sync.failed, sync.total], [1000, 3000], "B sync: the outage window fails");
  ok(measurePage.includes("at least a third"), "the page's floor");
  const out = M.drain({ mode: "outbox", outage: true });
  eq(out.failed, 0, "B outbox: no order fails");
  ok(out.peak >= 1000 && out.peakAt === M.LAB.outageAt + M.LAB.outageFor, "the lag peaks when notification comes back");
  const c1 = M.drain({ rate: 100, concurrency: 1 });
  eq([c1.peak, c1.drain], [4800, 240], "C, concurrency 1");
  ok(measurePage.includes("**≈ 4 800**") && measurePage.includes("**≈ 240 s**"), "the page's prediction");
  const c6 = M.drain({ rate: 100, concurrency: 6 }), c8 = M.drain({ rate: 100, concurrency: 8 });
  ok(c6.peak < 200, "six threads keep the lag below the page's 200");
  eq([c8.peak, c8.drain, c8.idle], [c6.peak, c6.drain, 2], "eight threads: as six, two idle");
});

test("every step of every script has a caption in both languages", () => {
  for (const [name, steps] of Object.entries(M.SCRIPTS)) steps.forEach((s, i) => ok(s.en && s.pt, `${name} step ${i + 1}`));
});

test("the tips", () => {
  const sync = M.drain({ mode: "sync", outage: true }), out = M.drain({ mode: "outbox", outage: true });
  const c1 = M.drain({ rate: 100, concurrency: 1 }), c3 = M.drain({ rate: 100, concurrency: 3 }), c6 = M.drain({ rate: 100, concurrency: 6 });
  const c45 = [4, 5].map(c => M.drain({ rate: 100, concurrency: c }).drain);
  eq(c45, [c3.drain, c3.drain], "four or five threads drain as slowly as three");
  eq([4, 5].map(c => M.assign(6, c)[0]), [[0, 1], [0, 1]], "thread 1 keeps two partitions");
  const mails = [M.play("consumer", 3).st.inbox.length, M.play("consumer", 4).st.inbox.length];
  tipHas("async-orders", lang => lang === "en"
    ? [`Mailpit still has ${mails[0]} e-mails after the replay and ${mails[1]} with NOTIFY_IDEMPOTENT=false`, "after 0.5, 1 and 2 s",
       `sync loses ${fmt(sync.failed)} of ${fmt(sync.total)} orders (${fmt(sync.failRate * 100)} %)`, `the lag peaks at ${fmt(out.peak)}`,
       `drains ${out.drain} s after the load`, `reach ${fmt(c1.peak)} and drain ${c1.drain} s after the load`,
       `three threads ${fmt(c3.peak)} and ${c3.drain} s`, `six threads keep it at ${c6.peak} or less`, "two threads stay idle", `Four or five threads still take ${c45[0]} s`]
    : [`o Mailpit continua com ${mails[0]} e-mails depois do reprocessamento e fica com ${mails[1]} com NOTIFY_IDEMPOTENT=false`, "depois de 0,5, 1 e 2 s",
       `sync perde ${fmt(sync.failed, 0, "pt")} de ${fmt(sync.total, 0, "pt")} pedidos (${fmt(sync.failRate * 100, 0, "pt")} %)`, `o *lag* chega a ${fmt(out.peak, 0, "pt")}`,
       `drena ${out.drain} s depois da carga`, `chegar a ${fmt(c1.peak, 0, "pt")} e drenar ${c1.drain} s depois da carga`,
       `três threads, ${fmt(c3.peak, 0, "pt")} e ${c3.drain} s`, `seis threads o mantêm em ${c6.peak} ou menos`, "duas threads ficam ociosas", `Quatro ou cinco threads ainda levam ${c45[0]} s`]);
});
