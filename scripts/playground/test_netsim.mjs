#!/usr/bin/env node
/*
 * Tests of the network simulators (docs/assets/javascripts/netsim.js), no browser needed:
 *
 *     node scripts/playground/test_netsim.mjs
 *
 * They check the CIDR arithmetic, the kinds of address, longest-prefix match, and that each
 * packet-walk scenario ends where the class pages say it does (delivered or dropped, and why),
 * also after each switch changes the network.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const N = require(path.join(here, "../../docs/assets/javascripts/netsim.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok   " + name); }
  catch (err) { failed++; console.log("  FAIL " + name + "\n       " + (err && err.message || err)); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }

function end(scenario, opts) {
  const steps = N.walk(N.buildModel(opts), scenario);
  const last = steps[steps.length - 1];
  return { status: last.status, msg: last.msg, node: last.node, steps };
}

test("CIDR facts of the BoxOffice VPC", () => {
  const d = N.describe("10.20.0.0/16");
  eq([N.ipStr(d.network), d.size, d.aws, N.ipStr(d.mask), N.ipStr(d.last)], ["10.20.0.0", 65536, 65531, "255.255.0.0", "10.20.255.255"], "/16");
  const a = N.describe("10.20.32.0/19");
  eq([a.size, a.aws, N.ipStr(a.lastHost)], [8192, 8187, "10.20.63.254"], "/19");
  eq(N.describe("10.20.40.17/19").hostBitsSet, true, "host bits");
  eq([N.describe("10.0.0.0/31").usable, N.describe("10.0.0.1/32").usable], [2, 1], "/31 and /32");
});

test("splitting a block", () => {
  eq(N.split("10.20.0.0/16", 2), ["10.20.0.0/18", "10.20.64.0/18", "10.20.128.0/18", "10.20.192.0/18"], "4 subnets");
});

test("kinds of address", () => {
  const k = ip => N.kindOf(N.parseIp(ip)).kind;
  eq(["10.20.40.17", "172.31.255.1", "172.32.0.1", "192.168.0.12", "100.64.7.9", "127.0.0.1", "169.254.169.254", "203.0.113.10", "8.8.8.8"].map(k),
    ["private", "private", "public", "private", "cgnat", "loopback", "linklocal", "doc", "public"], "kinds");
});

test("longest prefix match beats the default route", () => {
  const t = [{ dst: "0.0.0.0/0" }, { dst: "10.20.0.0/16" }, { dst: "10.20.32.0/19" }];
  eq([N.lookup(t, N.parseIp("10.20.40.17")), N.lookup(t, N.parseIp("10.20.8.10")), N.lookup(t, N.parseIp("8.8.8.8"))], [2, 1, 0], "matches");
});

test("a fan reaches the site and the ALB reaches order", () => {
  const r = end("fan-site");
  eq([r.status, r.msg, r.node], ["ok", "sgAllow", "order"], "end");
  eq(r.steps.some(s => s.msg === "homeNat") && r.steps.some(s => s.msg === "igwIn"), true, "home NAT and IGW 1:1 NAT");
});
test("without a public IP on the ALB, the site is unreachable", () => {
  eq(end("fan-site", { albPublic: false }).msg, "igwNobody", "end");
});
test("payment reaches the provider through the NAT and gets the reply", () => {
  const r = end("pay-psp");
  eq([r.status, r.msg, r.node], ["ok", "replyArrives", "payment"], "end");
  eq(r.steps.find(s => s.msg === "allowOk").pkt.src, "203.0.113.20", "provider sees the Elastic IP");
});
test("without the NAT route, payment cannot leave the VPC", () => {
  eq([end("pay-psp", { nat: false }).status, end("pay-psp", { nat: false }).msg], ["drop", "noRoute"], "end");
});
test("a private address is not routed on the Internet", () => {
  eq([end("fan-pod").status, end("fan-pod").msg], ["drop", "netNoRoute"], "end");
});
test("order reaches PostgreSQL only with the sg-data rule", () => {
  eq(end("order-db").msg, "sgAllow", "with the rule");
  eq(end("order-db", { dbRule: false }).msg, "sgDeny", "without the rule");
});
test("the isolated subnet has no way out", () => {
  eq(end("db-update").msg, "noRoute", "end");
});
test("a NAT does not accept inbound connections", () => {
  eq(end("scan-nat").msg, "natNoEntry", "end");
});
test("the ALB's security group stops a scan on 5432", () => {
  eq([end("scan-alb").msg, end("scan-alb").node], ["sgDeny", "alb"], "end");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
