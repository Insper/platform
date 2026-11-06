import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, ROOT } from "./lib.mjs";

const M = load("gateway-routes");
const LAB = "docs/2026.2/hands-on/2";
const read = f => readFileSync(path.join(ROOT, LAB, f), "utf8");

test("the routes are those of application.yaml, in order", () => {
  const yaml = read("code/application.yaml");
  const routes = [...yaml.matchAll(/- id: (\S+)\s+uri: (\S+)\s+predicates:\s+- Path=(\S+)/g)].map(m => ({ id: m[1], uri: m[2], path: m[3] }));
  eq(M.ROUTES, routes, "routes");
  ok(yaml.includes(`allowedOrigins: \${CORS_ALLOWED_ORIGINS:${M.ORIGINS.join(",")}}`), "the default origins");
  ok(yaml.includes(`- RemoveRequestHeader=${M.REMOVED}`), "the removed header");
  ok(/server:\s+webflux:/.test(yaml), "under spring.cloud.gateway.server.webflux");
});

test("the gateway's own endpoint is GatewayResource's", () => {
  ok(read("code/GatewayResource.java").includes(`@GetMapping("${M.OWN.path}")`), "GET /health-check");
});

test("compose.yaml: only the gateway publishes a port", () => {
  const compose = read("code/compose.yaml");
  const block = name => compose.split(new RegExp(`^  ${name}:`, "m"))[1].split(/^  \w+:/m)[0];
  ok(!/ports:/.test(block("account")), "account has no ports");
  ok(block("gateway").includes(`- ${M.PORT}:8080`), "gateway publishes 8080");
  ok(M.ROUTES.some(r => r.uri === "http://account:8080"), "the route uses the service name");
});

test("Path predicates: a pattern, not a prefix", () => {
  eq(["/accounts", "/accounts/", "/accounts/1/x", "/account", "/accountsX"].map(p => M.matches("/accounts/**", p)), [true, true, true, false, false], "/accounts/**");
});

test("run and verify, step by step", () => {
  const r = M.play("verify");
  eq(r.out.map(x => x.status), [200, 200, 200, null, 404, 200, 200, 403, 500, null], "statuses");
  eq(r.out[0].body, `{"hostname":"${M.HOSTNAME}"}`, "health-check body");
  eq(r.out[1].forward, "http://account:8080/accounts", "forwarded to account");
  eq(r.out[3].forward, "https://www.insper.edu.br/insper", "the whole path goes on");
  eq(r.out[5].removed, M.REMOVED, "id-account removed");
  eq(r.out[6].headers["Access-Control-Allow-Origin"], "http://localhost:3000", "allowed origin echoed");
  ok(r.out[9].err.includes("Could not resolve host: account"), "account is not reachable from the host");
  ok(read("index.md").includes(`{"hostname":"${M.HOSTNAME}"}`), "the page shows the same body");
});

test("every step of the script has a caption in both languages", () => {
  for (const [name, steps] of Object.entries(M.SCRIPTS)) steps.forEach((s, i) => ok(s.en && s.pt, `${name} step ${i + 1}`));
});

test("the tips", () => {
  const r = M.play("verify"), st = r.out.map(x => x.status);
  tipHas("gateway-routes", lang => lang === "en"
    ? [`${M.ROUTES.length} routes`, `/account gets ${st[4]}`, `evil.example gets ${st[7]}`, `the same request gets ${st[8]}`, "https://www.insper.edu.br/insper"]
    : [`${M.ROUTES.length} rotas`, `/account recebe ${st[4]}`, `evil.example recebe ${st[7]}`, `a mesma requisição recebe ${st[8]}`, "https://www.insper.edu.br/insper"]);
});
