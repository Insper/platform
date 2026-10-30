import { load, test, eq, ok, tipHas } from "./lib.mjs";

const N = load("nat");
const P = N.PUBLIC;

/* the tip's sequence, on a fresh router with the page's defaults */
function tipRun() {
  const st = N.create({ timeout: 60 });
  const laptop = N.open(st, "laptop", "web").entry;
  const back = N.reply(st, laptop);
  const phone = N.open(st, "phone", "web").entry;
  const knock = N.knock(st, N.FORWARD.port);
  const filtered = N.knock(st, phone.pubPort);
  st.forward = true;
  const fwd = N.knock(st, N.FORWARD.port);
  let steps = 0;
  while (st.table.length) { N.advance(st, N.STEP); steps++; }
  const late = N.reply(st, phone);
  return { st, laptop, back, phone, knock, filtered, fwd, steps, late };
}
const R = tipRun();

test("an outbound connection writes private ip:port ⇄ public ip:port, ports in sequence", () => {
  eq([R.laptop.pubPort, R.phone.pubPort], [N.FIRST_PORT, N.FIRST_PORT + 1], "public ports");
  ok(R.laptop.inPort >= N.EPH_LO && R.laptop.inPort <= N.EPH_HI, "ephemeral port in Linux's range");
  console.log(`       laptop ${R.laptop.inIp}:${R.laptop.inPort} ⇄ ${P}:${R.laptop.pubPort}; phone ${R.phone.inIp}:${R.phone.inPort} ⇄ ${P}:${R.phone.pubPort}`);
});

test("the reply from the remote end is translated back to the private host", () => {
  eq(R.back.action, "translated", "action");
  eq(R.back.inside.dst, `${R.laptop.inIp}:${R.laptop.inPort}`, "delivered to the laptop");
});

test("unsolicited packets are dropped; a row only accepts its own remote end", () => {
  eq([R.knock.action, R.knock.reason], ["dropped", "no-entry"], "no row");
  eq([R.filtered.action, R.filtered.reason], ["dropped", "filtered"], "wrong source");
});

test("a port-forward rule lets an outside host in", () => {
  eq(R.fwd.action, "forwarded", "action");
  eq(R.fwd.inside.dst, "192.168.1.20:8080", "home server");
});

test("idle rows expire after the timeout and a late reply is dropped; traffic keeps a row alive", () => {
  eq(R.steps * N.STEP, 60, "rows last exactly the timeout");
  eq(R.late.action, "dropped", "late reply");
  const st = N.create({ timeout: 60 });
  const e = N.open(st, "laptop", "web").entry;
  N.advance(st, 50); N.reply(st, e); N.advance(st, 50);
  eq(st.table.length, 1, "a reply restarts the idle timer");
});

test("the tip quotes the model's numbers", () => {
  tipHas("nat", lang => [
    `${R.laptop.inIp}:${R.laptop.inPort} ⇄ ${P}:${R.laptop.pubPort}`,
    lang === "en" ? `the reply to port ${R.laptop.pubPort}` : `a resposta para a porta ${R.laptop.pubPort}`,
    `${R.phone.inIp}:${R.phone.inPort} ⇄ ${P}:${R.phone.pubPort}`,
    lang === "en" ? `the row for ${R.phone.pubPort} only accepts 198.51.100.20:443` : `a linha de ${R.phone.pubPort} só aceita 198.51.100.20:443`,
    `192.168.1.20:8080`,
    lang === "en" ? `each step is ${N.STEP} s, and with the 60 s idle timeout the rows disappear after ${R.steps} steps`
      : `cada passo é ${N.STEP} s, e com o timeout ocioso de 60 s as linhas somem após ${R.steps} passos`
  ]);
});
