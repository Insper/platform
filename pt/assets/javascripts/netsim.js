/*
 * Network simulators (2027.1, class 12 — network pages):
 *
 *   <div class="netsim" data-tool="cidr" data-cidr="10.20.0.0/16"></div>
 *     An address explorer: the 32 bits split into network and host parts, the range and size of
 *     the block, the kind of address (private, public, CGNAT, …), subnetting, and "is this IP
 *     inside the block?".
 *
 *   <div class="netsim" data-tool="packet" data-scenario="fan-site"></div>
 *     A packet walk through the BoxOffice VPC, one hop per step: route tables (longest prefix
 *     match), NAT rewrites, security groups and allow-lists. Switches change the network
 *     (remove the NAT route, the load balancer's public IP, the database rule) and the walk is
 *     recomputed. Optional: data-nat="off", data-albpublic="off", data-dbrule="off".
 *
 * Interface strings follow <html lang>. The engine is a set of pure functions, exported for
 * node tests (scripts/playground/test_netsim.mjs).
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ IPv4 helpers */

  function parseIp(s) {
    var p = String(s).trim().split(".");
    if (p.length !== 4) return null;
    var n = 0;
    for (var i = 0; i < 4; i++) {
      if (!/^\d{1,3}$/.test(p[i]) || +p[i] > 255) return null;
      n = n * 256 + (+p[i]);
    }
    return n;
  }
  function ipStr(n) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  function parseCidr(s) {
    var m = String(s).trim().match(/^([\d.]+)(?:\/(\d{1,2}))?$/);
    if (!m) return null;
    var ip = parseIp(m[1]);
    var prefix = m[2] === undefined ? 32 : +m[2];
    if (ip === null || prefix > 32) return null;
    return { ip: ip, prefix: prefix };
  }
  function maskOf(prefix) { return prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0; }
  function networkOf(ip, prefix) { return (ip & maskOf(prefix)) >>> 0; }
  function sizeOf(prefix) { return Math.pow(2, 32 - prefix); }
  function inCidr(cidr, ip) {
    var c = typeof cidr === "string" ? parseCidr(cidr) : cidr;
    return networkOf(ip, c.prefix) === networkOf(c.ip, c.prefix);
  }

  /* The special blocks; everything else is public (globally routed). */
  var BLOCKS = [
    ["10.0.0.0/8", "private"], ["172.16.0.0/12", "private"], ["192.168.0.0/16", "private"],
    ["100.64.0.0/10", "cgnat"], ["127.0.0.0/8", "loopback"], ["169.254.0.0/16", "linklocal"],
    ["192.0.2.0/24", "doc"], ["198.51.100.0/24", "doc"], ["203.0.113.0/24", "doc"],
    ["224.0.0.0/4", "multicast"], ["0.0.0.0/8", "thisnet"], ["240.0.0.0/4", "reserved"]
  ];
  function kindOf(ip) {
    for (var i = 0; i < BLOCKS.length; i++) {
      if (inCidr(BLOCKS[i][0], ip)) return { kind: BLOCKS[i][1], block: BLOCKS[i][0] };
    }
    return { kind: "public", block: null };
  }

  /* Facts of a block, as shown by the CIDR explorer. */
  function describe(cidrText) {
    var c = parseCidr(cidrText);
    if (!c) return null;
    var net = networkOf(c.ip, c.prefix), size = sizeOf(c.prefix), last = net + size - 1;
    var usable = c.prefix === 32 ? 1 : c.prefix === 31 ? 2 : size - 2;
    return {
      ip: c.ip, prefix: c.prefix, network: net, last: last, size: size, mask: maskOf(c.prefix),
      first: c.prefix >= 31 ? net : net + 1, lastHost: c.prefix >= 31 ? last : last - 1,
      usable: usable, aws: c.prefix >= 16 && c.prefix <= 28 ? size - 5 : null,
      hostBitsSet: net !== c.ip, kind: kindOf(c.ip)
    };
  }
  function split(cidrText, extraBits) {
    var d = describe(cidrText), out = [];
    var p = Math.min(32, d.prefix + extraBits), n = Math.pow(2, p - d.prefix), step = sizeOf(p);
    for (var i = 0; i < n; i++) out.push(ipStr(d.network + i * step) + "/" + p);
    return out;
  }

  /* Longest prefix match: the most specific route that contains the address wins. */
  function lookup(table, ip) {
    var best = -1, bestPrefix = -1;
    table.forEach(function (r, i) {
      var c = parseCidr(r.dst);
      if (inCidr(c, ip) && c.prefix > bestPrefix) { best = i; bestPrefix = c.prefix; }
    });
    return best;
  }

  /* ------------------------------------------------------------------ the BoxOffice VPC */

  var DEFAULTS = { nat: true, albPublic: true, dbRule: true };

  function buildModel(opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    var local = { dst: "10.20.0.0/16", target: "local" };
    return {
      opts: opts,
      hosts: {
        fan: { zone: "internet", ip: "192.168.0.12" },
        home: { zone: "internet", ip: "192.168.0.1", pub: "198.51.100.7" },
        net: { zone: "internet" },
        attacker: { zone: "internet", ip: "198.51.100.66" },
        psp: { zone: "internet", ip: "192.0.2.50", allow: ["203.0.113.20"] },
        mirror: { zone: "internet", ip: "192.0.2.80" },
        igw: { zone: "edge" },
        alb: { subnet: "pub", ip: "10.20.0.10", pub: opts.albPublic ? "203.0.113.10" : null, sg: "sg-alb" },
        nat: { subnet: "pub", ip: "10.20.0.20", pub: "203.0.113.20" },
        order: { subnet: "app", ip: "10.20.33.5", sg: "sg-app" },
        payment: { subnet: "app", ip: "10.20.40.17", sg: "sg-app" },
        db: { subnet: "data", ip: "10.20.8.10", sg: "sg-data" }
      },
      subnets: {
        pub: { cidr: "10.20.0.0/24", rt: "rt-public" },
        app: { cidr: "10.20.32.0/19", rt: "rt-private" },
        data: { cidr: "10.20.8.0/22", rt: "rt-data" }
      },
      tables: {
        "rt-home": [{ dst: "192.168.0.0/24", target: "wifi" }, { dst: "0.0.0.0/0", target: "isp" }],
        // the Internet core has no default route: only the prefixes announced with BGP
        "rt-internet": [
          { dst: "203.0.113.0/24", target: "cloud" },
          { dst: "192.0.2.0/24", target: "provider" },
          { dst: "198.51.100.0/24", target: "fanisp" }
        ],
        "rt-public": [local, { dst: "0.0.0.0/0", target: "igw" }],
        "rt-private": opts.nat ? [local, { dst: "0.0.0.0/0", target: "nat" }] : [local],
        "rt-data": [local]
      },
      sgs: {
        "sg-alb": [{ port: 443, from: "0.0.0.0/0" }],
        "sg-app": [{ port: 8080, from: "sg-alb" }, { port: 8080, from: "sg-app" }],
        "sg-data": opts.dbRule ? [{ port: 5432, from: "sg-app" }] : []
      }
    };
  }

  var SCENARIOS = {
    "fan-site": [{ from: "fan", to: "203.0.113.10", port: 443 }, { from: "alb", to: "10.20.33.5", port: 8080 }],
    "pay-psp": [{ from: "payment", to: "192.0.2.50", port: 443, reply: true }],
    "fan-pod": [{ from: "fan", to: "10.20.40.17", port: 8080 }],
    "order-db": [{ from: "order", to: "10.20.8.10", port: 5432 }],
    "db-update": [{ from: "db", to: "192.0.2.80", port: 443 }],
    "scan-nat": [{ from: "attacker", to: "203.0.113.20", port: 5432 }],
    "scan-alb": [{ from: "attacker", to: "203.0.113.10", port: 5432 }]
  };
  var SCENARIO_ORDER = ["fan-site", "pay-psp", "fan-pod", "order-db", "db-update", "scan-nat", "scan-alb"];

  function hostByIp(m, ip, inVpc) {
    for (var k in m.hosts) {
      var h = m.hosts[k];
      if (inVpc && !h.subnet) continue;
      if (h.ip === ip) return k;
    }
    return null;
  }
  function sgAllows(m, sg, srcKey, srcIp, port) {
    var rules = m.sgs[sg] || [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.port !== port) continue;
      if (r.from.indexOf("sg-") === 0 ? (m.hosts[srcKey] && m.hosts[srcKey].sg === r.from) : inCidr(r.from, parseIp(srcIp))) return i;
    }
    return -1;
  }

  /*
   * walk(model, scenarioId) → steps. Each step: { node, msg, args, pkt: {src, sport, dst, dport},
   * changed: ["src"|"dst"], table: {name, rows, match}, nat: [entries], sg: {name, rules, match},
   * status: "go" | "ok" | "drop" }. Messages are keys of the interface strings (see TEXT).
   */
  function walk(m, scenarioId) {
    var steps = [], nat = [], legs = SCENARIOS[scenarioId], sport = 51514, natPort = 62001;
    function push(s) { s.nat = nat.slice(); steps.push(s); return s; }
    function pk(src, sp, dst, dp) { return { src: src, sport: sp, dst: dst, dport: dp }; }
    function tbl(name, ip) { var rows = m.tables[name]; return { name: name, rows: rows, match: lookup(rows, parseIp(ip)) }; }

    /* From the Internet to the address `dst`; returns the VPC host reached (after the IGW) or null. */
    function acrossInternet(p) {
      var t = tbl("rt-internet", p.dst);
      if (t.match < 0) {
        push({ node: "net", msg: "netNoRoute", args: [p.dst], pkt: p, table: t, status: "drop" });
        return null;
      }
      var target = t.rows[t.match].target;
      push({ node: "net", msg: "netRoute", args: [p.dst, t.rows[t.match].dst], pkt: p, table: t, status: "go" });
      if (target !== "cloud") return target;
      // at the Internet gateway: public address → private address, 1:1
      var owner = null;
      for (var k in m.hosts) if (m.hosts[k].pub === p.dst && m.hosts[k].subnet) owner = k;
      if (!owner) {
        push({ node: "igw", msg: "igwNobody", args: [p.dst], pkt: p, status: "drop" });
        return null;
      }
      var q = pk(p.src, p.sport, m.hosts[owner].ip, p.dport);
      push({ node: "igw", msg: "igwIn", args: [p.dst, q.dst], pkt: q, changed: ["dst"], status: "go" });
      return { host: owner, pkt: q };
    }

    /* A packet arriving at a VPC host: security group (or the NAT table). */
    function deliver(key, p, srcKey) {
      var h = m.hosts[key];
      if (key === "nat") {
        var e = nat.filter(function (n) { return n.natIp === p.dst && n.pubPort === p.dport; })[0];
        if (!e) { push({ node: "nat", msg: "natNoEntry", args: [p.dport], pkt: p, status: "drop" }); return false; }
        var q = pk(p.src, p.sport, e.ip, e.port);
        push({ node: "nat", msg: "natBack", args: [e.ip + ":" + e.port], pkt: q, changed: ["dst"], status: "go" });
        var t = tbl("rt-public", q.dst);
        push({ node: "nat", msg: "routeLocal", args: ["rt-public", q.dst], pkt: q, table: t, status: "go" });
        push({ node: e.host, msg: "replyArrives", args: [], pkt: q, status: "ok" });
        return true;
      }
      var rules = m.sgs[h.sg] || [];
      var match = sgAllows(m, h.sg, srcKey, p.src, p.dport);
      if (match < 0) {
        push({ node: key, msg: "sgDeny", args: [h.sg, p.dport], pkt: p, sg: { name: h.sg, rules: rules, match: -1 }, status: "drop" });
        return false;
      }
      push({ node: key, msg: "sgAllow", args: [h.sg, p.dport], pkt: p, sg: { name: h.sg, rules: rules, match: match }, status: "ok" });
      return true;
    }

    function fromInternet(leg) {
      var h = m.hosts[leg.from], p;
      if (leg.from === "fan") {
        p = pk(h.ip, sport, leg.to, leg.port);
        push({ node: "fan", msg: "fanSends", args: [], pkt: p, status: "go" });
        var t = tbl("rt-home", leg.to), home = m.hosts.home;
        p = pk(home.pub, 40001, leg.to, leg.port);
        push({ node: "home", msg: "homeNat", args: [h.ip + ":" + sport, home.pub + ":40001"], pkt: p, table: t, changed: ["src"], status: "go" });
      } else {
        p = pk(h.ip, 33800, leg.to, leg.port);
        push({ node: leg.from, msg: "extSends", args: [], pkt: p, status: "go" });
      }
      var r = acrossInternet(p);
      if (!r || typeof r === "string") return false;
      return deliver(r.host, r.pkt, leg.from);
    }

    function fromVpc(leg) {
      var key = leg.from, h = m.hosts[key], sub = m.subnets[h.subnet];
      var p = pk(h.ip, leg.reply ? 51000 : sport, leg.to, leg.port);
      var t = tbl(sub.rt, leg.to);
      if (t.match < 0) {
        push({ node: key, msg: "noRoute", args: [sub.rt, leg.to], pkt: p, table: t, status: "drop" });
        return false;
      }
      var target = t.rows[t.match].target;
      if (target === "local") {
        push({ node: key, msg: "routeLocal", args: [sub.rt, leg.to], pkt: p, table: t, status: "go" });
        var dstKey = hostByIp(m, leg.to, true);
        if (!dstKey) { push({ node: key, msg: "noHost", args: [leg.to], pkt: p, status: "drop" }); return false; }
        return deliver(dstKey, p, key);
      }
      // target "nat" (private subnets) — the only other target used by these subnets
      push({ node: key, msg: "routeNat", args: [sub.rt, leg.to], pkt: p, table: t, status: "go" });
      var natH = m.hosts.nat;
      nat.push({ host: key, ip: h.ip, port: p.sport, natIp: natH.ip, pub: natH.pub, pubPort: natPort });
      var q = pk(natH.ip, natPort, leg.to, leg.port);
      push({ node: "nat", msg: "natOut", args: [h.ip + ":" + p.sport, natH.ip + ":" + natPort], pkt: q, changed: ["src"], status: "go" });
      var t2 = tbl("rt-public", leg.to);
      var r = pk(natH.pub, natPort, leg.to, leg.port);
      push({ node: "igw", msg: "igwOut", args: [natH.ip, natH.pub], pkt: r, table: t2, changed: ["src"], status: "go" });
      var dest = acrossInternet(r);
      if (dest === null) return false;
      var extKey = hostByIp(m, leg.to, false);
      var ext = m.hosts[extKey];
      if (ext.allow && ext.allow.indexOf(r.src) < 0) {
        push({ node: extKey, msg: "allowDeny", args: [r.src], pkt: r, status: "drop" });
        return false;
      }
      push({ node: extKey, msg: ext.allow ? "allowOk" : "extAccepts", args: [r.src], pkt: r, status: "go" });
      if (!leg.reply) { steps[steps.length - 1].status = "ok"; return true; }
      // the reply travels back to the Elastic IP
      var back = pk(leg.to, leg.port, natH.pub, natPort);
      push({ node: extKey, msg: "replySends", args: [], pkt: back, status: "go" });
      var b = acrossInternet(back);
      if (!b || typeof b === "string") return false;
      return deliver(b.host, b.pkt, extKey);
    }

    for (var i = 0; i < legs.length; i++) {
      var leg = legs[i];
      if (i > 0) steps.push({ node: leg.from, msg: "nextLeg", args: [leg.to + ":" + leg.port], pkt: null, nat: nat.slice(), status: "go" });
      var ok = m.hosts[leg.from].subnet ? fromVpc(leg) : fromInternet(leg);
      if (!ok) break;
    }
    return steps;
  }

  var API = {
    parseIp: parseIp, ipStr: ipStr, parseCidr: parseCidr, maskOf: maskOf, networkOf: networkOf,
    sizeOf: sizeOf, inCidr: inCidr, kindOf: kindOf, describe: describe, split: split, lookup: lookup,
    buildModel: buildModel, walk: walk, SCENARIOS: SCENARIOS
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; }
  if (typeof document === "undefined") return;

  /* ------------------------------------------------------------------ interface strings */

  var PT = (document.documentElement.lang || "").indexOf("pt") === 0;
  var TEXT = PT ? {
    addr: "Endereço / prefixo", prefix: "Prefixo", tryIt: "Experimente:",
    network: "Rede", mask: "Máscara", broadcast: "Último endereço", range: "Hosts utilizáveis",
    size: "Endereços no bloco", usable: "Utilizáveis (rede clássica)", aws: "Utilizáveis numa sub-rede AWS (− 5)",
    kind: "Tipo do endereço", netBits: "bits de rede", hostBits: "bits de host",
    hostBitsSet: "Os bits de host não são zero: o bloco que contém este endereço é {0}.",
    splitInto: "Dividir em", noSplit: "não dividir", subnets: "sub-redes", testIp: "Este IP está no bloco?",
    inside: "{0} está DENTRO de {1}", insideSub: " — na sub-rede {0}", outside: "{0} está FORA de {1}: o host o entrega ao gateway (outra rede)",
    invalid: "Endereço inválido: use a forma a.b.c.d/p, por exemplo 10.20.0.0/16.",
    kinds: {
      "private": "privado (RFC 1918): reutilizável em qualquer rede, nunca roteado na Internet",
      "cgnat": "compartilhado (RFC 6598): o NAT da operadora (CGNAT), comum no 4G",
      "loopback": "loopback: a própria máquina",
      "linklocal": "link-local: só no enlace local (ex.: o serviço de metadados da nuvem, 169.254.169.254)",
      "doc": "documentação (RFC 5737): formato público, reservado para exemplos como esta página",
      "multicast": "multicast: um grupo de receptores, não um host",
      "thisnet": "\"esta rede\": não é um destino válido",
      "reserved": "reservado (classe E): não usado",
      "public": "público: único no mundo e roteado na Internet"
    },
    scen: "Cenário", step: "Passo", of: "de", reset: "Recomeçar", prev: "Passo anterior", play: "Reproduzir / pausar", next: "Próximo passo",
    switches: "Mude a rede:", swNat: "rota 0.0.0.0/0 → NAT na sub-rede privada", swAlb: "o load balancer tem IP público", swDb: "sg-data aceita 5432 de sg-app",
    internet: "Internet", vpc: "VPC 10.20.0.0/16 (sa-east-1)", sPub: "pública", sApp: "privada (app)", sData: "isolada (dados)",
    packet: "Pacote", src: "origem", dst: "destino", routeTable: "Tabela de rotas", natTable: "Tabela do NAT", sgTable: "Security group (entrada)",
    destCol: "destino", targetCol: "alvo", portCol: "porta", fromCol: "origem", insideCol: "dentro", outsideCol: "fora (público)",
    delivered: "Entregue", dropped: "Descartado", empty: "vazia",
    names: { fan: "Celular do fã", home: "Roteador Wi-Fi (NAT)", net: "Roteadores da Internet", attacker: "Scanner", psp: "Provedor de pagamento", mirror: "Espelho de pacotes", igw: "Internet gateway", alb: "Load balancer", nat: "NAT gateway", order: "pod order", payment: "pod payment", db: "PostgreSQL" },
    targets: { local: "local (dentro da VPC)", igw: "internet gateway", nat: "NAT gateway", wifi: "Wi-Fi (local)", isp: "operadora", cloud: "provedor de nuvem", provider: "rede do provedor de pagamento", fanisp: "operadora do fã" },
    scenarios: {
      "fan-site": "Um fã abre o site (443) e o ALB chama o order",
      "pay-psp": "payment chama o provedor de pagamento (e recebe a resposta)",
      "fan-pod": "Um fã tenta acessar um pod diretamente pelo IP privado",
      "order-db": "order consulta o PostgreSQL (5432)",
      "db-update": "O PostgreSQL tenta baixar uma atualização da Internet",
      "scan-nat": "Um scanner tenta a porta 5432 no IP do NAT",
      "scan-alb": "Um scanner tenta a porta 5432 no IP do load balancer"
    },
    msgs: {
      fanSends: "O celular está na rede Wi-Fi de casa, com o endereço PRIVADO {src}. Ele monta o pacote e o entrega ao roteador, porque o destino não está na sub-rede local.",
      homeNat: "O roteador de casa casa o destino com a rota padrão 0.0.0.0/0 (operadora) e faz NAT: troca a origem {0} por {1}, seu único IP PÚBLICO, e anota a tradução para reconhecer a resposta.",
      extSends: "Este host da Internet já tem um IP público ({src}) e envia o pacote direto.",
      netNoRoute: "Nenhum roteador da Internet tem rota para {0}: é um endereço privado, que ninguém anuncia (e o núcleo da Internet não tem rota padrão). O pacote é descartado no primeiro salto.",
      netRoute: "Salto a salto (em geral 10 a 20 roteadores), cada roteador escolhe o próximo salto pelo prefixo mais longo que contém {0}. O provedor dono do bloco anunciou {1} via BGP, então o pacote chega à rede certa.",
      igwNobody: "O bloco é do provedor de nuvem, mas nenhum recurso tem o IP público {0}: o internet gateway descarta o pacote.",
      igwIn: "O internet gateway troca o destino público {0} pelo endereço privado {1} (NAT 1:1). Dentro da VPC ninguém conhece o próprio IP público.",
      sgAllow: "O security group {0} tem uma regra de entrada para a porta {1} desta origem: o pacote é entregue.",
      sgDeny: "O security group {0} não tem regra de entrada para a porta {1} desta origem: o pacote é descartado em silêncio (quem enviou vê um timeout, não uma recusa).",
      nextLeg: "Uma nova conexão, de dentro da VPC: o load balancer escolhe um alvo saudável e abre uma conexão para {0}.",
      routeLocal: "Tabela {0}: a rota mais específica para {1} é 10.20.0.0/16 → local (vence 0.0.0.0/0 por ter o prefixo mais longo). O pacote fica dentro da VPC.",
      noRoute: "Tabela {0}: nenhuma rota contém {1} — só existe a rota local. A sub-rede é isolada: não alcança a Internet, e a Internet não a alcança.",
      noHost: "Nenhum host da VPC tem o endereço {0}.",
      routeNat: "Tabela {0}: {1} não está na VPC, então vale 0.0.0.0/0 → NAT gateway. O pod tem só um IP privado; quem sai para a Internet é o NAT.",
      natOut: "O NAT gateway troca a origem {0} por {1} e anota a tradução. Só conexões iniciadas de dentro criam entradas nesta tabela.",
      igwOut: "Na sub-rede pública a rota padrão aponta para o internet gateway, que troca a origem {0} pelo Elastic IP {1}: o endereço público fixo do NAT.",
      allowOk: "O provedor só aceita origens da sua lista de permissões; {0} (o Elastic IP do NAT) está lá. A cobrança é processada.",
      allowDeny: "O provedor não reconhece a origem {0}: fora da lista de permissões, recusado.",
      extAccepts: "O servidor aceita a conexão de {0}.",
      replySends: "A resposta volta para o endereço que o provedor viu: o Elastic IP do NAT, na porta que o NAT escolheu.",
      natBack: "O NAT encontra a tradução que anotou na ida e devolve o destino original: {0}.",
      natNoEntry: "O NAT não tem nenhuma tradução para uma conexão de entrada na porta {0}: descartado. Um NAT só deixa entrar respostas a conexões abertas de dentro.",
      replyArrives: "A resposta chega ao pod pelo caminho inverso. O pod nunca soube qual IP público o representou."
    }
  } : {
    addr: "Address / prefix", prefix: "Prefix", tryIt: "Try:",
    network: "Network", mask: "Mask", broadcast: "Last address", range: "Usable hosts",
    size: "Addresses in the block", usable: "Usable (classic network)", aws: "Usable in an AWS subnet (− 5)",
    kind: "Kind of address", netBits: "network bits", hostBits: "host bits",
    hostBitsSet: "The host bits are not zero: the block that contains this address is {0}.",
    splitInto: "Split into", noSplit: "no split", subnets: "subnets", testIp: "Is this IP in the block?",
    inside: "{0} is INSIDE {1}", insideSub: " — in subnet {0}", outside: "{0} is OUTSIDE {1}: the host hands it to the gateway (another network)",
    invalid: "Invalid address: use a.b.c.d/p, for example 10.20.0.0/16.",
    kinds: {
      "private": "private (RFC 1918): reusable in any network, never routed on the Internet",
      "cgnat": "shared (RFC 6598): your mobile carrier's NAT (CGNAT), common on 4G",
      "loopback": "loopback: this machine itself",
      "linklocal": "link-local: only on the local link (e.g. the cloud metadata service, 169.254.169.254)",
      "doc": "documentation (RFC 5737): public format, reserved for examples like this page",
      "multicast": "multicast: a group of receivers, not a host",
      "thisnet": "\"this network\": not a valid destination",
      "reserved": "reserved (class E): not used",
      "public": "public: globally unique and routed on the Internet"
    },
    scen: "Scenario", step: "Step", of: "of", reset: "Restart", prev: "Previous step", play: "Play / pause", next: "Next step",
    switches: "Change the network:", swNat: "route 0.0.0.0/0 → NAT in the private subnet", swAlb: "the load balancer has a public IP", swDb: "sg-data accepts 5432 from sg-app",
    internet: "Internet", vpc: "VPC 10.20.0.0/16 (sa-east-1)", sPub: "public", sApp: "private (app)", sData: "isolated (data)",
    packet: "Packet", src: "source", dst: "destination", routeTable: "Route table", natTable: "NAT table", sgTable: "Security group (inbound)",
    destCol: "destination", targetCol: "target", portCol: "port", fromCol: "from", insideCol: "inside", outsideCol: "outside (public)",
    delivered: "Delivered", dropped: "Dropped", empty: "empty",
    names: { fan: "Fan's phone", home: "Wi-Fi router (NAT)", net: "Internet routers", attacker: "Scanner", psp: "Payment provider", mirror: "Package mirror", igw: "Internet gateway", alb: "Load balancer", nat: "NAT gateway", order: "order pod", payment: "payment pod", db: "PostgreSQL" },
    targets: { local: "local (inside the VPC)", igw: "internet gateway", nat: "NAT gateway", wifi: "Wi-Fi (local)", isp: "carrier", cloud: "cloud provider", provider: "payment provider's network", fanisp: "fan's carrier" },
    scenarios: {
      "fan-site": "A fan opens the site (443) and the ALB calls order",
      "pay-psp": "payment calls the payment provider (and gets the reply)",
      "fan-pod": "A fan tries to reach a pod directly by its private IP",
      "order-db": "order queries PostgreSQL (5432)",
      "db-update": "PostgreSQL tries to download an update from the Internet",
      "scan-nat": "A scanner tries port 5432 on the NAT's IP",
      "scan-alb": "A scanner tries port 5432 on the load balancer's IP"
    },
    msgs: {
      fanSends: "The phone is on the home Wi-Fi, with the PRIVATE address {src}. It builds the packet and hands it to the router, because the destination is not in the local subnet.",
      homeNat: "The home router matches the destination with the default route 0.0.0.0/0 (the carrier) and does NAT: it replaces the source {0} with {1}, its only PUBLIC IP, and records the translation to recognise the reply.",
      extSends: "This Internet host already has a public IP ({src}) and sends the packet directly.",
      netNoRoute: "No Internet router has a route to {0}: it is a private address, which nobody announces (and the Internet core has no default route). The packet is dropped at the first hop.",
      netRoute: "Hop by hop (usually 10 to 20 routers), each router picks the next hop by the longest prefix that contains {0}. The network that owns the block announced {1} with BGP, so the packet reaches the right network.",
      igwNobody: "The block belongs to the cloud provider, but no resource holds the public IP {0}: the internet gateway drops the packet.",
      igwIn: "The internet gateway replaces the public destination {0} with the private address {1} (1:1 NAT). Inside the VPC nobody knows its own public IP.",
      sgAllow: "Security group {0} has an inbound rule for port {1} from this source: the packet is delivered.",
      sgDeny: "Security group {0} has no inbound rule for port {1} from this source: the packet is dropped silently (the sender sees a timeout, not a refusal).",
      nextLeg: "A new connection, from inside the VPC: the load balancer picks a healthy target and opens a connection to {0}.",
      routeLocal: "Table {0}: the most specific route for {1} is 10.20.0.0/16 → local (it beats 0.0.0.0/0 because its prefix is longer). The packet stays inside the VPC.",
      noRoute: "Table {0}: no route contains {1} — there is only the local route. The subnet is isolated: it cannot reach the Internet, and the Internet cannot reach it.",
      noHost: "No VPC host has the address {0}.",
      routeNat: "Table {0}: {1} is not in the VPC, so 0.0.0.0/0 → NAT gateway applies. The pod has only a private IP; the NAT is what goes out to the Internet.",
      natOut: "The NAT gateway replaces the source {0} with {1} and records the translation. Only connections started from inside create entries in this table.",
      igwOut: "In the public subnet the default route points to the internet gateway, which replaces the source {0} with the Elastic IP {1}: the NAT's fixed public address.",
      allowOk: "The provider accepts only the sources on its allow-list; {0} (the NAT's Elastic IP) is there. The charge is processed.",
      allowDeny: "The provider does not know the source {0}: not on the allow-list, refused.",
      extAccepts: "The server accepts the connection from {0}.",
      replySends: "The reply goes back to the address the provider saw: the NAT's Elastic IP, on the port the NAT chose.",
      natBack: "The NAT finds the translation it recorded on the way out and restores the original destination: {0}.",
      natNoEntry: "The NAT has no translation for an inbound connection on port {0}: dropped. A NAT only lets in replies to connections opened from inside.",
      replyArrives: "The reply reaches the pod on the reverse path. The pod never knew which public IP stood for it."
    }
  };

  function fmt(s, args, pkt) {
    s = s.replace(/\{(\d)\}/g, function (_, i) { return "<code>" + args[+i] + "</code>"; });
    if (pkt) s = s.replace("{src}", "<code>" + pkt.src + "</code>");
    return s;
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  /* ------------------------------------------------------------------ CIDR explorer */

  function cidrTool(root) {
    var start = root.getAttribute("data-cidr") || "10.20.0.0/16";
    root.innerHTML = "";
    var form = el("div", "ns-row");
    var input = el("input"); input.type = "text"; input.value = start; input.spellcheck = false; input.setAttribute("aria-label", TEXT.addr);
    var range = el("input"); range.type = "range"; range.min = 0; range.max = 32; range.setAttribute("aria-label", TEXT.prefix);
    var lab = el("label", "ns-label", TEXT.addr + " "); lab.appendChild(input);
    var lab2 = el("label", "ns-label", TEXT.prefix + " "); lab2.appendChild(range);
    form.appendChild(lab); form.appendChild(lab2);
    var tries = el("div", "ns-row ns-try", "<span>" + TEXT.tryIt + "</span>");
    ["10.20.0.0/16", "10.20.32.0/19", "192.168.0.12/24", "100.64.7.9/10", "203.0.113.10/32", "169.254.169.254/16", "8.8.8.8/32"].forEach(function (ex) {
      var b = el("button", "ns-chip", ex); b.type = "button";
      b.onclick = function () { input.value = ex; update(); };
      tries.appendChild(b);
    });
    var bits = el("div", "ns-bits");
    var facts = el("div", "ns-facts");
    var splitRow = el("div", "ns-row");
    var sel = el("select"); sel.setAttribute("aria-label", TEXT.splitInto);
    [[0, TEXT.noSplit], [1, "2 " + TEXT.subnets], [2, "4 " + TEXT.subnets], [3, "8 " + TEXT.subnets], [4, "16 " + TEXT.subnets]].forEach(function (o) {
      var op = el("option", null, o[1]); op.value = o[0]; sel.appendChild(op);
    });
    var lab3 = el("label", "ns-label", TEXT.splitInto + " "); lab3.appendChild(sel);
    var test = el("input"); test.type = "text"; test.placeholder = "10.20.40.17"; test.spellcheck = false;
    var lab4 = el("label", "ns-label", TEXT.testIp + " "); lab4.appendChild(test);
    splitRow.appendChild(lab3); splitRow.appendChild(lab4);
    var testOut = el("div", "ns-test");
    var list = el("div", "ns-split");
    [form, tries, bits, facts, splitRow, testOut, list].forEach(function (x) { root.appendChild(x); });

    function update(fromRange) {
      var c = parseCidr(input.value);
      if (fromRange && c) { input.value = ipStr(c.ip) + "/" + range.value; c = parseCidr(input.value); }
      if (!c) { facts.innerHTML = '<p class="ns-bad">' + TEXT.invalid + "</p>"; bits.innerHTML = ""; list.innerHTML = ""; testOut.innerHTML = ""; return; }
      range.value = c.prefix;
      var d = describe(input.value);
      // the 32 bits, octet by octet
      var html = "";
      for (var o = 0; o < 4; o++) {
        var octet = (d.ip >>> (24 - 8 * o)) & 255;
        html += '<div class="ns-octet"><div class="ns-dec">' + octet + '</div><div class="ns-bitrow">';
        for (var b = 0; b < 8; b++) {
          var idx = o * 8 + b, bit = (octet >> (7 - b)) & 1;
          html += '<span class="' + (idx < d.prefix ? "ns-net" : "ns-host") + '">' + bit + "</span>";
        }
        html += "</div></div>";
      }
      bits.innerHTML = html + '<div class="ns-legend"><span class="ns-net">■</span> ' + d.prefix + " " + TEXT.netBits +
        ' &nbsp; <span class="ns-host">■</span> ' + (32 - d.prefix) + " " + TEXT.hostBits + "</div>";
      var rows = [
        [TEXT.network, ipStr(d.network) + "/" + d.prefix],
        [TEXT.mask, ipStr(d.mask)],
        [TEXT.range, d.prefix >= 31 ? ipStr(d.first) + " – " + ipStr(d.lastHost) : ipStr(d.first) + " – " + ipStr(d.lastHost)],
        [TEXT.broadcast, ipStr(d.last)],
        [TEXT.size, "2<sup>" + (32 - d.prefix) + "</sup> = " + d.size.toLocaleString(PT ? "pt-BR" : "en-US")],
        [TEXT.usable, d.usable.toLocaleString(PT ? "pt-BR" : "en-US")],
        [TEXT.aws, d.aws === null ? "—" : d.aws.toLocaleString(PT ? "pt-BR" : "en-US")],
        [TEXT.kind, '<span class="ns-kind ns-k-' + d.kind.kind + '">' + TEXT.kinds[d.kind.kind] + "</span>" + (d.kind.block ? " · <code>" + d.kind.block + "</code>" : "")]
      ];
      facts.innerHTML = (d.hostBitsSet ? '<p class="ns-note">' + fmt(TEXT.hostBitsSet, [ipStr(d.network) + "/" + d.prefix]) + "</p>" : "") +
        "<table class=\"ns-t\"><tbody>" + rows.map(function (r) { return "<tr><th>" + r[0] + "</th><td>" + r[1] + "</td></tr>"; }).join("") + "</tbody></table>";
      var k = +sel.value, subs = k ? split(input.value, k) : [];
      list.innerHTML = subs.length ? "<ol>" + subs.map(function (s) { return "<li><code>" + s + "</code></li>"; }).join("") + "</ol>" : "";
      var t = parseIp(test.value);
      if (test.value.trim() === "" || t === null) { testOut.innerHTML = ""; }
      else {
        var block = ipStr(d.network) + "/" + d.prefix;
        if (inCidr(block, t)) {
          var which = subs.filter(function (s) { return inCidr(s, t); })[0];
          testOut.innerHTML = '<span class="ns-ok">' + fmt(TEXT.inside, [ipStr(t), block]) + (which ? fmt(TEXT.insideSub, [which]) : "") + "</span>";
        } else {
          testOut.innerHTML = '<span class="ns-out">' + fmt(TEXT.outside, [ipStr(t), block]) + "</span>";
        }
      }
    }
    input.addEventListener("input", function () { update(false); });
    range.addEventListener("input", function () { update(true); });
    sel.addEventListener("change", function () { update(false); });
    test.addEventListener("input", function () { update(false); });
    update(false);
  }

  /* ------------------------------------------------------------------ packet walk */

  var NODES = {
    internet: ["fan", "home", "attacker", "net", "psp", "mirror"],
    pub: ["alb", "nat"], app: ["order", "payment"], data: ["db"]
  };

  function packetTool(root) {
    var opts = {
      nat: root.getAttribute("data-nat") !== "off",
      albPublic: root.getAttribute("data-albpublic") !== "off",
      dbRule: root.getAttribute("data-dbrule") !== "off"
    };
    var scenario = root.getAttribute("data-scenario") || "fan-site";
    var steps = [], cur = 0, timer = null, model = null;
    root.innerHTML = "";

    var top = el("div", "ns-row");
    var sel = el("select"); sel.setAttribute("aria-label", TEXT.scen);
    SCENARIO_ORDER.forEach(function (id) { var o = el("option", null, TEXT.scenarios[id]); o.value = id; sel.appendChild(o); });
    sel.value = scenario;
    var l1 = el("label", "ns-label", TEXT.scen + " "); l1.appendChild(sel); top.appendChild(l1);
    var sw = el("div", "ns-row ns-switches", "<span>" + TEXT.switches + "</span>");
    [["nat", TEXT.swNat], ["albPublic", TEXT.swAlb], ["dbRule", TEXT.swDb]].forEach(function (s) {
      var cb = el("input"); cb.type = "checkbox"; cb.checked = opts[s[0]];
      cb.onchange = function () { opts[s[0]] = cb.checked; rebuild(); };
      var l = el("label", "ns-switch"); l.appendChild(cb); l.appendChild(document.createTextNode(" " + s[1])); sw.appendChild(l);
    });

    var topo = el("div", "ns-topo");
    var inet = el("div", "ns-zone ns-inet", '<div class="ns-zt">' + TEXT.internet + "</div>");
    var igwCol = el("div", "ns-igwcol");
    var vpc = el("div", "ns-zone ns-vpc", '<div class="ns-zt">' + TEXT.vpc + "</div>");
    topo.appendChild(inet); topo.appendChild(igwCol); topo.appendChild(vpc);
    var nodeEls = {};
    function chip(key) {
      var c = el("div", "ns-node"); c.setAttribute("data-node", key); nodeEls[key] = c; return c;
    }
    NODES.internet.forEach(function (k) { inet.appendChild(chip(k)); });
    igwCol.appendChild(chip("igw"));
    [["pub", TEXT.sPub], ["app", TEXT.sApp], ["data", TEXT.sData]].forEach(function (s) {
      var box = el("div", "ns-subnet ns-s-" + s[0]);
      box.innerHTML = '<div class="ns-st"></div>';
      box.setAttribute("data-subnet", s[0]);
      NODES[s[0]].forEach(function (k) { box.appendChild(chip(k)); });
      vpc.appendChild(box);
    });

    var panel = el("div", "ns-panel");
    var bar = el("div", "ns-bar");
    function btn(name, label, fn) { var b = el("button", "ns-btn", name); b.type = "button"; b.title = label; b.setAttribute("aria-label", label); b.onclick = fn; bar.appendChild(b); return b; }
    btn("⟲", TEXT.reset, function () { stop(); show(0); });
    btn("‹", TEXT.prev, function () { stop(); show(cur - 1); });
    var playBtn = btn("▶", TEXT.play, function () { timer ? stop() : play(); });
    btn("›", TEXT.next, function () { stop(); show(cur + 1); });
    var counter = el("span", "ns-count"); bar.appendChild(counter);

    [top, sw, topo, panel, bar].forEach(function (x) { root.appendChild(x); });
    sel.onchange = function () { scenario = sel.value; rebuild(); };

    function labelNodes() {
      Object.keys(nodeEls).forEach(function (k) {
        var h = model.hosts[k], lines = [];
        if (h && h.ip) lines.push("<code>" + h.ip + "</code>");
        if (h && h.pub) lines.push('<code class="ns-pub">' + h.pub + "</code>");
        if (k === "net") lines.push("<small>BGP</small>");
        nodeEls[k].innerHTML = "<b>" + TEXT.names[k] + "</b>" + lines.join(" ");
      });
      Array.prototype.forEach.call(vpc.querySelectorAll(".ns-subnet"), function (box) {
        var s = model.subnets[box.getAttribute("data-subnet")];
        var name = { pub: TEXT.sPub, app: TEXT.sApp, data: TEXT.sData }[box.getAttribute("data-subnet")];
        box.querySelector(".ns-st").innerHTML = name + " <code>" + s.cidr + "</code> · <code>" + s.rt + "</code>";
      });
    }

    function rebuild() {
      stop();
      model = buildModel(opts);
      steps = walk(model, scenario);
      labelNodes();
      show(0);
    }

    function table(title, head, rows, match) {
      return '<div class="ns-tbl"><div class="ns-tt">' + title + "</div><table class=\"ns-t\"><thead><tr>" + head.map(function (h) { return "<th>" + h + "</th>"; }).join("") +
        "</tr></thead><tbody>" + (rows.length ? rows.map(function (r, i) {
          return '<tr class="' + (i === match ? "ns-match" : "") + '">' + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>";
        }).join("") : '<tr><td colspan="' + head.length + '"><i>' + TEXT.empty + "</i></td></tr>") + "</tbody></table></div>";
    }

    function show(i) {
      cur = Math.max(0, Math.min(steps.length - 1, i));
      var s = steps[cur];
      Object.keys(nodeEls).forEach(function (k) { nodeEls[k].classList.remove("ns-cur", "ns-seen", "ns-ok", "ns-drop"); });
      for (var j = 0; j < cur; j++) if (nodeEls[steps[j].node]) nodeEls[steps[j].node].classList.add("ns-seen");
      var n = nodeEls[s.node];
      if (n) n.classList.add("ns-cur", s.status === "ok" ? "ns-ok" : s.status === "drop" ? "ns-drop" : "ns-cur");
      var html = '<div class="ns-sh">' + TEXT.step + " " + (cur + 1) + " " + TEXT.of + " " + steps.length + " · <b>" + TEXT.names[s.node] + "</b>" +
        (s.status === "ok" ? ' <span class="ns-badge ns-b-ok">' + TEXT.delivered + "</span>" : s.status === "drop" ? ' <span class="ns-badge ns-b-drop">' + TEXT.dropped + "</span>" : "") + "</div>";
      html += "<p>" + fmt(TEXT.msgs[s.msg], s.args || [], s.pkt) + "</p>";
      if (s.pkt) {
        var ch = s.changed || [];
        html += '<div class="ns-pkt"><span class="ns-pl">' + TEXT.packet + '</span><span class="' + (ch.indexOf("src") >= 0 ? "ns-chg" : "") + '"><small>' + TEXT.src + "</small> <code>" + s.pkt.src + ":" + s.pkt.sport + "</code></span> → " +
          '<span class="' + (ch.indexOf("dst") >= 0 ? "ns-chg" : "") + '"><small>' + TEXT.dst + "</small> <code>" + s.pkt.dst + ":" + s.pkt.dport + "</code></span></div>";
      }
      var side = "";
      if (s.table) side += table(TEXT.routeTable + " <code>" + s.table.name + "</code>", [TEXT.destCol, TEXT.targetCol],
        s.table.rows.map(function (r) { return ["<code>" + r.dst + "</code>", TEXT.targets[r.target] || r.target]; }), s.table.match);
      if (s.sg) side += table(TEXT.sgTable + " <code>" + s.sg.name + "</code>", [TEXT.portCol, TEXT.fromCol],
        s.sg.rules.map(function (r) { return ["<code>" + r.port + "</code>", "<code>" + r.from + "</code>"]; }), s.sg.match);
      if (s.nat && s.nat.length && (s.node === "nat" || s.node === "igw" || s.msg === "replyArrives")) side += table(TEXT.natTable, [TEXT.insideCol, TEXT.outsideCol],
        s.nat.map(function (e) { return ["<code>" + e.ip + ":" + e.port + "</code>", "<code>" + e.pub + ":" + e.pubPort + "</code>"]; }), -1);
      if (side) html += '<div class="ns-side">' + side + "</div>";
      panel.innerHTML = html;
      counter.textContent = (cur + 1) + " / " + steps.length;
    }
    function play() {
      if (cur >= steps.length - 1) show(0);
      playBtn.textContent = "❚❚";
      timer = setInterval(function () { if (cur >= steps.length - 1) stop(); else show(cur + 1); }, 2600);
    }
    function stop() { if (timer) clearInterval(timer); timer = null; playBtn.textContent = "▶"; }
    root.tabIndex = 0;
    root.addEventListener("keydown", function (e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      if (e.key === "ArrowRight") { stop(); show(cur + 1); e.preventDefault(); }
      if (e.key === "ArrowLeft") { stop(); show(cur - 1); e.preventDefault(); }
    });
    rebuild();
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll(".netsim:not([data-ns-ready])"), function (root) {
      root.setAttribute("data-ns-ready", "1");
      root.classList.add("ns-" + (root.getAttribute("data-tool") || "cidr"));
      if (root.getAttribute("data-tool") === "packet") packetTool(root); else cidrTool(root);
    });
  }
  if (typeof document$ !== "undefined") document$.subscribe(init);
  else document.addEventListener("DOMContentLoaded", init);
})();
