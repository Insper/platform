import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, tipText, ROOT } from "./lib.mjs";

const M = load("order-events");
const page = readFileSync(path.join(ROOT, "docs/2026.2/hands-on/10/index.md"), "utf8");
const describes = r => r.out.filter(x => x.rows);
const assigns = r => r.out.filter(x => x.assign).map(x => x.assign);

test("murmur2 is Kafka's (the test vectors of Kafka's UtilsTest)", () => {
  const cases = { "21": -973932308, "foobar": -790332482, "a-little-bit-long-string": -985981536,
    "a-little-bit-longer-string": -1486304829, "lkjh234lh9fiuh90y23oiuhsafujhadof229phr9h19h89h8": -58897971, "abc": 479470107 };
  for (const [k, v] of Object.entries(cases)) eq(M.murmur2(k), v, k);
});

const code = f => readFileSync(path.join(ROOT, "docs/2026.2/hands-on/10/code", f), "utf8");

test("the names are the lab's: topic, key, group, partitions, error handling", () => {
  ok(code("order-service/src/main/java/store/order/OrderEventPublisher.java").includes(`kafkaTemplate.send("${M.TOPIC}", id,`), "topic and key");
  ok(code("notification-service/src/main/java/store/notification/NotificationService.java").includes(`topics = "${M.TOPIC}", groupId = "${M.GROUP}"`), "listener");
  ok(code("notification-service/src/main/java/store/notification/KafkaConsumerConfig.java").includes(`"${M.GROUP}"`), "group in the factory");
  ok(code("compose.yaml").includes(`KAFKA_NUM_PARTITIONS: ${M.DEFAULT_PARTITIONS}`), "partitions of a new topic");
  ok(code("compose.notification.yaml").includes(`  ${M.SERVICE}:`), "compose service");
  const dlt = code("dlt/KafkaConsumerConfig.java");
  ok(dlt.includes('record.topic() + "-dlt"') && M.DLQ === M.TOPIC + "-dlt", "dead-letter topic");
  ok(dlt.includes(`new FixedBackOff(1000L, ${M.DLT_ATTEMPTS - 1}L)`), "3 attempts with the DLT");
  ok(page.includes(`currentAttempts=${M.ATTEMPTS}, maxAttempts=${M.ATTEMPTS - 1}`), "the default handler's 10 attempts, as the page prints them");
});

test("test: the order of 6.3 is read and committed", () => {
  const r = M.play("test");
  ok(r.out.find(x => x.results).out[0].includes("sending confirmation email: order ord-7f3a"), "the log line");
  ok(page.includes("sending confirmation email: order "), "the page shows the same line");
  eq(describes(r)[0].rows.map(x => x.lag), [0], "lag 0");
});

test("scale: one partition leaves the second instance idle; three spread the work", () => {
  const r = M.play("scale");
  eq(r.out[0].per, [6], "six orders in partition 0");
  eq(r.out[1].idle, ["notification-2"], "idle with 1 partition");
  eq(assigns(r)[1], ["notification-1 ← 0, 1", "notification-2 ← 2"], "range assignor over 3 partitions");
  const second = r.out.filter(x => x.per)[1];
  eq(second.per, [2, 2, 2], "the next six orders by key");
  eq(describes(r).map(d => d.lag), [4, 6, 3], "lag after each describe");
  eq(assigns(r).pop(), ["notification-1 ← 0, 1, 2"], "the survivor owns every partition");
});

test("failures: a duplicate without idempotency, a skip with it, a lost message, then the DLT", () => {
  const r = M.play("failures");
  eq(r.st.dups, 1, "one duplicate email");
  ok(r.out.some(x => x.results && x.results.some(y => y.skipped)), "the idempotent consumer skips");
  eq(r.st.lost, ["oops"], "the default handler skips the bad message");
  eq(describes(r).map(d => d.lag), [0, 0], "the stream never blocks");
  eq(r.st.dlq, ["oops"], "the next bad message in the DLT");
  eq(M.alter(M.create(), 1).tone, "bad", "Kafka never removes partitions");
});

test("every step of every script has a caption in both languages", () => {
  for (const [name, steps] of Object.entries(M.SCRIPTS)) steps.forEach((s, i) => ok(s.en && s.pt, `${name} step ${i + 1}`));
});

test("the tips: each embed quotes the numbers of its script", () => {
  const sc = M.play("scale"), f = M.play("failures");
  const per = sc.out.filter(x => x.per)[1].per;
  tipHas("order-events", lang => lang === "en"
    ? ["six orders land in partition 0", "notification-1 reads partitions 0 and 1, notification-2 reads partition 2", `split ${per[0]}, ${per[1]} and ${per[2]}`]
    : ["seis pedidos caem na partição 0", "notification-1 lê as partições 0 e 1, notification-2 lê a partição 2", `dividem em ${per[0]}, ${per[1]} e ${per[2]}`]);
  for (const lang of ["en", "pt"]) {
    const file = path.join(ROOT, "docs/2026.2/hands-on/10", lang === "en" ? "index.md" : "index.pt.md");
    const tip = tipText("order-events", file, 'data-script="failures"');
    const want = lang === "en"
      ? [`sends ${f.st.dups} duplicate email`, `retried ${M.ATTEMPTS} times`, `${f.st.lost.length} message is lost`, `after ${M.DLT_ATTEMPTS} attempts`, M.DLQ]
      : [`envia ${f.st.dups} e-mail duplicado`, `tentada ${M.ATTEMPTS} vezes`, `${f.st.lost.length} mensagem se perde`, `depois de ${M.DLT_ATTEMPTS} tentativas`, M.DLQ];
    for (const w of want) ok(tip.includes(w), `${lang} failures tip: "${w}"`);
  }
});
