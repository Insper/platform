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

  // hands-on 6 (lab twin boxoffice-db): the artificial lag, the gateway's timeout, the reconnect wait
  { sim: "boxoffice-db", key: "delay", value: 1000, unit: "ms",
    lab: H + "6/failover/index.md", read: t => (num(/REPLICA_DELAY=(\d+)s docker compose up -d --wait db-replica/)(t) ?? NaN) * 1000 },
  { sim: "boxoffice-db", key: "timeout", value: 5000, unit: "ms",
    lab: H + "6/code/services/gateway/src/main/resources/application.yaml", read: t => (num(/response-timeout:\s*(\d+)s/)(t) ?? NaN) * 1000 },
  { sim: "boxoffice-db", key: "reconnect", value: 15000, unit: "ms",
    lab: H + "6/failover/index.md", read: t => (num(/sleep (\d+); probe "hold"/)(t) ?? NaN) * 1000 },

  // hands-on 4 (lab twin front-door): ports, the edge's rate limit, the gateway's balancer, token lifetimes
  ...(() => {
    const nginx = H + "4/code/infra/nginx/nginx.conf", gw = H + "4/code/services/gateway/src/main/resources/application.yaml";
    const auth = H + "4/code/services/auth/src/main/resources/application.yaml", page = H + "4/index.md";
    const port = num(/^server:\s*\n\s*port:\s*(\d+)/m);
    return [
      { key: "edgePort", value: 80, lab: nginx, read: num(/^\s*listen\s+(\d+);/m) },
      { key: "gatewayPort", value: 8080, lab: gw, read: port },
      { key: "authPort", value: 8081, lab: auth, read: port },
      { key: "catalogPort", value: 8082, lab: gw, read: num(/uri: http:\/\/catalog-1:(\d+)/) },
      { key: "limit", value: 20, unit: "req/s", lab: nginx, read: num(/limit_req_zone .* rate=(\d+)r\/s/) },
      { key: "burst", value: 40, lab: nginx, read: num(/limit_req\s+zone=per_key\s+burst=(\d+)/) },
      { key: "probe", value: 5, unit: "s", lab: gw, read: num(/health-check:\s*\n\s*interval:\s*(\d+)s/) },
      { key: "retries", value: 1, lab: gw, read: num(/retries:\s*(\d+)/) },
      { key: "ttl", value: 3600, unit: "s", lab: auth, read: t => (num(/ttl:\s*\$\{JWT_TTL:PT(\d+)H\}/)(t) ?? NaN) * 3600 },
      { key: "shortTtl", value: 30, unit: "s", lab: page, read: num(/JWT_TTL=PT(\d+)S docker compose up -d auth/) },
      { key: "skew", value: 60, unit: "s", lab: page, read: num(/tolerates (\d+) s of clock skew/) },
    ].map(e => ({ sim: "front-door", ...e }));
  })(),

  // hands-on 5 (lab twin catalog-cache): the TTLs, the jitter, Redis's port
  ...(() => {
    const yaml = H + "5/code/services/catalog/src/main/resources/application.yaml";
    return [
      { key: "eventTtl", value: 60, unit: "s", lab: yaml, read: num(/event-ttl:\s*\$\{CACHE_TTL_EVENT:(\d+)s\}/) },
      { key: "listTtl", value: 10, unit: "s", lab: yaml, read: num(/list-ttl:\s*\$\{CACHE_TTL_LIST:(\d+)s\}/) },
      { key: "jitter", value: 10, unit: "%", lab: H + "5/code/services/catalog/src/main/java/boxoffice/catalog/EventCache.java",
        read: t => Math.round((num(/ttl\.toMillis\(\) \* ([\d.]+) \*/)(t) ?? NaN) * 100) },
      { key: "redisPort", value: 6379, lab: H + "5/code/docker-compose.yaml", read: num(/REDIS_PORT:\s*(\d+)/) },
    ].map(e => ({ sim: "catalog-cache", ...e }));
  })(),

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

  // messaging/semantics: lab 7's blocking retries (KafkaConfig) and e-mail latency, in the retry-topics simulator
  ...(() => {
    const cfg = H + "7/code/services/notification/src/main/java/boxoffice/notification/KafkaConfig.java";
    return [
      { key: "emailMs", value: 50, unit: "ms", lab: H + "7/code/services/notification/src/main/resources/application.yaml", read: num(/email-latency:\s*\$\{EMAIL_LATENCY:(\d+)ms\}/) },
      { key: "retries", value: 3, lab: cfg, read: num(/new ExponentialBackOffWithMaxRetries\((\d+)\)/) },
      { key: "backoffMs", value: 500, unit: "ms", lab: cfg, read: num(/setInitialInterval\((\d+)L\)/) },
      { key: "multiplier", value: 2, lab: cfg, read: num(/setMultiplier\(([\d.]+)\)/) },
      { key: "maxBackoffMs", value: 5000, unit: "ms", lab: cfg, read: t => num(/setMaxInterval\(([\d_]+)L\)/)(t.replace(/(\d)_(\d)/g, "$1$2")) },
    ].map(e => ({ sim: "retry-topics", ...e }));
  })(),

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

  // hands-on 3: the lab twin of the edge (nginx.conf, the page's commands, ratelimit.js, lab 2's load.js)
  ...(() => {
    const conf = H + "3/code/infra/nginx/nginx.conf", page = H + "3/index.md", rl = H + "3/code/load/ratelimit.js";
    return [
      { key: "replicas", value: 3, lab: conf, read: t => (t.match(/^\s*server catalog-\d+:8082 /gm) || []).length || undefined },
      { key: "maxFails", value: 3, lab: conf, read: num(/max_fails=(\d+)/) },
      { key: "failTimeout", value: 10, unit: "s", lab: conf, read: num(/fail_timeout=(\d+)s/) },
      { key: "connectTimeout", value: 1, unit: "s", lab: conf, read: num(/proxy_connect_timeout\s+(\d+)s;/) },
      { key: "readTimeout", value: 5, unit: "s", lab: conf, read: num(/proxy_read_timeout\s+(\d+)s;/) },
      { key: "tries", value: 2, lab: conf, read: num(/proxy_next_upstream_tries\s+(\d+);/) },
      { key: "resolverValid", value: 10, unit: "s", lab: conf, read: num(/resolver\s+127\.0\.0\.11\s+valid=(\d+)s/) },
      { key: "rate", value: 20, unit: "req/s", lab: conf, read: num(/limit_req_zone .* rate=(\d+)r\/s/) },
      { key: "burst", value: 40, lab: conf, read: num(/limit_req\s+zone=per_key\s+burst=(\d+)/) },
      { key: "loadRate", value: 150, unit: "req/s", lab: page, read: num(/k6 run -e RATE=(\d+) -e DURATION=2m load\/load\.js/) },
      { key: "startup", value: 10, unit: "s", lab: page, read: num(/startup takes ~(\d+) s/) },
      { key: "greedy", value: 50, unit: "req/s", lab: rl, read: num(/greedy: \{\s*executor: 'constant-arrival-rate', rate: (\d+)/) },
      { key: "polite", value: 10, unit: "req/s", lab: rl, read: num(/polite: \{\s*executor: 'constant-arrival-rate', rate: (\d+)/) },
      { key: "rlSeconds", value: 30, unit: "s", lab: rl, read: num(/duration: '(\d+)s'/) },
      { key: "listShare", value: 0.2, lab: H + "2/code/load/load.js", read: num(/LIST_SHARE \|\| ([\d.]+)\)/) },
    ].map(e => ({ sim: "nginx-edge", ...e }));
  })(),

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

  // hands-on/9: the lab twin of lab 9 (order's application.yaml, the k6 script, the toxics of the patterns page)
  ...(() => {
    const yaml = H + "9/code/services/order/src/main/resources/application.yaml", k6 = H + "9/code/load/pay-under-chaos.js";
    const page = H + "9/patterns/index.md";
    const ms = re => t => { const m = t.match(re); return m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : undefined; };
    return [
      { key: "threads", value: 50, lab: yaml, read: num(/threads:\s*\n\s*max:\s*(\d+)/) },
      { key: "payRate", value: 20, unit: "payments/s", lab: k6, read: num(/rate: Number\(__ENV\.PAY_RATE \|\| (\d+)\)/) },
      { key: "browseRate", value: 20, unit: "req/s", lab: k6, read: num(/exec: 'browse',\s*rate: (\d+)/) },
      { key: "payMaxVUs", value: 600, lab: k6, read: num(/exec: 'pay',[^}]*maxVUs: (\d+)/) },
      { key: "browseMaxVUs", value: 300, lab: k6, read: num(/exec: 'browse',[^}]*maxVUs: (\d+)/) },
      { key: "duration", value: 120, unit: "s", lab: k6, read: t => (num(/DURATION = __ENV\.DURATION \|\| '(\d+)m'/)(t) ?? NaN) * 60 },
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
      { key: "bulkhead", value: 10, lab: yaml, read: num(/max-concurrent-calls:\s*\$\{PAYMENT_BULKHEAD:(\d+)\}/) },
      { key: "slowLatency", value: 3000, unit: "ms", lab: page, read: num(/"attributes":\{"latency":(\d+)\}\}'\s*\nk6 run load\/pay-under-chaos\.js/) },
      { key: "resetToxicity", value: 0.3, lab: page, read: num(/"type":"reset_peer","toxicity":([\d.]+)/) },
      { key: "bulkLatency", value: 700, unit: "ms", lab: page, read: num(/"attributes":\{"latency":(\d+)\}\}'\s*\nPAYMENT_BULKHEAD=/) },
      { key: "bulkRate", value: 70, unit: "payments/s", lab: page, read: num(/k6 run -e PAY_RATE=(\d+) load\/pay-under-chaos\.js/) },
      { key: "bulkOff", value: 1000, lab: page, read: num(/PAYMENT_BULKHEAD=(\d+) docker compose up -d --wait order\s+# effectively no bulkhead/) },
    ].map(e => ({ sim: "pay-under-chaos", ...e }));
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

  // compute/integrations: lab 9's payment client (timeout, retry) and its idempotency key
  ...(() => {
    const yaml = H + "9/code/services/order/src/main/resources/application.yaml";
    const ms = re => t => { const m = t.match(re); return m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : undefined; };
    return [
      { key: "timeoutMs", value: 1000, unit: "ms", lab: yaml, read: ms(/read-timeout:\s*\$\{PAYMENT_READ_TIMEOUT:(\d+)(ms|s)\}/) },
      { key: "attempts", value: 3, lab: yaml, read: num(/max-attempts:\s*\$\{PAYMENT_RETRY_ATTEMPTS:(\d+)\}/) },
      { key: "backoff", value: 200, unit: "ms", lab: yaml, read: ms(/wait-duration:\s*(\d+)(ms|s)\b/) },
      { key: "mult", value: 2, lab: yaml, read: num(/exponential-backoff-multiplier:\s*([\d.]+)/) },
      { key: "jitter", value: 0.5, lab: yaml, read: num(/randomized-wait-factor:\s*([\d.]+)/) },
      { key: "orderKey", module: false, value: "order-<orderId>", quote: "order-<orderId>",
        lab: H + "9/code/services/order/src/main/java/boxoffice/order/payment/PaymentClient.java",
        read: has(/"Idempotency-Key", "order-" \+ orderId/, "order-<orderId>") },
    ].map(e => ({ sim: "idempotent-retry", ...e }));
  })(),

  // hands-on/7: the lab twin of lab 7 (outbox, relay, consumer, DLT, the lag of experiments B and C)
  ...(() => {
    const L7 = H + "7/code/", nyaml = L7 + "services/notification/src/main/resources/application.yaml";
    const oyaml = L7 + "services/order/src/main/resources/application.yaml";
    const kcfg = L7 + "services/notification/src/main/java/boxoffice/notification/KafkaConfig.java";
    const k6 = L7 + "load/orders-load.js", measure = H + "7/measure/index.md";
    return [
      { key: "partitions", value: 6, lab: L7 + "docker-compose.yaml", read: num(/--topic order-events --partitions (\d+)/) },
      { key: "concurrency", value: 3, lab: nyaml, read: num(/concurrency:\s*\$\{NOTIFY_CONCURRENCY:(\d+)\}/) },
      { key: "emailMs", value: 50, unit: "ms", lab: nyaml, read: num(/email-latency:\s*\$\{EMAIL_LATENCY:(\d+)ms\}/) },
      { key: "idempotent", value: true, lab: nyaml, read: has(/idempotent:\s*\$\{NOTIFY_IDEMPOTENT:true\}/, true) },
      { key: "retries", value: 3, lab: kcfg, read: num(/new ExponentialBackOffWithMaxRetries\((\d+)\)/) },
      { key: "backoffMs", value: 500, unit: "ms", lab: kcfg, read: num(/setInitialInterval\((\d+)L\)/) },
      { key: "backoffMult", value: 2, lab: kcfg, read: num(/setMultiplier\(([\d.]+)\)/) },
      { key: "relayMs", value: 200, unit: "ms", lab: oyaml, read: num(/relay-interval-ms:\s*(\d+)/) },
      { key: "maxBlockMs", value: 5000, unit: "ms", lab: oyaml, read: num(/max\.block\.ms:\s*(\d+)/) },
      { key: "rate", value: 50, unit: "orders/s", lab: k6, read: num(/rate: Number\(__ENV\.RATE \|\| (\d+)\)/) },
      { key: "duration", value: 60, unit: "s", lab: k6, read: num(/duration: __ENV\.DURATION \|\| '(\d+)s'/) },
      { key: "outageAt", value: 20, unit: "s", lab: measure, read: num(/sleep (\d+); docker compose stop notification/) },
      { key: "outageFor", value: 20, unit: "s", lab: measure, read: num(/docker compose stop notification; sleep (\d+); docker compose start notification/) },
      { key: "burstRate", value: 100, unit: "orders/s", lab: measure, read: num(/RATE=(\d+) k6 run load\/orders-load\.js/) },
    ].map(e => ({ sim: "async-orders", ...e }));
  })(),

  // hands-on/10: the lab twin of lab 10 (catalog.yaml, kind.yaml, the k6 command of experiment B)
  ...(() => {
    const dep = H + "10/code/k8s/base/catalog.yaml", kind = H + "10/code/k8s/kind.yaml", measure = H + "10/measure/index.md";
    const probe = (name, key) => t => num(new RegExp(name + ":[^\\n]*\\n(?:\\s+(?!\\w+Probe:)[^\\n]*\\n)*?\\s+" + key + ":\\s*(\\d+)"))(t);
    return [
      { key: "replicas", value: 2, lab: dep, read: num(/^\s*replicas:\s*(\d+)/m) },
      { key: "maxSurge", value: 1, lab: dep, read: num(/maxSurge:\s*(\d+)/) },
      { key: "maxUnavailable", value: 0, lab: dep, read: num(/maxUnavailable:\s*(\d+)/) },
      { key: "preStop", value: 5, unit: "s", lab: dep, read: num(/preStop:\s*\n\s*sleep:\s*\n\s*seconds:\s*(\d+)/) },
      { key: "readinessPeriod", value: 5, unit: "s", lab: dep, read: probe("readinessProbe", "periodSeconds") },
      { key: "startupPeriod", value: 5, unit: "s", lab: dep, read: probe("startupProbe", "periodSeconds") },
      { key: "grace", value: 30, unit: "s", lab: dep, read: num(/terminationGracePeriodSeconds:\s*(\d+)/) },
      { key: "port", value: 8082, lab: dep, read: num(/^\s*port:\s*(\d+)/m) },
      { key: "workers", value: 2, lab: kind, read: t => (t.match(/role: worker\b/g) || []).length || undefined },
      { key: "rate", value: 100, unit: "req/s", lab: measure, read: num(/k6 run -e RATE=(\d+) -e DURATION=2m load\/catalog-otel\.js &/) },
      { key: "duration", value: 120, unit: "s", lab: measure, read: t => (num(/k6 run -e RATE=\d+ -e DURATION=(\d+)m load\/catalog-otel\.js &/)(t) ?? NaN) * 60 },
      { key: "rolloutAt", value: 30, unit: "s", lab: measure, read: num(/sleep (\d+) && kubectl -n boxoffice rollout restart deployment\/catalog/) },
      { key: "cluster", value: "boxoffice", lab: kind, read: has(/^name: boxoffice$/m, "boxoffice") },
    ].map(e => ({ sim: "kind-lab", ...e }));
  })(),

  // classes/ai-delivery (code review): the cap per PR of lab 13's reviewer
  { sim: "review-noise", key: "cap", attr: "cap", value: 6,
    lab: H + "13/code/.github/ai/review.py", read: num(/AI_REVIEW_MAX_COMMENTS", "(\d+)"/) },

  // hands-on/13: the lab twin of part 5 (canary_explain.py policy)
  ...(() => {
    const py = H + "13/code/.github/ai/canary_explain.py";
    return [
      { key: "minRps", value: 2, unit: "req/s", lab: py, read: num(/^MIN_RPS = ([\d.]+)/m) },
      { key: "maxErrorRate", value: 0.01, lab: py, read: num(/^MAX_ERROR_RATE = ([\d.]+)/m) },
      { key: "maxErrorDelta", value: 0.005, lab: py, read: num(/^MAX_ERROR_DELTA = ([\d.]+)/m) },
      { key: "maxP99Ratio", value: 1.25, lab: py, read: num(/^MAX_P99_RATIO = ([\d.]+)/m) },
    ].map(e => ({ sim: "canary-explain", ...e }));
  })(),

  // hands-on/2: the lab twin of lab 2 (lab 1's pool and CPU, load.js, stress.js, sweep.sh, the page's commands)
  ...(() => {
    const L2 = H + "2/code/", page = H + "2/index.md", load = L2 + "load/load.js", stress = L2 + "load/stress.js", sweep = L2 + "scripts/sweep.sh";
    return [
      { key: "pool", value: 10, lab: H + "1/code/services/catalog/src/main/resources/application.yaml", read: num(/maximum-pool-size:\s*\$\{DB_POOL_SIZE:(\d+)\}/) },
      { key: "bigPool", value: 30, lab: page, read: num(/DB_POOL_SIZE=(\d+) docker compose up -d catalog/) },
      { key: "threads", value: 200, lab: page, read: num(/`server\.tomcat\.threads\.max` = (\d+)/) },
      { key: "cpus", value: 1, lab: H + "1/code/docker-compose.yaml", read: num(/cpus:\s*"([\d.]+)"/) },
      { key: "listShare", value: 0.2, lab: load, read: num(/LIST_SHARE \|\| ([\d.]+)\)/) },
      { key: "rates", value: "50 100 200 300 400 500 600", lab: page, read: t => { const m = t.match(/bash scripts\/sweep\.sh ([\d ]+)\n/); return m ? m[1].trim() : undefined; } },
      { key: "warmup", value: 30, unit: "s", lab: sweep, read: num(/-e DURATION=(\d+)s load\/load\.js/) },
      { key: "duration", value: 60, unit: "s", lab: sweep, read: has(/DURATION=\$\{DURATION:-1m\}/, 60) },
      { key: "pause", value: 10, unit: "s", lab: sweep, read: num(/sleep (\d+)/) },
      { key: "preMin", value: 20, lab: load, read: num(/preAllocatedVUs: Math\.max\((\d+), RATE\)/) },
      { key: "maxMin", value: 200, lab: load, read: num(/maxVUs: Math\.max\((\d+), RATE \* \d+\)/) },
      { key: "maxMult", value: 10, lab: load, read: num(/maxVUs: Math\.max\(\d+, RATE \* (\d+)\)/) },
      { key: "peak", value: 600, unit: "req/s", lab: stress, read: num(/PEAK \|\| (\d+)\)/) },
      { key: "stressVUs", value: 2000, lab: stress, read: num(/maxVUs: (\d+)/) },
      { key: "stressTimeout", value: 10, unit: "s", lab: stress, read: num(/timeout: '(\d+)s'/) },
      { key: "stages", value: "0.25/30 0.25/30 0.5/30 0.5/30 0.75/30 0.75/30 1/30 1/60 0.25/15 0.25/60", lab: stress,
        read: t => [...t.matchAll(/step\(([\d.]+), '(\d+)(s|m)'\)/g)].map(m => `${+m[1]}/${+m[2] * (m[3] === "m" ? 60 : 1)}`).join(" ") || undefined },
    ].map(e => ({ sim: "catalog-sweep", ...e }));
  })(),

  // hands-on/8: the lab twin of "Fire it" (slo-catalog.yaml, the page's k6 command, the export interval, step 2's stress test)
  ...(() => {
    const rule = H + "8/code/infra/grafana/alerting/slo-catalog.yaml", slo = H + "8/slo/index.md", dash = H + "8/dashboard/index.md";
    const stress = H + "2/code/load/stress.js";
    const nth = (re, i) => t => [...t.matchAll(re)].map(m => +m[1])[i];
    const range = i => nth(/relativeTimeRange: \{ from: (\d+), to: 0 \}/g, i);
    const forS = i => t => { const v = [...t.matchAll(/^\s*for: (\d+)(s|m)$/gm)][i]; return v ? +v[1] * (v[2] === "m" ? 60 : 1) : undefined; };
    return [
      { key: "budget", value: 0.005, lab: rule, read: num(/\) \/ ([\d.]+)\n/) },
      { key: "fastBurn", value: 14.4, lab: rule, read: nth(/expression: "\$A > ([\d.]+) && \$B > [\d.]+"/g, 0) },
      { key: "slowBurn", value: 6, lab: rule, read: nth(/expression: "\$A > ([\d.]+) && \$B > [\d.]+"/g, 1) },
      { key: "fastLong", value: 3600, unit: "s", lab: rule, read: range(0) },
      { key: "fastShort", value: 300, unit: "s", lab: rule, read: range(1) },
      { key: "slowLong", value: 21600, unit: "s", lab: rule, read: range(2) },
      { key: "slowShort", value: 1800, unit: "s", lab: rule, read: range(3) },
      { key: "fastFor", value: 60, unit: "s", lab: rule, read: forS(0) },
      { key: "slowFor", value: 300, unit: "s", lab: rule, read: forS(1) },
      { key: "interval", value: 30, unit: "s", lab: rule, read: num(/^\s*interval: (\d+)s$/m) },
      { key: "rate", value: 50, unit: "req/s", lab: slo, read: num(/k6 run -e RATE=(\d+) -e DURATION=15m load\/catalog-otel\.js &/) },
      { key: "exportS", value: 10, unit: "s", lab: H + "8/code/docker-compose.yaml", read: t => (num(/OTEL_METRIC_EXPORT_INTERVAL: "(\d+)"/)(t) ?? NaN) / 1000 },
      { key: "peak", value: 600, unit: "req/s", lab: dash, read: num(/-e PEAK=(\d+) load\/stress\.js/) },
      { key: "gwMax", value: 320, unit: "req/s", lab: dash, read: num(/about 95% CPU at about (\d+) req\/s/) },
      { key: "startRate", value: 10, unit: "req/s", lab: stress, read: num(/startRate: (\d+),/) },
      { key: "stages", value: "0.25/30 0.25/30 0.5/30 0.5/30 0.75/30 0.75/30 1/30 1/60 0.25/15 0.25/60", lab: stress,
        read: t => [...t.matchAll(/step\(([\d.]+), '(\d+)(s|m)'\)/g)].map(m => `${+m[1]}/${+m[2] * (m[3] === "m" ? 60 : 1)}`).join(" ") || undefined },
    ].map(e => ({ sim: "catalog-slo-alert", ...e }));
  })(),

  // hands-on/11: the lab twin of the canary (catalog-rollout.yaml, catalog-analysis.yaml, prometheus.yaml, lab 10's HPA, probes and k6)
  ...(() => {
    const L11 = H + "11/code/", ro = L11 + "k8s/overlays/gitops/catalog-rollout.yaml", an = L11 + "k8s/overlays/gitops/catalog-analysis.yaml";
    const canary = H + "11/canary/index.md", dep = H + "10/code/k8s/base/catalog.yaml";
    const nth = (re, i) => t => [...t.matchAll(re)].map(m => +m[1])[i];
    const period = name => num(new RegExp(name + ":[^\\n]*\\n\\s+httpGet:[^\\n]*\\n\\s+periodSeconds:\\s*(\\d+)"));
    return [
      { key: "weight1", value: 25, unit: "%", lab: ro, read: nth(/setWeight: (\d+)/g, 0) },
      { key: "weight2", value: 50, unit: "%", lab: ro, read: nth(/setWeight: (\d+)/g, 1) },
      { key: "pause", value: 120, unit: "s", lab: ro, read: t => (num(/pause: \{ duration: (\d+)m \}/)(t) ?? NaN) * 60 },
      { key: "interval", value: 30, unit: "s", lab: an, read: num(/interval: (\d+)s/) },
      { key: "failureLimit", value: 1, lab: an, read: num(/failureLimit: (\d+)/) },
      { key: "maxError", value: 0.01, lab: an, read: nth(/result\[0\] < ([\d.]+)/g, 0) },
      { key: "maxP99", value: 0.5, unit: "s", lab: an, read: nth(/result\[0\] < ([\d.]+)/g, 1) },
      { key: "window", value: 60, unit: "s", lab: an, read: t => (num(/\[(\d+)m\]\)\)/)(t) ?? NaN) * 60 },
      { key: "scrape", value: 15, unit: "s", lab: L11 + "k8s/monitoring/prometheus.yaml", read: num(/scrape_interval: (\d+)s/) },
      { key: "replicas", value: 2, lab: H + "10/code/k8s/base/catalog-hpa.yaml", read: num(/minReplicas:\s*(\d+)/) },
      { key: "chaos", attr: "chaos", value: 0.3, lab: canary, read: num(/name: CHAOS_ERROR_RATE, value: "([\d.]+)"/) },
      { key: "readinessPeriod", value: 5, unit: "s", lab: dep, read: period("readinessProbe") },
      { key: "livenessPeriod", value: 10, unit: "s", lab: dep, read: period("livenessProbe") },
      { key: "startRate", attr: "rate", value: 20, unit: "req/s", lab: H + "10/code/load/catalog-hpa.js", read: num(/startRate: (\d+),/) },
      { key: "peak", value: 40, unit: "req/s", lab: canary, read: num(/k6 run -e PEAK=(\d+) load\/catalog-hpa\.js &/) },
      { key: "sleepMs", value: 400, unit: "ms", lab: H + "11/performance-gate/index.md", read: num(/try \{ Thread\.sleep\((\d+)\); \}/) },
    ].map(e => ({ sim: "canary-analysis", ...e }));
  })(),

  // classes/ai-systems (RAG & Memory): lab 12 retrieves the top RETRIEVE_K events
  { sim: "rag-hybrid", key: "k", attr: "k", value: 5,
    lab: H + "12/code/services/assistant/app/config.py", read: num(/"RETRIEVE_K", "(\d+)"/) },

  // hands-on/12: the lab twin of the assistant (config.py, the compose service, the model tag)
  ...(() => {
    const cfg = H + "12/code/services/assistant/app/config.py", compose = H + "12/code/docker-compose.yaml";
    return [
      { key: "maxSteps", value: 4, lab: cfg, read: num(/"MAX_STEPS", "(\d+)"/) },
      { key: "k", value: 5, lab: cfg, read: num(/"RETRIEVE_K", "(\d+)"/) },
      { key: "maxInputChars", value: 2000, lab: cfg, read: num(/"MAX_INPUT_CHARS", "(\d+)"/) },
      { key: "model", value: "qwen2.5:1.5b", lab: compose, read: t => (t.match(/LOCAL_MODEL: ollama_chat\/\$\{LOCAL_MODEL_TAG:-([\w.:-]+)\}/) || [])[1] },
      { key: "port", value: 8088, lab: compose, read: num(/- "(\d+):8088"/) },
    ].map(e => ({ sim: "assistant-lab", ...e }));
  })(),
];
