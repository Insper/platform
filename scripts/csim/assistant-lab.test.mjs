import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, ROOT } from "./lib.mjs";

const M = load("assistant-lab");
const LAB = "docs/2027.1/hands-on/12/";
const read = f => readFileSync(path.join(ROOT, LAB, f), "utf8");

test("the guards are guardrails.py's patterns", () => {
  const py = read("code/services/assistant/app/guardrails.py");
  const inj = py.match(/INJECTION = re\.compile\(\n([\s\S]*?)\n\s*re\.IGNORECASE/)[1];
  const src = [...inj.matchAll(/r"([^"]*)"/g)].map(m => m[1]).join("");
  eq(M.INJECTION.source, src, "INJECTION");
  const pii = [...py.matchAll(/\(re\.compile\(r"([^"]+)"\), "(\[\w+\])"\)/g)].map(m => [m[1], m[2]]);
  eq(M.PII.map(p => [p[0].source, p[1]]), pii, "PII patterns and labels, in order");
  ok(py.includes('"I can only help with BoxOffice events, tickets and orders."'), "the blocked message");
});

test("guards page: 422 for the injection, redaction of CPF, card and e-mail", () => {
  const page = read("guardrails/index.md");
  const g = M.play("guards");
  ok(page.includes(g[0].out[0]), "the page's 422 body: " + g[0].out[0]);
  eq(g[1].out[0], "my CPF is [CPF] and card [CARD], mail [EMAIL]", "redaction");
  ok(page.includes("You should see `" + g[1].out[0] + "`"), "the page's redaction output");
  ok(page.includes(M.Q.injection), "the page's injection");
  eq(M.request({ q: "long" }).blocked, "too_long", "2,001 characters");
});

test("ask: the page's test run, retrieval and done JSON", () => {
  const page = read("tools/index.md");
  const json = JSON.parse(page.match(/``` json\n(\{[\s\S]*?\})\n```/)[1]);
  const r = M.request({ q: "festival", model: "page" });
  eq(r.done, json, "the done event");
  eq([r.calls, r.tools], [1, []], "retrieval first: no tool call");
  ok(page.includes(M.Q.festival), "the question");
  const cites = M.request({ q: "festival", model: "cites" }).done, inv = M.request({ q: "festival", model: "invents" }).done;
  eq([cites.grounded, cites.citations], [true, ["event:50"]], "a citation it received");
  eq([inv.grounded, inv.answer.includes("[unverified]")], [false, true], "an invented citation");
});

test("order: identity from the header, the same answer for another fan's order", () => {
  const page = read("tools/index.md");
  const [ana, bob, none, skip] = M.SCRIPTS.order.map(r => M.request(r));
  eq(ana.tools, ["get_order_status"], "the tool"); ok(page.includes('`["get_order_status"]`'), "the page's .tools");
  ok(ana.stages.some(s => s.out[0].includes("PENDING_PAYMENT")), "PENDING_PAYMENT"); ok(page.includes("PENDING_PAYMENT"), "the page's status");
  ok(bob.stages.some(s => s.out[0].includes('"error":"order not found"')) && page.includes("the tool answers `order not found`"), "order not found");
  ok(none.stages.some(s => s.out[0].includes("not logged in")), "no header: log in");
  eq(skip.tools, [], "the model skipped the tool"); ok(page.includes("did in 6 of 9 tries"), "the page's 6 of 9");
  ok(M.Q.order.includes(M.ORDER_ID) && M.ORDER_ID.length === 36, "a 36-character order id (GetOrderStatusArgs)");
});

test("budget: MAX_STEPS calls, the last one without tools", () => {
  const r = M.request({ q: "festival", model: "loops" });
  eq([r.calls, r.tools.length], [M.LAB.maxSteps, M.LAB.maxSteps - 1], "4 calls, 3 tool rounds");
  ok(r.stages.filter(s => s.stage === "llm").pop().out[0].includes("(no tools)"), "the last call offers no tools");
  ok(read("tools/index.md").includes("At most `MAX_STEPS` (4) model calls; the last one is made **without tools**"), "the page says so");
});

test("every stage has a caption in both languages", () => {
  for (const name of Object.keys(M.SCRIPTS)) M.play(name).forEach((s, i) => ok(s.en && s.pt, `${name} stage ${i + 1}`));
});

test("the tips", () => {
  tipHas("assistant-lab", lang => [
    "grounded: false", "event:50", "[unverified]", "422", "order not found", `MAX_STEPS = ${M.LAB.maxSteps}`,
    lang === "en" ? "the last one without tools" : "a última sem ferramentas"
  ]);
});
