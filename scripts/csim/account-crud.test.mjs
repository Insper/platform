import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { load, test, eq, ok, tipHas, ROOT } from "./lib.mjs";

const M = load("account-crud");
const LAB = "docs/2026.2/hands-on/1";
const read = f => readFileSync(path.join(ROOT, LAB, f), "utf8");
const statuses = r => r.out.map(x => x.status);

test("the endpoints are the mappings of AccountController.java", () => {
  const src = read("controller/code/AccountController.java");
  const found = [...src.matchAll(/@(Post|Get|Delete|Put)Mapping\("([^"]+)"\)\s*public ResponseEntity<[^>]*>+ (\w+)\(/g)]
    .map(m => ({ method: m[1].toUpperCase(), path: m[2], fn: m[3] }));
  eq(M.ENDPOINTS, found, "endpoints");
  ok(!/PutMapping/.test(src), "the lab has no update endpoint");
});

test("the checks are those of AccountService.java", () => {
  const src = read("repository/code/AccountService.java");
  for (const reason of Object.values(M.REASONS)) ok(src.includes(`"${reason}"`), `AccountService has no "${reason}"`);
  ok(src.includes(`pass.length() < ${M.MIN_PASSWORD}`), "minimum password length");
  ok(/MessageDigest\.getInstance\("SHA-256"\)/.test(src) && src.includes("Base64.getEncoder()"), "SHA-256 in Base64");
});

test("the hash is SHA-256 in Base64 of the trimmed password", () => {
  for (const p of ["123@321", "segredo42", "ção€", ""]) eq(M.calcHash(p), createHash("sha256").update(p, "utf8").digest("base64"), p);
  const r = M.send(M.create(), "POST", "/accounts", "new");
  ok(r.status === 201, "created");
});

test("the table is the one of the Flyway migrations", () => {
  const schema = read("repository/code/V2026.08.24.001__create_schema.sql");
  const table = read("repository/code/V2026.08.24.002__create_table.sql");
  ok(schema.includes(`CREATE SCHEMA IF NOT EXISTS ${M.TABLE.split(".")[0]}`), "schema");
  ok(table.includes(`CREATE TABLE ${M.TABLE}`), "table");
  eq([...table.matchAll(/^\s+(\w+) VARCHAR/gm)].map(m => m[1]), M.COLUMNS, "columns");
  ok(/name VARCHAR\(256\) NOT NULL,/.test(table) && /email VARCHAR\(256\) NOT NULL UNIQUE/.test(table), "name NOT NULL, email UNIQUE");
  ok(read("containerization/code/compose.yaml").includes(`- ${M.PORT}:8080`), "the published port");
});

test("the lab's endpoints, step by step", () => {
  const r = M.play("endpoints");
  eq(statuses(r), [200, 201, 200, 200, 400, 500, 405, 204, 404, 204], "statuses");
  const created = r.out[1];
  eq(created.headers.Location, `http://localhost:${M.PORT}/accounts/${created.id}`, "Location");
  eq(created.res, "", "201 has no body");
  const fields = [...read("controller/code/AccountOut.java").matchAll(/String (\w+)/g)].map(m => m[1]);
  eq(Object.keys(JSON.parse(r.out[2].res)[0]), fields, "the list has the fields of AccountOut");
  ok(!/password|hash/.test(r.out[2].res + r.out[3].res), "neither password nor hash leaves the service");
  eq(r.out[4].fail, 2, "the short password stops in AccountService");
  ok(r.out[5].log.includes("accounts_email_key"), "the duplicate email stops in the database");
  eq(r.out[5].fail, 4, "…at the database");
  eq(r.st.rows.length, 0, "the table is empty at the end");
});

test("the statuses match the endpoint table of the page", () => {
  const page = read("repository/index.md");
  for (const s of ["`201 Created`", "`200 OK`", "`404 Not Found`", "`204 No Content`", "`400 Bad Request`", "`405 Method Not Allowed`", "`500 Internal Server Error`"])
    ok(page.includes(s), `the page has no ${s}`);
});

test("the gaps: no name is 500 (NOT NULL), no body is 400, no email is 400", () => {
  const st = M.create();
  eq(M.send(st, "POST", "/accounts", "noname").status, 500, "no name");
  eq(M.send(st, "POST", "/accounts", "none").status, 400, "no body");
  const ne = M.send(st, "POST", "/accounts", "noemail");
  eq([ne.status, ne.log.includes(M.REASONS.noemail)], [400, true], "no email");
  eq(M.send(st, "GET", "{unknown}").status, 404, "unknown id");
  eq(M.route("GET", "/accounts/health-check").endpoint.fn, "healthCheck", "literal over {id}");
});

test("every step of the script has a caption in both languages", () => {
  for (const [name, steps] of Object.entries(M.SCRIPTS)) steps.forEach((s, i) => ok(s.en && s.pt, `${name} step ${i + 1}`));
});

test("the tips", () => {
  const r = M.play("endpoints"), [, post, , , short, dup, put, del, , del2] = r.out;
  const noname = M.send(M.create(), "POST", "/accounts", "noname").status;
  tipHas("account-crud", lang => lang === "en"
    ? [`POST returns ${post.status}`, `gets ${short.status}`, `gets ${dup.status}`, `PUT gets ${put.status}`, `DELETE answers ${del.status} even the second time`, `the database refuses it (${noname})`]
    : [`POST devolve ${post.status}`, `recebe ${short.status}`, `recebe ${dup.status}`, `PUT recebe ${put.status}`, `DELETE responde ${del2.status} mesmo na segunda vez`, `o banco recusa (${noname})`]);
});
