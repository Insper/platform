/*
 * Every value a concept simulator copies from a lab, in one place.
 *
 * A simulator that says "lab 5's TTL" must show lab 5's TTL. Each entry pins the value the simulator
 * uses (`value`) and says where it comes from (`lab`, and `read`, which extracts it from that file in
 * the simulator's unit). lab-values.test.mjs (run by `node scripts/csim/test.mjs`, and by
 * `uv run scripts/handouts/snapshots.py --check`) fails when:
 *
 *   - the lab file no longer gives `value`        → the lab changed: update this entry, the module,
 *                                                    the page's data-* and the tip (see below);
 *   - the module's exported LAB[key] differs        → the module drifted from the lab;
 *   - a page sets data-<attr> to another value      → the embed overrides the lab value;
 *   - a module's LAB has a key not listed here      → an unregistered copy of a lab value.
 *
 * The tips' numbers come from running the model with LAB: each module's tests assert them against the
 * page text (lib.mjs → tipHas), so after changing `value` and LAB the tests show which tip numbers to
 * rewrite. `module: false` marks a fact the simulator only quotes in its tip (no LAB key): the tests
 * check that the tip still quotes it.
 *
 * `lab` is the file of the lab the tip cites (overlays repeat files in later labs; the cited one counts).
 */

const H = "docs/2027.1/hands-on/";
const num = re => text => { const m = text.match(re); return m ? Number(m[1]) : undefined; };
const has = (re, value) => text => (re.test(text) ? value : undefined);

export default [
  // databases/replication: lab 6's read-your-writes experiment
  { sim: "replication", key: "lag", attr: "lag", value: 1000, unit: "ms",
    lab: H + "6/replicas/index.md", read: t => (num(/REPLICA_DELAY=(\d+)s docker compose/)(t) ?? NaN) * 1000 },

  // caching/patterns: lab 5's event TTL
  { sim: "cache", key: "ttl", attr: "ttl", value: 60, unit: "s",
    lab: H + "5/code/services/catalog/src/main/resources/application.yaml", read: num(/event-ttl:\s*\$\{CACHE_TTL_EVENT:(\d+)s\}/) },

  // caching/failure-modes: lab 5's stampede test and its TTL jitter
  { sim: "stampede", key: "ttl", attr: "ttl", value: 3, unit: "s",
    lab: H + "5/stampede/index.md", read: num(/CACHE_TTL_LIST=(\d+)s CACHE_STAMPEDE_PROTECTION=false/) },
  { sim: "stampede", key: "jitter", attr: "jitter", value: 10, unit: "%",
    lab: H + "5/code/services/catalog/src/main/java/boxoffice/catalog/EventCache.java", read: t => Math.round((num(/ttl\.toMillis\(\) \* ([\d.]+) \*/)(t) ?? NaN) * 100) },

  // messaging/kafka: lab 7's topic and consumer
  { sim: "kafka", key: "partitions", attr: "partitions", value: 6,
    lab: H + "7/code/docker-compose.yaml", read: num(/--topic order-events --partitions (\d+)/) },
  { sim: "kafka", key: "consumers", attr: "consumers", value: 3,
    lab: H + "7/code/services/notification/src/main/resources/application.yaml", read: num(/concurrency:\s*\$\{NOTIFY_CONCURRENCY:(\d+)\}/) },

  // messaging/semantics: quoted only
  { sim: "delivery", key: "ackMode", module: false, value: "record", quote: "ack-mode: record",
    lab: H + "7/code/services/notification/src/main/resources/application.yaml", read: has(/^\s*ack-mode:\s*record\b/m, "record") },
  { sim: "delivery", key: "idempotent", module: false, value: true, quote: "NOTIFY_IDEMPOTENT=true",
    lab: H + "7/code/services/notification/src/main/resources/application.yaml", read: has(/idempotent:\s*\$\{NOTIFY_IDEMPOTENT:true\}/, true) },

  // observability/slo: lab 9's SLO window and burn-rate rules for order
  { sim: "slo-burn", key: "days", attr: "days", value: 28, unit: "days",
    lab: H + "9/code/infra/grafana/alerting/slo-order.yaml", read: num(/SLO: [\d.]+% \/ (\d+) days/) },
  { sim: "slo-burn", key: "fastBurn", value: 14.4,
    lab: H + "9/code/infra/grafana/alerting/slo-order.yaml", read: num(/expression: "\$A > ([\d.]+) && \$B > [\d.]+"/) },
  { sim: "slo-burn", key: "slowBurn", value: 6,
    lab: H + "9/code/infra/grafana/alerting/slo-order.yaml", read: t => [...t.matchAll(/expression: "\$A > ([\d.]+) && \$B > [\d.]+"/g)].map(m => +m[1])[1] },

  // edge/load-balancing: quoted only
  { sim: "lb", key: "leastConn", module: false, value: "commented", quote: "least_conn",
    lab: H + "3/code/infra/nginx/nginx.conf", read: has(/^\s*#\s*least_conn;/m, "commented") },

  // case-studies/rate-limiter: lab 3's Nginx limit
  { sim: "rate-limiter", key: "limit", attr: "limit", value: 20, unit: "req/s",
    lab: H + "3/code/infra/nginx/nginx.conf", read: num(/limit_req_zone .* rate=(\d+)r\/s/) },
  { sim: "rate-limiter", key: "burst", attr: "burst", value: 40,
    lab: H + "3/code/infra/nginx/nginx.conf", read: num(/limit_req\s+zone=per_key\s+burst=(\d+)/) },

  // reliability/patterns: lab 9's order → payment client (application.yaml) and load (k6)
  ...(() => {
    const yaml = H + "9/code/services/order/src/main/resources/application.yaml";
    const ms = re => t => { const m = t.match(re); return m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : undefined; };
    return [
      { key: "rate", value: 20, unit: "payments/s", lab: H + "9/code/load/pay-under-chaos.js", read: num(/rate: Number\(__ENV\.PAY_RATE \|\| (\d+)\)/) },
      { key: "threads", value: 50, lab: yaml, read: num(/threads:\s*\n\s*max:\s*(\d+)/) },
      { key: "timeoutMs", value: 1000, unit: "ms", lab: yaml, read: ms(/read-timeout:\s*\$\{PAYMENT_READ_TIMEOUT:(\d+)(ms|s)\}/) },
      { key: "attempts", value: 3, lab: yaml, read: num(/max-attempts:\s*\$\{PAYMENT_RETRY_ATTEMPTS:(\d+)\}/) },
      { key: "backoff", value: 200, unit: "ms", lab: yaml, read: ms(/wait-duration:\s*(\d+)(ms|s)\b/) },
      { key: "mult", value: 2, lab: yaml, read: num(/exponential-backoff-multiplier:\s*([\d.]+)/) },
      { key: "jitter", value: 0.5, lab: yaml, read: num(/randomized-wait-factor:\s*([\d.]+)/) },
      { key: "window", value: 20, lab: yaml, read: num(/sliding-window-size:\s*(\d+)/) },
      { key: "minCalls", value: 10, lab: yaml, read: num(/minimum-number-of-calls:\s*(\d+)/) },
      { key: "failRate", value: 0.5, lab: yaml, read: t => (num(/failure-rate-threshold:\s*(\d+)/)(t) ?? NaN) / 100 },
      { key: "slowMs", value: 800, unit: "ms", lab: yaml, read: ms(/slow-call-duration-threshold:\s*(\d+)(ms|s)\b/) },
      { key: "slowRate", value: 0.5, lab: yaml, read: t => (num(/slow-call-rate-threshold:\s*(\d+)/)(t) ?? NaN) / 100 },
      { key: "openMs", value: 10000, unit: "ms", lab: yaml, read: ms(/wait-duration-in-open-state:\s*(\d+)(ms|s)\b/) },
      { key: "probes", value: 3, lab: yaml, read: num(/permitted-number-of-calls-in-half-open-state:\s*(\d+)/) },
    ].map(e => ({ sim: "resilience", ...e }));
  })(),

  // cloud-native/kubernetes: lab 10's catalog HPA and resources
  ...(() => {
    const hpa = H + "10/code/k8s/base/catalog-hpa.yaml", dep = H + "10/code/k8s/base/catalog.yaml";
    const nth = (re, i) => t => { const v = [...t.matchAll(re)].map(m => +m[1]); return v[i]; };
    return [
      { key: "target", attr: "target", value: 60, unit: "%", lab: hpa, read: num(/averageUtilization:\s*(\d+)/) },
      { key: "min", attr: "min", value: 2, lab: hpa, read: num(/minReplicas:\s*(\d+)/) },
      { key: "max", attr: "max", value: 8, lab: hpa, read: num(/maxReplicas:\s*(\d+)/) },
      { key: "stabilization", attr: "stabilization", value: 120, unit: "s", lab: hpa, read: nth(/stabilizationWindowSeconds:\s*(\d+)/g, 1) },
      { key: "upPercent", value: 100, unit: "%", lab: hpa, read: num(/type: Percent\s*\n\s*value:\s*(\d+)/) },
      { key: "upPods", value: 2, lab: hpa, read: nth(/type: Pods\s*\n\s*value:\s*(\d+)/g, 0) },
      { key: "upPeriod", value: 15, unit: "s", lab: hpa, read: nth(/periodSeconds:\s*(\d+)/g, 0) },
      { key: "downPods", value: 1, lab: hpa, read: nth(/type: Pods\s*\n\s*value:\s*(\d+)/g, 1) },
      { key: "downPeriod", value: 30, unit: "s", lab: hpa, read: nth(/periodSeconds:\s*(\d+)/g, 2) },
      { key: "request", value: 250, unit: "millicores", lab: dep, read: num(/requests:[^]*?cpu:\s*(\d+)m/) },
      { key: "limit", value: 1000, unit: "millicores", lab: dep, read: t => { const m = t.match(/limits:[^]*?cpu:\s*"?(\d+)(m?)"?/); return m ? +m[1] * (m[2] ? 1 : 1000) : undefined; } },
    ].map(e => ({ sim: "autoscale", ...e }));
  })(),
];
