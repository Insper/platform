import { load, test, eq, ok, near, tipHas, fmt } from "./lib.mjs";

const M = load("cloud-cost");
const P = M.PRICES;
const at = (requests, duration = 100, memory = 512) => M.costs({ requests, duration, memory });
const money = (v, lang) => M.money(v, lang === "pt");
const reqs = (v, lang) => M.reqs(v, lang === "pt");
const price = (v, lang) => (lang === "pt" ? "US$ " : "$") + v.toLocaleString(lang === "pt" ? "pt-BR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 10 });

test("unit prices: consistent with the Cloud Deployment class (2 × t3.medium ≈ $61/month)", () => {
  near(2 * M.vmMonthly(), 61, 0.5, "2 × t3.medium per month");
  near(M.taskMonthly(), (0.5 * 0.04048 + 1 * 0.004445) * 730, 1e-9, "a 0.5 vCPU / 1 GB Fargate task");
  near(at(1e6).faas, 0.2 + 1e6 * 0.1 * 0.5 * P.lambda_gb_s, 1e-9, "Lambda: requests + GB-seconds");
});

test("FaaS grows with every request; the always-on options keep their minimum until the load needs more", () => {
  eq([at(1e4).vms, at(1e4).tasks], [M.VM.min, M.TASK.min], "minimum at low traffic");
  ok(at(1e7).iaas === at(1e4).iaas && at(1e7).caas === at(1e4).caas, "same always-on cost from 10 k to 10 M");
  near(at(1e7).faas / at(1e6).faas, 10, 1e-9, "FaaS is linear");
});

test("the break-even is the first point where FaaS costs as much as the cheaper always-on option", () => {
  for (const [d, m] of [[100, 512], [300, 1024], [10, 128], [1000, 2048]]) {
    const be = M.breakEven({ duration: d, memory: m });
    const below = at(be.requests * 0.999, d, m), above = at(be.requests * 1.001, d, m);
    ok(below.faas < Math.min(below.iaas, below.caas), `${d} ms / ${m} MB: FaaS cheaper just below`);
    ok(above.faas >= Math.min(above.iaas, above.caas), `${d} ms / ${m} MB: FaaS not cheaper just above`);
    for (let r = 1e4; r < be.requests * 0.999; r *= 1.05) {
      const c = at(r, d, m);
      ok(c.faas < Math.min(c.iaas, c.caas), `${d} ms / ${m} MB: FaaS already dearer at ${r}`);
    }
  }
});

test("the tip: the starting point, the break-even, 1 B requests and other durations", () => {
  const c = at(1e6), be = M.breakEven({ duration: 100, memory: 512 });
  const big = at(1e9);
  const be300 = M.breakEven({ duration: 300, memory: 1024 }), be10 = M.breakEven({ duration: 10, memory: 128 });
  const ratio = Math.round(at(1e6, 300, 1024).faas / c.faas);
  console.log(`       1 M: FaaS ${c.faas.toFixed(2)}, CaaS ${c.caas.toFixed(2)} (${c.tasks}), IaaS ${c.iaas.toFixed(2)} (${c.vms}); break-even ${(be.requests / 1e6).toFixed(1)} M = ${be.avgRps.toFixed(1)} req/s vs ${be.vs}`);
  console.log(`       1 B: FaaS ${big.faas.toFixed(0)}, CaaS ${big.caas.toFixed(2)} (${big.tasks}), IaaS ${big.iaas.toFixed(2)} (${big.vms}); 300 ms/1 GB ×${ratio} → ${(be300.requests / 1e6).toFixed(1)} M; 10 ms/128 MB → ${(be10.requests / 1e6).toFixed(1)} M`);
  ok(c.faas < c.caas && c.caas < c.iaas, "at 1 M: FaaS < CaaS < IaaS");
  ok(big.iaas < big.caas && big.caas < big.faas, "at 1 B: IaaS < CaaS < FaaS");
  tipHas("cloud-cost", lang => lang === "en"
    ? [`FaaS costs ${money(c.faas, lang)} a month, the ${c.tasks} always-on Fargate tasks ${money(c.caas, lang)} and the ${c.vms} VMs ${money(c.iaas, lang)}`,
       `EC2 t3.medium ${price(P.ec2_t3_medium_h, lang)}/h`, `Fargate ${price(P.fargate_vcpu_h, lang)} per vCPU-hour and ${price(P.fargate_gb_h, lang)} per GB-hour`,
       `Lambda ${price(P.lambda_per_million, lang)} per million requests and ${price(P.lambda_gb_s, lang)} per GB-second`,
       `FaaS stops being cheaper at about ${reqs(be.requests, lang)} requests/month, only ${fmt(be.avgRps, 1, lang)} requests per second on average`,
       `At ${reqs(1e9, lang)} requests/month FaaS costs ${money(big.faas, lang)}, Fargate ${money(big.caas, lang)} (${big.tasks} tasks) and the VMs ${money(big.iaas, lang)} (${big.vms} VMs)`,
       `each call costs about ${ratio}× more and the break-even falls to ${reqs(be300.requests, lang)}`, `it rises to ${reqs(be10.requests, lang)}`]
    : [`o FaaS custa ${money(c.faas, lang)} por mês, as ${c.tasks === 2 ? "duas" : c.tasks} tasks Fargate sempre ligadas ${money(c.caas, lang)} e as ${c.vms === 2 ? "duas" : c.vms} VMs ${money(c.iaas, lang)}`,
       `EC2 t3.medium ${price(P.ec2_t3_medium_h, lang)}/h`, `Fargate ${price(P.fargate_vcpu_h, lang)} por vCPU-hora e ${price(P.fargate_gb_h, lang)} por GB-hora`,
       `Lambda ${price(P.lambda_per_million, lang)} por milhão de requisições e ${price(P.lambda_gb_s, lang)} por GB-segundo`,
       `o FaaS deixa de ser mais barato em cerca de ${reqs(be.requests, lang)} de requisições/mês, só ${fmt(be.avgRps, 1, lang)} requisições por segundo em média`,
       `Com ${reqs(1e9, lang)} de requisições/mês o FaaS custa ${money(big.faas, lang)}, o Fargate ${money(big.caas, lang)} (${big.tasks} tasks) e as VMs ${money(big.iaas, lang)} (${big.vms} VMs)`,
       `cada chamada custa cerca de ${ratio}× mais e o ponto de equilíbrio cai para ${reqs(be300.requests, lang)}`, `ele sobe para ${reqs(be10.requests, lang)}`]);
});
