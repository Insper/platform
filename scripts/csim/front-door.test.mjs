import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, ROOT } from "./lib.mjs";

const M = load("front-door");
const LAB = "docs/2027.1/hands-on/4";
const read = f => readFileSync(path.join(ROOT, LAB, f), "utf8");
const statuses = r => r.out.filter(x => x.status).map(x => x.status);

test("the replicas are services of the lab's compose file and instances of lb://catalog", () => {
  const compose = read("code/docker-compose.yaml"), gw = read("code/services/gateway/src/main/resources/application.yaml");
  for (const n of M.REPLICAS) {
    ok(new RegExp(`^  ${n}:`, "m").test(compose), `docker-compose.yaml has no service ${n}`);
    ok(gw.includes(`uri: http://${n}:${M.LAB.catalogPort}`), `the gateway does not list ${n}`);
  }
});

test("the rules are SecurityConfig's, in the same order", () => {
  const sec = read("code/services/gateway/src/main/java/boxoffice/gateway/SecurityConfig.java");
  const order = ['"/auth/register", "/auth/login", "/auth/.well-known/**").permitAll()', 'HttpMethod.GET, "/catalog/**").permitAll()',
    '"/catalog/**").hasAuthority("SCOPE_admin")', '"/actuator/**").permitAll()', ".anyExchange().authenticated()"];
  let at = -1;
  for (const r of order) { const i = sec.indexOf(r); ok(i > at, `SecurityConfig: "${r}" missing or out of order`); at = i; }
  const filter = read("code/services/gateway/src/main/java/boxoffice/gateway/UserHeadersFilter.java");
  for (const h of ["X-User-Id", "X-User-Email", "X-User-Scope"]) ok(filter.includes(`h.remove("${h}")`), `UserHeadersFilter does not strip ${h}`);
});

test("curl: the session of the lab page, and one JWKS download", () => {
  const r = M.play("curl");
  eq(statuses(r), [201, 200, 200, 401, 403, 200, 200, 200, 200, 200], "statuses");
  const page = read("index.md");
  ok(page.includes("localhost/auth/me\n401") && page.includes("-H \"Authorization: Bearer $TOKEN\"\n403"), "the page shows 401 and 403");
  eq(r.out.filter(x => x.status).map(x => x.by), ["auth", "auth", "auth", "gateway", "gateway", "auth", "catalog-1", "catalog-2", "catalog-3", "catalog-1"], "who answered");
  eq(r.st.gw.fetches, 1, "JWKS downloads");
  eq(r.st.rejected, 2, "rejected before the services");
});

test("the first token is the decoded payload of the auth page", () => {
  const st = M.create();
  M.register(st);
  M.login(st, "ana");
  const tok = st.tokens.ana, page = read("auth/index.md");
  for (const [k, v] of Object.entries({ iss: tok.iss, aud: tok.aud, sub: tok.sub, scope: tok.scope, iat: tok.iat, exp: tok.exp }))
    ok(page.includes(`"${k}": ${typeof v === "number" ? v : `"${v}"`}`), `auth page: ${k}`);
  eq(tok.exp - tok.iat, M.LAB.ttl, "JWT_TTL");
});

test("tokens: spoofing, a forged payload, a new key pair, the clock skew", () => {
  const r = M.play("tokens");
  eq(statuses(r), [201, 200, 200, 200, 401, 401, 401, 200, 200, 200, 401, 200, 401], "statuses");
  const spoof = r.out[3];
  ok(spoof.out.join("").includes('"name":"Ana"'), "the forged X-User-Id is replaced by Ana's id");
  eq(r.out.filter(x => x.status === 401 && x.by === "gateway").length, 5, "five 401s from the gateway");
  ok(r.out[9].note[0].includes("previous key pair"), "the admin's old token passes right after the restart");
  ok(r.out[12].note[0].includes("no key in the JWKS has kid"), "and fails once the gateway downloaded the new JWKS");
  ok(r.out[14].note[0].includes("clock skew"), "past exp, within the skew");
  ok(r.out[16].note[0].includes("expired"), "expired for good");
  eq(r.st.gw.fetches, 3, "JWKS downloads: first token, the new kid, the old kid");
});

test("a wrong password is a 401 from auth, the same for an unknown e-mail", () => {
  const st = M.create();
  const unknown = M.login(st, "ana");
  M.register(st);
  const wrong = M.login(st, "ana", true);
  eq([unknown.status, unknown.by, wrong.status, wrong.by], [401, "auth", 401, "auth"], "statuses");
  eq(unknown.out, wrong.out, "same answer");
});

test("edge: /actuator, a stopped replica, the rate limit", () => {
  const r = M.play("edge");
  eq([r.out[0].status, r.out[0].by, r.out[1].status, r.out[1].by], [404, "edge", 200, "gateway"], "/actuator through :80 and :8080");
  const gets = r.out.filter(x => x.method === "GET" && x.path === "/catalog/events/1");
  eq(gets.map(x => x.status), [200, 200, 200, 200, 200], "every GET answered");
  eq(gets.filter(x => x.note[0].includes("retried")).length, 1, "one retry while catalog-2 is still listed");
  ok(gets.slice(3).every(x => x.by !== "catalog-2"), "skipped after the probe");
  const b = r.out.filter(x => x.ok !== undefined);
  eq(b.map(x => [x.ok, x.limited]), [[1 + M.LAB.burst, 50 - 1 - M.LAB.burst], [50, 0]], "burst with and without X-Api-Key");
});

test("a PUT that lands on a stopped, still-listed replica is not retried", () => {
  const st = M.create();
  M.register(st); M.login(st, "admin");
  M.stopReplica(st, "catalog-1", false);
  const r = M.request(st, "PUT", "/catalog/events/2", "admin");
  eq([r.status, r.by], [500, "gateway"], "500, no retry");
});

test("every step of every script has a caption in both languages", () => {
  for (const [name, steps] of Object.entries(M.SCRIPTS)) steps.forEach((s, i) => ok(s.en && s.pt, `${name} step ${i + 1}`));
});

test("the tips", () => {
  const r = M.play("edge"), b = r.out.filter(x => x.ok !== undefined)[0];
  tipHas("front-door", lang => lang === "en"
    ? ["201, 200, 200, 401, 403", "one JWKS download", `${b.ok} pass and ${b.limited} get 429`, "60 s"]
    : ["201, 200, 200, 401, 403", "um download do JWKS", `${b.ok} passam e ${b.limited} recebem 429`, "60 s"]);
});
