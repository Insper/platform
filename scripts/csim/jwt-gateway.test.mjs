import { readFileSync } from "node:fs";
import { createHmac, createHash } from "node:crypto";
import path from "node:path";
import { load, test, eq, ok, tipHas, ROOT } from "./lib.mjs";

const M = load("jwt-gateway");
const LAB = "docs/2026.2/hands-on/3";
const read = f => readFileSync(path.join(ROOT, LAB, f), "utf8");
const statuses = r => r.out.filter(x => x.status).map(x => x.status);

test("SHA-256 and HMAC agree with node:crypto", () => {
  for (const s of ["", "abc", "123@321", "x".repeat(200)]) eq(M.b64(M.sha256(M.utf8(s))), createHash("sha256").update(s).digest("base64"), `sha256(${s.slice(0, 8)})`);
  const key = Buffer.from(M.KEYS.default, "base64");
  eq(M.b64(M.hmac([...key], M.utf8("a.b")), true), createHmac("sha256", key).update("a.b").digest("base64url"), "hmac");
});

test("the lab's values: cookie name, open routes, routes, duration, default key", () => {
  ok(read("jwt/index.md").includes(`AUTH_COOKIE_TOKEN = "${M.COOKIE}"`), "AuthController's cookie name");
  const auth = read("authorization/index.md");
  const open = auth.match(/openApiEndpoints = List\.of\(([\s\S]*?)\);/)[1].match(/"([^"]+)"/g).map(s => s.slice(1, -1));
  eq(open, M.OPEN, "RouterValidator's open routes");
  ok(auth.includes(`AUTH_COOKIE_TOKEN = "${M.COOKIE}"`), "AuthorizationFilter's cookie name");
  for (const r of M.ROUTES) ok(new RegExp(`id: ${r.id}\\n\\s+uri: ${r.uri}\\n\\s+predicates:\\n\\s+- Path=${r.path.replace(/\*/g, "\\*")}`).test(auth), `route ${r.id}`);
  const yaml = read("open-routes/index.md");
  ok(yaml.includes(`secretKey: \${JWT_SECRET_KEY:${M.KEYS.default}}`), "the default key of application.yaml");
  ok(yaml.includes(`duration: \${JWT_DURATION:${M.DURATION}}`), "store.jwt.duration");
  ok(yaml.includes(`.issuer("${M.ISSUER}")`), "JwtService's issuer");
  eq(Buffer.from(M.KEYS.own, "base64").length, 32, "own key: 32 bytes");
});

test("the first login issues the example token of the JWT page, byte for byte", () => {
  const page = read("jwt/index.md");
  const block = page.match(/!!! example "Example JWT"\s+```\s+([\s\S]*?)```/)[1].replace(/\s+/g, "");
  const r = M.play("test");
  eq(r.out[1].token, block, "token");
  const d = M.decode(block);
  eq(d.header, { alg: "HS256" }, "header");
  const shown = JSON.parse(page.match(/=== "Payload \(Claims\)"\s+```json\s+([\s\S]*?)```/)[1]);
  eq(d.payload, shown, "the payload tab");
  eq(d.payload.exp - d.payload.nbf, M.DURATION / 1000, "exp = nbf + duration");
  eq(M.getId(block, "default", M.T0).id, M.USERS.antonio.id, "valid under the default key");
});

test("RouterValidator.isSecured, as the Java predicate", () => {
  eq(["POST /auth/register", "POST /auth/login", "GET /auth/logout"].map(x => M.isSecured(...x.split(" "))), [false, false, false], "open");
  eq(["GET /auth/login", "POST /auth/logout", "GET /accounts", "GET /auth/me", "POST /auth/solve"].map(x => M.isSecured(...x.split(" "))), [true, true, true, true, true], "secured");
});

test("Authorization section 5: register 200, login 200, with cookie 200, without 401", () => {
  const r = M.play("test");
  eq(statuses(r), [200, 200, 200, 401], "statuses");
  const page = read("authorization/index.md");
  for (const c of ["curl -c cookies.txt -X POST http://localhost:8080/auth/login", "curl -b cookies.txt http://localhost:8080/accounts", "curl http://localhost:8080/accounts"]) ok(page.includes(c), `the page runs ${c}`);
  ok(r.out[1].out[0].includes(`Set-Cookie: ${M.COOKIE}=`) && /HttpOnly/.test(r.out[1].out[0]) && /SameSite=None/.test(r.out[1].out[0]) && /Secure/.test(r.out[1].out[0]), "cookie flags");
  eq(JSON.parse(r.out[2].out[0]), [{ id: M.USERS.antonio.id, name: "Antonio do Estudo", email: "acme@insper.edu.br" }], "GET /accounts");
});

test("bad tokens: each case ends where the pages say", () => {
  const r = M.play("tokens");
  const s = r.out.filter(x => x.status);
  eq(s.map(x => x.status), [200, 200, 401, 200, 200, 200, 401, 200, 401, 200, 200, 401, 401, 200, 200, 401], "statuses");
  ok(/not 500/.test(s[2].note[0]), "wrong password: 401, not 500");
  eq(JSON.parse(s[5].out[0]).name, "Antonio do Estudo", "a forged id-account header is dropped");
  ok(s[5].trace.some(h => /RemoveRequestHeader/.test(h.en)), "RemoveRequestHeader");
  ok(s[6].trace.some(h => /SignatureException/.test(h.en)), "edited payload: SignatureException");
  eq([JSON.parse(s[7].out[0]).name, s[7].tone], ["Ana", "bad"], "forged with the public default key: accepted");
  ok(s[8].trace.some(h => /SignatureException/.test(h.en)), "own key: the forgery fails");
  ok(s[11].trace.some(h => /no cookie/.test(h.en)) && /Max-Age/.test(s[11].note[0]), "after the Max-Age curl drops the cookie");
  ok(s[12].trace.some(h => /ExpiredJwtException/.test(h.en)), "the same token by hand: ExpiredJwtException");
  ok(/Max-Age=0/.test(s[14].out[0]), "logout clears the cookie");
});

test("a duplicate e-mail is a 500 (the column is UNIQUE)", () => {
  const st = M.create();
  M.register(st, "antonio");
  eq(M.register(st, "antonio").status, 500, "second register");
  ok(readFileSync(path.join(ROOT, "docs/2026.2/hands-on/1/repository/code/V2026.08.24.002__create_table.sql"), "utf8").includes("email VARCHAR(256) NOT NULL UNIQUE"), "the schema of hands-on 1");
});

test("the gateway's health check needs no cookie; an unknown path is 404", () => {
  const st = M.create();
  eq(M.get(st, "/health-check", "none").status, 200, "health-check");
  eq(M.get(st, "/orders", "none").status, 404, "no route");
});

test("every step of every script has a caption in both languages", () => {
  for (const [name, steps] of Object.entries(M.SCRIPTS)) steps.forEach((s, i) => ok(s.en && s.pt, `${name} step ${i + 1}`));
});

test("the tips", () => {
  const exp = M.clock(M.T0 + M.DURATION / 1000);
  tipHas("jwt-gateway", lang => lang === "en"
    ? ["exactly the example token", "200, 200, 200 and 401", `until ${exp}`, "3600 s", "200 as Ana"]
    : ["exatamente o token de exemplo", "200, 200, 200 e 401", `até ${exp}`, "3600 s", "200 como Ana"]);
});
