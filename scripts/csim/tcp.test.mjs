import { load, test, eq, ok, tipHas, fmt } from "./lib.mjs";

const T = load("tcp");
const run = loss => T.simulate({ loss, seed: 4 });
const r0 = run(0), r10 = run(10), r20 = run(20), r30 = run(30);
const lostIds = r => r.lostFirst.map((x, i) => (x ? i + 1 : 0)).filter(Boolean);

test("without loss both deliver everything; TCP is one round trip later (the handshake)", () => {
  eq([r0.udp.delivered, r0.tcp.delivered, r0.tcp.retrans, r0.tcp.held], [20, 20, 0, 0], "clean run");
  eq(r0.tcp.done - r0.udp.done, 2 * T.DELAY, "handshake = 1 RTT");
});

test("UDP loses what the link loses; TCP delivers all, retransmitting each loss", () => {
  for (const r of [r10, r20, r30]) {
    eq(r.udp.lost, lostIds(r).length, "UDP gaps = first-transmission losses");
    eq(r.tcp.delivered, 20, "TCP delivers all");
    ok(r.tcp.retrans >= r.udp.lost, "at least one retransmission per loss");
  }
});

test("TCP delivers in order: a loss holds back the segments behind it", () => {
  const segs = r10.tcp.segs;
  for (let i = 1; i < segs.length; i++) ok(segs[i].deliver >= segs[i - 1].deliver, "in order");
  const first = lostIds(r10)[0];
  ok(segs.slice(first).some(s => s.deliver > s.arrive), "segments after the loss waited");
  ok(segs.slice(0, first - 1).every(s => s.deliver === s.arrive), "segments before the loss did not wait");
});

test("the retransmission timer doubles: a lost retransmission costs 200 + 400 ms", () => {
  const twice = r20.tcp.segs.find(s => s.tries.length === 3);
  ok(twice, "a segment needed two retransmissions");
  eq([twice.tries[1].at - twice.tries[0].at, twice.tries[2].at - twice.tries[1].at], [T.RTO, 2 * T.RTO], "backoff");
});

test("more loss, longer completion for TCP; UDP's time does not move", () => {
  console.log(`       10%: lost ${lostIds(r10)}, UDP ${r10.udp.delivered}/20 at ${r10.udp.done} ms, TCP ${r10.tcp.retrans} re, ${r10.tcp.held} held, ${r10.tcp.done} ms; 20%: TCP ${r20.tcp.retrans} re, ${r20.tcp.done} ms; 30%: UDP ${r30.udp.delivered}/20, TCP ${r30.tcp.retrans} re, ${r30.tcp.done} ms`);
  ok(r10.tcp.done < r20.tcp.done && r20.tcp.done < r30.tcp.done, "TCP slows down");
  eq([r10.udp.done, r20.udp.done, r30.udp.done].every(d => d === r0.udp.done), true, "UDP's last arrival is fixed");
});

test("stateAt shows held segments while TCP waits for a retransmission", () => {
  const first = lostIds(r10)[0] - 1, seg = r10.tcp.segs[first];
  const x = T.stateAt(r10, seg.arrive - 1);
  ok(x.tcpHeld > 0 && x.tcp[first] !== "got", "segments are held while the lost one is resent");
  eq(T.stateAt(r10, r10.tcp.done).tcpGot, 20, "all delivered at the end");
});

test("the tip quotes the model's numbers", () => {
  const ids = lostIds(r10);
  tipHas("tcp", lang => {
    const ms = x => fmt(x, 0, lang) + " ms";
    return lang === "en" ? [
      `segments ${ids[0]} and ${ids[1]} are lost`,
      `UDP is done at ${ms(r10.udp.done)} with ${r10.udp.delivered}/20 segments`,
      `TCP delivers all 20, in order, at ${ms(r10.tcp.done)}: ${r10.tcp.retrans} retransmissions, and ${r10.tcp.held} segments that had already arrived waited in the buffer behind segment ${ids[0]}`,
      `UDP finishes at ${ms(r0.udp.done)} and TCP at ${ms(r0.tcp.done)} — the ${ms(r0.tcp.done - r0.udp.done)} difference`,
      `${r20.tcp.retrans} retransmissions, done at ${ms(r20.tcp.done)}`,
      `UDP keeps only ${r30.udp.delivered}/20, while TCP needs ${r30.tcp.retrans} retransmissions and ${ms(r30.tcp.done)}`
    ] : [
      `os segmentos ${ids[0]} e ${ids[1]} se perdem`,
      `O UDP termina em ${ms(r10.udp.done)} com ${r10.udp.delivered}/20 segmentos`,
      `O TCP entrega os 20, em ordem, em ${ms(r10.tcp.done)}: ${r10.tcp.retrans} retransmissões, e ${r10.tcp.held} segmentos que já tinham chegado esperaram no buffer atrás do segmento ${ids[0]}`,
      `o UDP termina em ${ms(r0.udp.done)} e o TCP em ${ms(r0.tcp.done)} — a diferença de ${ms(r0.tcp.done - r0.udp.done)}`,
      `${r20.tcp.retrans} retransmissões, fim em ${ms(r20.tcp.done)}`,
      `o UDP fica com só ${r30.udp.delivered}/20, enquanto o TCP precisa de ${r30.tcp.retrans} retransmissões e ${ms(r30.tcp.done)}`
    ];
  });
});
