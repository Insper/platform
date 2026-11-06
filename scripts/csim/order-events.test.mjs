import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, ROOT } from "./lib.mjs";

const M = load("order-events");
const page = readFileSync(path.join(ROOT, "docs/2026.2/hands-on/10/index.md"), "utf8");
const describes = r => r.out.filter(x => x.rows);
const assigns = r => r.out.filter(x => x.assign).map(x => x.assign);

test("murmur2 is Kafka's (the test vectors of Kafka's UtilsTest)", () => {
  const cases = { "21": -973932308, "foobar": -790332482, "a-little-bit-long-string": -985981536,
    "a-little-bit-longer-string": -1486304829, "lkjh234lh9fiuh90y23oiuhsafujhadof229phr9h19h89h8": -58897971, "abc": 479470107 };
  for (const [k, v] of Object.entries(cases)) eq(M.murmur2(k), v, k);
});

test("the names are the lab's: topic, key, group, manual commit, DLQ, 1 partition by default", () => {
  ok(page.includes(`kafkaTemplate.send("${M.TOPIC}", order.getId().toString(), event)`), "topic and key");
  ok(page.includes(`group_id="${M.GROUP}"`), "group");
  ok(page.includes("enable_auto_commit=False") && page.includes("consumer.commit()"), "manual commit");
  ok(page.includes(`dlq_producer.send("${M.DLQ}"`), "DLQ topic");
  ok(page.includes('KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"') && !page.includes("KAFKA_NUM_PARTITIONS:"), "auto-created with the broker default");
  eq(M.DEFAULT_PARTITIONS, 1, "num.partitions");
});

test("test: the outputs of section 5", () => {
  const r = M.play("test");
  ok(page.includes(`"id": "${r.out[0].msg.id}"`) && page.includes(`"totalAmount": ${r.out[0].msg.total}`), "the order of 5.2");
  const line = r.out.find(x => x.results).out[0].split("  | ")[1];
  ok(page.includes("notification-service  | " + line), "the log line of 5.4: " + line);
  eq(describes(r)[0].rows.map(x => x.lag), [0], "lag 0");
});

test("scale: one partition leaves the second instance idle; three spread the work", () => {
  const r = M.play("scale");
  eq(r.out[0].per, [6], "six orders in partition 0");
  eq(r.out[1].idle, ["notification-service-2"], "idle with 1 partition");
  eq(assigns(r)[1], ["notification-service-1 ← 0, 1", "notification-service-2 ← 2"], "range assignor over 3 partitions");
  const second = r.out.filter(x => x.per)[1];
  eq(second.per, [2, 2, 2], "the next six orders by key");
  eq(describes(r).map(d => d.lag), [4, 6, 3], "lag after each describe");
  eq(assigns(r).pop(), ["notification-service-1 ← 0, 1, 2"], "the survivor owns every partition");
});

test("failures: a duplicate without idempotency, a skip with it, the DLQ unblocks the partition", () => {
  const r = M.play("failures");
  eq(r.st.dups, 1, "one duplicate email");
  ok(r.out.some(x => x.results && x.results.some(y => y.skipped)), "the idempotent consumer skips");
  ok(r.out.some(x => x.results && x.results.some(y => y.died)), "the thread dies without try/except");
  eq(describes(r).map(d => d.lag), [3, 0], "lag grows to 3, then drops to 0");
  eq(r.st.dlq, ["ord-c40e"], "the bad event in the DLQ");
});

test("a dead thread leaves the group after max.poll.interval.ms; Kafka never removes partitions", () => {
  const st = M.create({ consumers: 2, partitions: 1 });
  M.post(st, true);
  M.poll(st);
  M.wait(st);
  eq(M.members(st).map(c => c.name + ":" + c.parts.join(",")), ["notification-service-2:0"], "the partition moves on");
  M.poll(st);
  ok(!st.cons[1].thread, "the next owner meets the same message");
  eq(M.alter(st, 1).tone, "bad", "no decrease");
});

test("every step of every script has a caption in both languages", () => {
  for (const [name, steps] of Object.entries(M.SCRIPTS)) steps.forEach((s, i) => ok(s.en && s.pt, `${name} step ${i + 1}`));
});

test("the tips", () => {
  const s = M.play("scale"), f = M.play("failures");
  const per = s.out.filter(x => x.per)[1].per.join(", ").replace(/, (\d+)$/, " $1");
  const lags = describes(f).map(d => d.lag);
  tipHas("order-events", lang => lang === "en"
    ? ["six orders land in partition 0", "notification-service-1 reads partitions 0 and 1, notification-service-2 reads partition 2",
       "split " + per.replace(/ (\d+)$/, " and $1"), `sends ${f.st.dups} duplicate email`, `grows to ${lags[0]}`, `drops to ${lags[1]}`]
    : ["seis pedidos caem na partição 0", "notification-service-1 lê as partições 0 e 1, notification-service-2 lê a partição 2",
       "dividem em " + per.replace(/ (\d+)$/, " e $1"), `envia ${f.st.dups} e-mail duplicado`, `cresce para ${lags[0]}`, `cai para ${lags[1]}`]);
});
