import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, ROOT } from "./lib.mjs";

const M = load("otel-trace");
const LAB = "docs/2026.2/hands-on/11";
const page = readFileSync(path.join(ROOT, LAB, "index.md"), "utf8");
const pagePt = readFileSync(path.join(ROOT, LAB, "index.pt.md"), "utf8");
const at = (st) => M.trace(st.cfg, st.seq);
const ms = (v) => M.fmtMs(v);

test("the services and the exporter are the ones of the page's compose.yaml blocks", () => {
  const names = [...page.matchAll(/OTEL_SERVICE_NAME: (\S+)/g)].map(m => m[1]);
  eq(names, ["gateway-service", "order-service", "product-service", "account-service"], "OTEL_SERVICE_NAME on the page");
  eq(M.SERVICES, names, "the model's services");
  for (const m of page.matchAll(/OTEL_EXPORTER_OTLP_ENDPOINT: (\S+)/g)) eq(m[1], M.ENDPOINT, "OTEL_EXPORTER_OTLP_ENDPOINT");
  ok(page.includes(`OTEL_TRACES_SAMPLER_ARG=${M.RATIO}`), "the sampler argument");
  const tr = at(M.create());
  eq([...new Set(tr.spans.map(s => s.service))], ["gateway-service", "order-service", "product-service"], "the trace crosses gateway, order and product");
  ok(tr.spans.length >= 3, "the checklist asks for at least 3 spans");
});

test("the page's request and the span tags of its table", () => {
  ok(page.includes(`{"accountId": ${M.REQ.accountId}, "productId": ${M.REQ.productId}, "quantity": ${M.REQ.quantity}}`), "the curl of the page");
  const tags = {};
  at(M.create()).spans.forEach(s => Object.assign(tags, s.tags));
  for (const [k, v] of [["http.method", "POST"], ["http.url", "http://order:8080/orders"], ["http.status_code", "200"], ["db.system", "postgresql"],
    ["db.statement", "SELECT * FROM products WHERE id = ?"], ["net.peer.name", "db"]]) {
    ok(page.includes(`| \`${k}\` | \`${v}\` |`), `the page's table has ${k}`);
    ok(at(M.create()).spans.some(s => String(s.tags[k]) === v), `a span of the model has ${k}=${v}`);
  }
});

test("the slow query gives the durations of the page's diagram", () => {
  const tr = at(M.play("lab", 1));
  eq([tr.total, tr.span("or").dur, tr.span("pr").dur, tr.span("sq").dur], [2340, 2250, 2190, 2180], "gateway, order, product, query");
  for (const [n, d] of [["gateway.POST /orders", 2340], ["order.POST /orders", 2250], ["product.GET /products/7", 2190], ["jdbc.query", 2180]])
    ok(page.includes(`span: ${n} (${ms(d)})`) && pagePt.includes(`span: ${n} (${ms(d)})`), `the diagram shows ${n} ${d} ms`);
  ok(page.includes(`total: ${ms(tr.total)}`), "the total of the first diagram");
  eq([tr.hot.key, tr.hotShare], ["sq", 93], "the query is the largest self time");
});

test("a delay in product-service's code grows its span, not the query", () => {
  const tr = at(M.play("lab", 2));
  eq([tr.span("pr").dur, tr.span("sq").dur, tr.hot.key], [2190, 20, "pr"], "product grows, SELECT stays");
});

test("traceparent and the log lines carry the page's ids", () => {
  const tr = at(M.play("lab", 3));
  const example = page.match(/traceparent: (00-[0-9a-f]{32}-[0-9a-f]{16}-01)/)[1];
  eq(tr.headers[2].value, example, "the page's example is the header order-service sends to product-service");
  eq(tr.traceId, M.TRACE_ID, "the trace id");
  const logs = [...page.matchAll(/(\d\d:\d\d:\d\d\.\d{3}) \[http-nio-8080-exec-3\] INFO  c\.example\.order\.OrderService\n {4}\[trace_id=(\w+) span_id=(\w+)\] - (.*)/g)];
  eq(logs.length, 2, "two log lines on the page");
  logs.forEach((m, i) => eq([m[1], m[2], m[3], m[4]], tr.logs[i].text.match(/^(\S+) .*\n {4}\[trace_id=(\w+) span_id=(\w+)\] - (.*)$/).slice(1), `log line ${i + 1}`));
  ok(tr.headers.every(h => !h.value || h.value.split("-")[1] === tr.traceId), "the trace id never changes");
});

test("the manual span: product-service moves under validateOrder, and is orphaned without end()", () => {
  let tr = at(M.play("lab", 4));
  eq([tr.span("pr").parent, tr.headers[2].value.split("-")[2]], [tr.span("va").id, tr.span("va").id], "the header carries validateOrder's span id");
  eq(tr.inJaeger, 6, "six spans");
  tr = at(M.play("lab", 5));
  eq([tr.span("va").exported, tr.span("pr").orphan, tr.inJaeger], [false, true, 5], "validateOrder never exported");
});

test("localhost:4317 in product-service: two spans lost, order-service looks slow", () => {
  const tr = at(M.play("lab", 6));
  eq(tr.spans.filter(s => !s.exported).map(s => s.key), ["pr", "sq"], "product and the query are missing");
  eq([tr.hot.key, tr.hot.self], ["or", 2225], "order-service's self time");
});

test("sampling: about 10%, decided at the root, and the flags follow", () => {
  const st = M.play("lab", 7);
  eq([st.kept, st.sent], [6, 100], "6 of 100 kept");
  const k = M.batch({ sampler: "ratio" }, 1000, 10000);
  ok(k > 900 && k < 1100, `about 10% of 10 000 (${k})`);
  for (let seq = 2; seq < 40; seq++) {
    const tr = M.trace({ ...M.defaults(), sampler: "ratio" }, seq);
    ok(tr.headers.slice(1).every(h => h.value.endsWith(tr.sampled ? "-01" : "-00")), "the flags of every hop");
    ok(tr.spans.every(s => s.exported === tr.sampled), "a trace is never half-sampled");
    ok(tr.logs.every(l => l.trace === tr.traceId), "the logs keep the trace id");
  }
});

test("every caption is in both languages and quotes the model", () => {
  M.SCRIPTS.lab.forEach((s, i) => ok(s.en && s.pt, `step ${i + 1}`));
  const c = M.SCRIPTS.lab;
  ok(c[0].en.includes(ms(2340)) && c[0].en.includes(ms(2180)) && c[0].en.includes("93%"), "step 1");
  ok(c[5].en.includes(ms(2225)) && c[5].pt.includes(ms(2225)), "step 6");
  ok(c[6].en.includes("keeps 6 traces") && c[6].pt.includes("guarda 6 traces"), "step 7");
});

test("the tips", () => {
  const base = at(M.create()), slow = at(M.play("lab", 1)), prod = at(M.play("lab", 2)), local = at(M.play("lab", 6)), kept = M.play("lab", 7).kept;
  tipHas("otel-trace", lang => [`${base.spans.length} spans, ${ms(base.total)}`, ms(slow.total), `${ms(slow.span("sq").dur)} (${slow.hotShare}%)`,
    `SELECT ${lang === "en" ? "at" : "em"} ${ms(prod.span("sq").dur)}`, `${ms(local.hot.self)}`, lang === "en" ? `keeps ${kept} of 100` : `guarda ${kept} de 100`]);
});
