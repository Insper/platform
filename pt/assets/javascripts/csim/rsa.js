/*
 * RSA with small numbers (appendix — RSA & Ed25519):
 *
 *   <div class="csim" data-sim="rsa" data-p="61" data-q="53" data-e="17"></div>
 *
 * How are the keys built, and why is textbook RSA unsafe? The player walks through key
 * generation: n = p·q, φ(n) = (p − 1)(q − 1), then the extended Euclidean algorithm on (φ, e),
 * one division per step, which both checks gcd(e, φ) = 1 and finds d = e⁻¹ mod φ. With the key,
 * the student encrypts and decrypts (a number or a word, letter by letter), signs and verifies,
 * watches a dictionary attack work because textbook RSA is deterministic, and factors the small
 * n by trial division to recover d. All arithmetic is BigInt, with square-and-multiply.
 */
(function () {
  "use strict";

  var PRIMES = [11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
  var EXPONENTS = [3, 5, 7, 11, 13, 17];
  var GRADES = ["A", "B", "C", "D", "E", "F"];
  var PAD = 10;            /* toy padding: m' = m·PAD + r, r random in 0..PAD−1 */
  var MAX_CHARS = 16;

  function big(x) { return typeof x === "bigint" ? x : BigInt(x); }
  function mod(a, m) { a = big(a); m = big(m); var r = a % m; return r < 0n ? r + m : r; }

  /* square-and-multiply, left to right: one squaring per bit after the first, one multiplication per further 1 bit */
  function modpowTrace(b, e, m) {
    b = big(b); e = big(e); m = big(m);
    if (m === 1n) return { value: 0n, squarings: 0, multiplications: 0, bits: "" };
    if (e < 0n) throw new Error("negative exponent");
    if (e === 0n) return { value: 1n, squarings: 0, multiplications: 0, bits: "0" };
    var bits = e.toString(2), base = mod(b, m), r = base, sq = 0, mul = 0;
    for (var i = 1; i < bits.length; i++) {
      r = r * r % m; sq++;
      if (bits[i] === "1") { r = r * base % m; mul++; }
    }
    return { value: r, squarings: sq, multiplications: mul, bits: bits };
  }
  function modpow(b, e, m) { return modpowTrace(b, e, m).value; }

  function gcd(a, b) { a = big(a); b = big(b); if (a < 0n) a = -a; if (b < 0n) b = -b; while (b) { var t = a % b; a = b; b = t; } return a; }

  function isPrime(n) {
    n = big(n);
    if (n < 2n) return false;
    if (n % 2n === 0n) return n === 2n;
    for (var d = 3n; d * d <= n; d += 2n) if (n % d === 0n) return false;
    return true;
  }

  /*
   * Extended Euclid on (phi, e), keeping only e's coefficient: every remainder r satisfies
   * r ≡ t·e (mod phi). Rows: {a, b, q, r, t} for a = q·b + r. When r reaches 1, t is e⁻¹.
   */
  function euclid(phi, e) {
    phi = big(phi); e = big(e);
    var r0 = phi, r1 = e, t0 = 0n, t1 = 1n, rows = [];
    while (r1 !== 0n) {
      var q = r0 / r1, r2 = r0 - q * r1, t2 = t0 - q * t1;
      rows.push({ a: r0, b: r1, q: q, r: r2, t: t2 });
      r0 = r1; r1 = r2; t0 = t1; t1 = t2;
    }
    return { rows: rows, gcd: r0, t: t0 };
  }

  function inverse(e, m) {
    var x = euclid(m, e);
    return x.gcd === 1n ? mod(x.t, m) : null;
  }

  /* error: null | "notprime" | "same" | "erange" | "gcd" */
  function keygen(p, q, e) {
    var P = big(p), Q = big(q), E = big(e);
    var k = { p: P, q: Q, e: E, n: P * Q, phi: (P - 1n) * (Q - 1n), rows: [], gcd: null, t: null, d: null, error: null };
    if (!isPrime(P) || !isPrime(Q)) { k.error = "notprime"; return k; }
    if (P === Q) { k.error = "same"; return k; }
    if (E <= 1n || E >= k.phi) { k.error = "erange"; return k; }
    var x = euclid(k.phi, E);
    k.rows = x.rows; k.gcd = x.gcd; k.t = x.t;
    if (x.gcd !== 1n) k.error = "gcd";
    else k.d = mod(x.t, k.phi);
    return k;
  }

  /* steps of the walk-through: n, φ, one per division, the verdict */
  function stepCount(k) { return k.error && k.error !== "gcd" ? 0 : 2 + k.rows.length + 1; }

  function encrypt(m, e, n) { return modpow(m, e, n); }
  function decrypt(c, d, n) { return modpow(c, d, n); }
  function sign(h, d, n) { return modpow(h, d, n); }
  function verify(s, e, n, h) { var rec = modpow(s, e, n); return { recovered: rec, ok: rec === mod(h, n) }; }

  /* a number (m < n) or a short word, letter by letter: [{ch, m}] — error: null | "empty" | "long" | "big" */
  function encode(text, n) {
    n = big(n);
    var s = String(text == null ? "" : text).trim();
    if (!s) return { items: [], error: "empty" };
    if (/^\d+$/.test(s)) {
      var m = BigInt(s);
      return { items: [{ ch: null, m: m }], error: m >= n ? "big" : null };
    }
    var chars = Array.from(s);
    if (chars.length > MAX_CHARS) return { items: [], error: "long" };
    var items = chars.map(function (ch) { return { ch: ch, m: BigInt(ch.codePointAt(0)) }; });
    return { items: items, error: items.some(function (it) { return it.m >= n; }) ? "big" : null };
  }

  /* encrypt each item; dupOf[i] = index of the first earlier item with the same ciphertext, or -1 */
  function encryptAll(items, e, n, d) {
    var rows = items.map(function (it) {
      var c = encrypt(it.m, e, n);
      return { ch: it.ch, m: it.m, c: c, back: d == null ? null : decrypt(c, d, n), dupOf: -1 };
    });
    rows.forEach(function (r, i) {
      for (var j = 0; j < i; j++) if (rows[j].c === r.c) { r.dupOf = j; break; }
    });
    return rows;
  }

  /* seeded PRNG (mulberry32), the same as the core's, so a run can be replayed and tested */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* toy randomized padding: room is needed for m·PAD + PAD − 1 < n */
  function canPad(maxM, n) { return big(maxM) * BigInt(PAD) + BigInt(PAD - 1) < big(n); }
  function padEncrypt(m, r, e, n) { return encrypt(big(m) * BigInt(PAD) + big(r), e, n); }

  /*
   * The attacker knows the public key and that the secret is one of `candidates` (numbers):
   * encrypt each candidate (with every padding, if padded) until one matches c.
   */
  function dictionaryAttack(c, e, n, candidates, padded) {
    c = big(c);
    var tries = 0;
    for (var i = 0; i < candidates.length; i++) {
      var m = big(candidates[i]);
      if (!padded) { tries++; if (encrypt(m, e, n) === c) return { m: m, r: null, tries: tries }; continue; }
      for (var r = 0; r < PAD; r++) { tries++; if (padEncrypt(m, r, e, n) === c) return { m: m, r: BigInt(r), tries: tries }; }
    }
    return { m: null, r: null, tries: tries };
  }
  function attackSpace(candidates, padded) { return candidates.length * (padded ? PAD : 1); }

  /* trial division: 2, then 3, 5, 7, … up to √n; counts every division tried */
  function factor(n) {
    n = big(n);
    var divisions = 0;
    divisions++;
    if (n % 2n === 0n) return { p: 2n, q: n / 2n, divisions: divisions };
    for (var d = 3n; d * d <= n; d += 2n) {
      divisions++;
      if (n % d === 0n) return { p: d, q: n / d, divisions: divisions };
    }
    return { p: null, q: null, divisions: divisions };
  }
  function recoverD(n, e) {
    var f = factor(n);
    if (!f.p) return { factors: f, phi: null, d: null };
    var phi = (f.p - 1n) * (f.q - 1n);
    return { factors: f, phi: phi, d: inverse(e, phi) };
  }
  /* trial division up to √n for a `bits`-bit modulus tries about 2^(bits/2 − 1) odd numbers: the power of ten */
  function trialExp(bits) { return Math.round((bits / 2 - 1) * Math.log10(2)); }

  function sup(n) { return String(n).replace(/[0-9-]/g, function (c) { return "⁻⁰¹²³⁴⁵⁶⁷⁸⁹"["-0123456789".indexOf(c)]; }); }

  var API = { PRIMES: PRIMES, EXPONENTS: EXPONENTS, GRADES: GRADES, PAD: PAD, MAX_CHARS: MAX_CHARS,
    mod: mod, modpow: modpow, modpowTrace: modpowTrace, gcd: gcd, isPrime: isPrime, euclid: euclid, inverse: inverse,
    keygen: keygen, stepCount: stepCount, encrypt: encrypt, decrypt: decrypt, sign: sign, verify: verify,
    encode: encode, encryptAll: encryptAll, rng: rng, canPad: canPad, padEncrypt: padEncrypt,
    dictionaryAttack: dictionaryAttack, attackSpace: attackSpace, factor: factor, recoverD: recoverD, trialExp: trialExp, sup: sup };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el;
  var LOC = C.PT ? "pt-BR" : "en";
  function num(x) { return big(x).toLocaleString(LOC); }
  function signed(x) { x = big(x); return x < 0n ? "−" + num(-x) : num(x); }

  C.style("rsa", [
    ".md-typeset .csim-rsa-steps { list-style: none; margin: .2rem 0; padding: 0; counter-reset: rsa; }",
    ".md-typeset .csim-rsa-steps li { margin: 0 0 .2rem; padding: .25rem .5rem; border-left: .2rem solid var(--c-line); border-radius: .2rem; background: var(--c-panel); }",
    ".md-typeset .csim-rsa-steps li.now { border-left-color: var(--c-ink); background: var(--c-tint); }",
    ".md-typeset .csim-rsa-steps li.ok { border-left-color: var(--c-ok); }",
    ".md-typeset .csim-rsa-steps li.bad { border-left-color: var(--c-bad); }",
    ".md-typeset .csim-rsa-steps li.todo { opacity: .45; }",
    ".md-typeset .csim-rsa-f { font-family: var(--md-code-font-family); font-variant-numeric: tabular-nums; }",
    ".md-typeset .csim-rsa-w { color: var(--c-fg2); font-size: .62rem; display: block; }",
    ".md-typeset .csim-rsa-key { display: flex; flex-wrap: wrap; gap: .4rem; margin: .3rem 0; }",
    ".md-typeset .csim-rsa-key span { font-family: var(--md-code-font-family); padding: .15rem .45rem; border-radius: .3rem; border: .05rem solid var(--c-line); }",
    ".md-typeset .csim-rsa-key .pub { border-color: var(--c-ok); color: var(--c-ok); }",
    ".md-typeset .csim-rsa-key .priv { border-color: var(--c-bad); color: var(--c-bad); }",
    ".md-typeset .csim-rsa-use { margin-top: .6rem; padding-top: .5rem; border-top: .05rem solid var(--c-line); }",
    ".md-typeset .csim-rsa-in { font: inherit; font-family: var(--md-code-font-family); padding: .15rem .4rem; width: 9rem;",
    "  border: .05rem solid var(--c-line); border-radius: .3rem; background: var(--c-bg); color: var(--c-fg); }",
    ".md-typeset .csim-rsa-in:focus { outline: .1rem solid var(--c-accent); border-color: var(--c-accent); }",
    ".md-typeset .csim-rsa-tbl { border-collapse: collapse; margin: .3rem 0; font-variant-numeric: tabular-nums; }",
    ".md-typeset .csim-rsa-tbl th, .md-typeset .csim-rsa-tbl td { padding: .12rem .55rem; border-bottom: .05rem solid var(--c-line); text-align: right; }",
    ".md-typeset .csim-rsa-tbl th { color: var(--c-fg2); font-weight: 600; }",
    ".md-typeset .csim-rsa-tbl td { font-family: var(--md-code-font-family); }",
    ".md-typeset .csim-rsa-tbl tr.dup td { color: var(--c-warn); font-weight: 700; }",
    ".md-typeset .csim-rsa-tbl tr.hit td { color: var(--c-bad); font-weight: 700; }",
    ".md-typeset .csim-rsa-tbl tr.ok td.v { color: var(--c-ok); font-weight: 700; }",
    ".md-typeset .csim-rsa-tbl tr.bad td.v { color: var(--c-bad); font-weight: 700; }",
    ".md-typeset .csim-rsa-scroll { overflow-x: auto; }"
  ].join("\n"));

  C.register("rsa", function (root) {
    var o = C.opts(root, { p: 61, q: 53, e: 17 });
    function idx(p) { var i = PRIMES.indexOf(p); return i < 0 ? PRIMES.indexOf(61) : i; }
    var k = null, shown = 0, mode = "enc", rand = rng(1), lastPad = -1;
    var intercepted = [];

    var steps = el("ol", { class: "csim-rsa-steps" });
    var keyBox = el("div", { class: "csim-rsa-key" });
    var note = el("p", { class: "csim-note" });
    var st = C.stats([
      { key: "n", label: t("n = p × q (public)", "n = p × q (público)") },
      { key: "phi", label: t("φ(n) (secret)", "φ(n) (secreto)") },
      { key: "gcd", label: "gcd(e, φ)" },
      { key: "d", label: t("d = e⁻¹ mod φ (private)", "d = e⁻¹ mod φ (privado)") }
    ]);
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    var sp = C.slider({ label: "p", min: 0, max: PRIMES.length - 1, value: idx(o.p), fmt: function (i) { return String(PRIMES[i]); }, onInput: rebuild });
    var sq = C.slider({ label: "q", min: 0, max: PRIMES.length - 1, value: idx(o.q), fmt: function (i) { return String(PRIMES[i]); }, onInput: rebuild });
    var ce = C.choice({ label: "e", value: EXPONENTS.indexOf(o.e) < 0 ? 17 : o.e,
      options: EXPONENTS.map(function (v) { return { value: v, label: String(v) }; }), onChange: rebuild });

    var bar = C.player({ interval: 1100,
      onTick: function (n) {
        if (!stepCount(k)) { bar.jump(0); shown = 0; draw(); return false; }
        shown = n; draw(); return n < stepCount(k);
      },
      onPrev: function (n) { shown = n; draw(); },
      onReset: function () { shown = 0; draw(); } });

    /* ---------------------------------------------------------------- key generation */

    function stepItems() {
      var out = [];
      out.push({ f: "n = p × q = " + num(k.p) + " × " + num(k.q) + " = " + num(k.n),
        w: t("Public: the modulus. Multiplying is easy; going back from n to p and q is the hard problem.",
          "Público: o módulo. Multiplicar é fácil; voltar de n para p e q é o problema difícil."),
        say: t("n = " + num(k.n) + " goes into both keys. Anyone may know it.", "n = " + num(k.n) + " entra nas duas chaves. Qualquer um pode conhecê-lo.") });
      out.push({ f: "φ(n) = (p − 1)(q − 1) = " + num(k.p - 1n) + " × " + num(k.q - 1n) + " = " + num(k.phi),
        w: t("Secret: computing φ(n) needs p and q. Whoever knows φ(n) can compute d.",
          "Secreto: calcular φ(n) exige p e q. Quem conhece φ(n) consegue calcular d."),
        say: t("φ(n) = " + num(k.phi) + " counts the numbers below n that share no factor with it. Now find d with e·d ≡ 1 (mod " + num(k.phi) + ").",
          "φ(n) = " + num(k.phi) + " conta os números abaixo de n sem fator comum com ele. Agora ache d com e·d ≡ 1 (mod " + num(k.phi) + ").") });
      k.rows.forEach(function (r, i) {
        var tail = r.r === 0n ? t("remainder 0: stop", "resto 0: fim") : num(r.r) + " ≡ " + signed(r.t) + " · e  (mod φ)";
        out.push({ f: num(r.a) + " = " + num(r.q) + " × " + num(r.b) + " + " + num(r.r) + "     → " + tail,
          w: i === 0 ? t("Extended Euclid: divide, and write each remainder as a multiple of e (mod φ).",
            "Euclides estendido: divida e escreva cada resto como um múltiplo de e (mod φ).") : null,
          say: r.r === 0n
            ? t("The last nonzero remainder, " + num(r.b) + ", is gcd(e, φ).", "O último resto não nulo, " + num(r.b) + ", é o gcd(e, φ).")
            : r.r === 1n
              ? t("Remainder 1 = " + signed(r.t) + " · e (mod φ): that coefficient is the inverse of e.", "Resto 1 = " + signed(r.t) + " · e (mod φ): esse coeficiente é o inverso de e.")
              : t("Division " + (i + 1) + ": " + num(r.a) + " ÷ " + num(r.b) + " = " + num(r.q) + ", remainder " + num(r.r) + ".",
                "Divisão " + (i + 1) + ": " + num(r.a) + " ÷ " + num(r.b) + " = " + num(r.q) + ", resto " + num(r.r) + ".") });
      });
      if (k.error === "gcd") {
        out.push({ f: "gcd(" + num(k.e) + ", " + num(k.phi) + ") = " + num(k.gcd) + " ≠ 1  ✗", tone: "bad",
          w: t("e shares the factor " + num(k.gcd) + " with φ(n): no d exists. Pick another e.",
            "e tem o fator " + num(k.gcd) + " em comum com φ(n): não existe d. Escolha outro e."),
          say: t("No key: e = " + num(k.e) + " divides φ(n) = " + num(k.phi) + ". Real keys use e = 65537, a prime, and regenerate p, q if needed.",
            "Sem chave: e = " + num(k.e) + " divide φ(n) = " + num(k.phi) + ". Chaves reais usam e = 65537, um primo, e geram outros p, q se preciso."), sayTone: "bad" });
      } else {
        out.push({ f: "gcd = 1 ✓   d = " + signed(k.t) + " mod " + num(k.phi) + " = " + num(k.d) + "   (" + num(k.e) + " × " + num(k.d) + " mod " + num(k.phi) + " = 1)", tone: "ok",
          w: t("Public key (e, n), private key (d, n). p, q and φ(n) must stay secret too.",
            "Chave pública (e, n), chave privada (d, n). p, q e φ(n) também precisam ficar secretos."),
          say: t("Key ready: d = " + num(k.d) + ". Use it below.", "Chave pronta: d = " + num(k.d) + ". Use-a abaixo."), sayTone: "ok" });
      }
      return out;
    }

    function draw() {
      C.clear(steps); C.clear(keyBox);
      var total = stepCount(k);
      ["n", "phi", "gcd", "d"].forEach(function (x) { st.set(x, "–", ""); });
      if (!total) {
        say(k.error === "same" ? t("p and q must be different primes (with p = q, n = p² and φ(n) is not (p − 1)²).",
          "p e q precisam ser primos diferentes (com p = q, n = p² e φ(n) não é (p − 1)²).")
          : t("Pick two primes and an e.", "Escolha dois primos e um e."), "bad");
        drawUse();
        return;
      }
      var items = stepItems();
      items.forEach(function (it, i) {
        var cls = i >= shown ? "todo" : i === shown - 1 ? "now" + (it.tone ? " " + it.tone : "") : it.tone || "";
        steps.appendChild(el("li", { class: cls }, [el("span", { class: "csim-rsa-f", text: i < shown ? it.f : "…" }),
          i < shown && it.w ? el("span", { class: "csim-rsa-w", text: it.w }) : null]));
      });
      if (shown >= 1) st.set("n", num(k.n), "ok");
      if (shown >= 2) st.set("phi", num(k.phi), "warn");
      if (shown >= total) {
        st.set("gcd", num(k.gcd), k.gcd === 1n ? "ok" : "bad");
        if (k.d !== null) st.set("d", num(k.d), "bad");
      }
      if (k.d !== null && shown >= total) {
        keyBox.appendChild(el("span", { class: "pub", text: t("public (e, n) = (", "pública (e, n) = (") + num(k.e) + ", " + num(k.n) + ")" }));
        keyBox.appendChild(el("span", { class: "priv", text: t("private (d, n) = (", "privada (d, n) = (") + num(k.d) + ", " + num(k.n) + ")" }));
      }
      if (shown === 0) say(t("p = " + num(k.p) + ", q = " + num(k.q) + ", e = " + num(k.e) + ". Press play (or →) to build the key, one step at a time.",
        "p = " + num(k.p) + ", q = " + num(k.q) + ", e = " + num(k.e) + ". Aperte play (ou →) para montar a chave, um passo por vez."), "");
      else { var cur = items[shown - 1]; say(cur.say, cur.sayTone || ""); }
      drawUse();
    }

    function rebuild() {
      k = keygen(PRIMES[sp.get()], PRIMES[sq.get()], ce.get());
      intercepted = [];
      bar.reset();
      bar.total(stepCount(k));
    }

    /* ---------------------------------------------------------------- using the key */

    var useBox = el("div", {});
    var useNote = el("p", { class: "csim-note" });
    function useSay(text, tone) { useNote.textContent = text; useNote.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    var modeCtl = C.choice({ label: t("Use the key", "Use a chave"), value: mode, options: [
      { value: "enc", label: t("encrypt", "cifrar") },
      { value: "sig", label: t("sign", "assinar") },
      { value: "dict", label: t("dictionary attack", "ataque de dicionário") },
      { value: "fact", label: t("factor n", "fatorar n") }
    ], onChange: function (v) { mode = v; drawUse(); } });

    var inMsg = el("input", { type: "text", class: "csim-rsa-in", value: "65", "aria-label": t("message", "mensagem"), oninput: function () { drawUse(); } });
    var inHash = el("input", { type: "text", class: "csim-rsa-in", value: "123", "aria-label": "h", oninput: function () { drawUse(); } });
    var tamper = C.toggle({ label: t("tamper: s + 1", "adulterar: s + 1"), onChange: function () { drawUse(); } });
    var grade = C.choice({ label: t("secret grade", "nota secreta"), value: "B",
      options: GRADES.map(function (g) { return { value: g, label: g }; }), onChange: function () { intercepted = []; drawUse(); } });
    var padSw = C.toggle({ label: t("random padding", "padding aleatório"), onChange: function () { intercepted = []; drawUse(); } });
    var bAgain = C.button(t("encrypt it again", "cifrar de novo"), function () { sendGrade(); drawUse(); });

    function table(head, rows) {
      return el("div", { class: "csim-rsa-scroll" }, el("table", { class: "csim-rsa-tbl" }, [
        el("thead", {}, el("tr", {}, head.map(function (h) { return el("th", { text: h }); }))),
        el("tbody", {}, rows)
      ]));
    }
    function tr(cells, cls) { return el("tr", { class: cls || null }, cells.map(function (c) { return el("td", { class: c && c.v ? "v" : null, text: c && c.v ? c.v : c }); })); }

    function sendGrade() {
      var m = BigInt(grade.get().codePointAt(0)), padded = padSw.get() && canPad(GRADES[GRADES.length - 1].codePointAt(0), k.n);
      /* a real OAEP seed never repeats; this 10-value toy pad at least never repeats the previous one */
      var r = null;
      if (padded) { r = Math.floor(rand() * (PAD - 1)); if (r >= lastPad && lastPad >= 0) r++; lastPad = r; }
      intercepted.push({ c: padded ? padEncrypt(m, r, k.e, k.n) : encrypt(m, k.e, k.n), padded: padded });
      if (intercepted.length > 4) intercepted.shift();
    }

    function drawUse() {
      C.clear(useBox);
      if (!k || k.d === null) {
        useBox.appendChild(el("div", { class: "csim-row" }, [modeCtl]));
        useSay(t("No valid key yet: pick p ≠ q and an e with gcd(e, φ) = 1.", "Ainda não há chave válida: escolha p ≠ q e um e com gcd(e, φ) = 1."), "warn");
        return;
      }
      var e = k.e, d = k.d, n = k.n;
      if (mode === "enc") {
        var enc = encode(inMsg.value, n);
        useBox.appendChild(el("div", { class: "csim-row" }, [modeCtl, el("label", { class: "csim-ctl" }, [el("span", { class: "csim-lbl", text: t("m (number < n, or a word)", "m (número < n, ou palavra)") }), inMsg])]));
        if (enc.error) {
          useSay(enc.error === "big" ? t("Every m must be smaller than n = " + num(n) + " (a letter is its character code).", "Todo m precisa ser menor que n = " + num(n) + " (uma letra é o seu código de caractere).")
            : enc.error === "long" ? t("Up to " + MAX_CHARS + " letters.", "Até " + MAX_CHARS + " letras.") : t("Type a number or a word.", "Digite um número ou uma palavra."), "bad");
          return;
        }
        var rows = encryptAll(enc.items, e, n, d);
        var word = rows.length > 1 || rows[0].ch !== null;
        useBox.appendChild(table((word ? [t("letter", "letra")] : []).concat(["m", "c = mᵉ mod n", "cᵈ mod n"]), rows.map(function (r) {
          return tr((word ? [r.ch] : []).concat([num(r.m), num(r.c), num(r.back)]), r.dupOf >= 0 ? "dup" : null);
        })));
        var dups = rows.filter(function (r) { return r.dupOf >= 0; });
        var tr1 = modpowTrace(rows[0].c, d, n);
        var ops = t(" Decrypting with d = " + num(d) + " (" + tr1.bits.length + " bits) took " + (tr1.squarings + tr1.multiplications) + " multiplications by square-and-multiply, not " + num(d - 1n) + ".",
          " Decifrar com d = " + num(d) + " (" + tr1.bits.length + " bits) levou " + (tr1.squarings + tr1.multiplications) + " multiplicações por square-and-multiply, não " + num(d - 1n) + ".");
        if (dups.length) useSay(t("Same letter, same ciphertext: " + dups.map(function (r) { return r.ch + " → " + num(r.c); }).join(", ") + ". Letter by letter, textbook RSA is a substitution cipher: frequency analysis breaks it without d.",
          "Mesma letra, mesmo texto cifrado: " + dups.map(function (r) { return r.ch + " → " + num(r.c); }).join(", ") + ". Letra a letra, o RSA de livro-texto é uma cifra de substituição: análise de frequência o quebra sem d.") + ops, "warn");
        else useSay(t("Encrypted with the public key (" + num(e) + ", " + num(n) + "), decrypted with the private key: every m comes back." , "Cifrado com a chave pública (" + num(e) + ", " + num(n) + "), decifrado com a privada: todo m volta.") + ops, "ok");
      } else if (mode === "sig") {
        useBox.appendChild(el("div", { class: "csim-row" }, [modeCtl, el("label", { class: "csim-ctl" }, [el("span", { class: "csim-lbl", text: t("h = hash of the message (< n)", "h = hash da mensagem (< n)") }), inHash]), tamper]));
        var raw = inHash.value.trim();
        if (!/^\d+$/.test(raw) || BigInt(raw) >= n) { useSay(t("h must be a number smaller than n = " + num(n) + ".", "h precisa ser um número menor que n = " + num(n) + "."), "bad"); return; }
        var h = BigInt(raw), s = sign(h, d, n), sent = tamper.get() ? mod(s + 1n, n) : s, v = verify(sent, e, n, h);
        useBox.appendChild(table([t("who", "quem"), t("computes", "calcula"), t("result", "resultado")], [
          tr([t("owner (private d)", "dono (d privado)"), "s = hᵈ mod n", num(s)]),
          tr([t("network", "rede"), t("signature sent", "assinatura enviada"), num(sent)], tamper.get() ? "bad" : null),
          tr([t("anyone (public e)", "qualquer um (e público)"), "sᵉ mod n", { v: num(v.recovered) + (v.ok ? " = h ✓" : " ≠ h ✗") }], v.ok ? "ok" : "bad")
        ]));
        useSay(v.ok ? t("Valid: only the holder of d could produce " + num(s) + ", and anyone with (e, n) can check it.",
          "Válida: só quem tem d poderia produzir " + num(s) + ", e qualquer um com (e, n) consegue conferir.")
          : t("Invalid: changing the signature by 1 gives " + num(v.recovered) + " instead of " + num(h) + ". Forging needs d.",
            "Inválida: mudar a assinatura em 1 dá " + num(v.recovered) + " em vez de " + num(h) + ". Forjar exige d."), v.ok ? "ok" : "bad");
      } else if (mode === "dict") {
        var roomy = canPad(GRADES[GRADES.length - 1].codePointAt(0), n);
        if (!roomy && padSw.get()) padSw.set(false);
        if (!intercepted.length) sendGrade();
        useBox.appendChild(el("div", { class: "csim-row" }, [modeCtl, grade, padSw, bAgain]));
        var padded = intercepted[intercepted.length - 1].padded;
        var cands = GRADES.map(function (g) { return g.codePointAt(0); });
        var last = intercepted[intercepted.length - 1].c;
        var atk = dictionaryAttack(last, e, n, cands, padded);
        useBox.appendChild(el("p", { class: "csim-rsa-f", text: t("intercepted: ", "interceptados: ") + intercepted.map(function (x) { return "c = " + num(x.c); }).join(" · ") }));
        var hi = atk.m === null ? GRADES.length : cands.indexOf(Number(atk.m));
        useBox.appendChild(table([t("attacker tries", "atacante testa"), "m", padded ? t("encryptions", "cifragens") : "mᵉ mod n", ""], GRADES.map(function (g, i) {
          var m = BigInt(cands[i]), hit = i === hi;
          var tried = i < hi ? PAD : hit ? Number(atk.r) + 1 : 0;
          return tr([g, num(m), padded ? String(tried) : num(encrypt(m, e, n)), hit ? t("match", "bate") : ""], hit ? "hit" : null);
        })));
        var space = attackSpace(cands, padded);
        if (!padded) useSay(t("Textbook RSA is deterministic: grade " + grade.get() + " always encrypts to " + num(last) + ". With the public key the attacker encrypts all " + space + " candidates and finds it after " + atk.tries + " tries, without d.",
          "O RSA de livro-texto é determinístico: a nota " + grade.get() + " sempre cifra para " + num(last) + ". Com a chave pública o atacante cifra os " + space + " candidatos e a acha após " + atk.tries + " tentativas, sem d.")
          + (roomy ? "" : t(" (n is too small for the padding demo: pick bigger primes.)", " (n é pequeno demais para a demonstração de padding: escolha primos maiores.)")), "bad");
        else useSay(t("With a random pad the same grade gives a new c each time, but this toy pad has only " + PAD + " values: up to " + space + " tries instead of " + cands.length + " (here " + atk.tries + "). OAEP's seed is as long as the hash (256 bits for SHA-256), so the attacker would face 2²⁵⁶ tries per candidate.",
          "Com padding aleatório a mesma nota dá um c novo a cada vez, mas este padding de brinquedo tem só " + PAD + " valores: até " + space + " tentativas em vez de " + cands.length + " (aqui " + atk.tries + "). A semente do OAEP tem o tamanho do hash (256 bits com SHA-256): o atacante enfrentaria 2²⁵⁶ tentativas por candidato."), "warn");
      } else {
        var rec = recoverD(n, e), f = rec.factors;
        useBox.appendChild(el("div", { class: "csim-row" }, [modeCtl]));
        useBox.appendChild(table([t("attacker", "atacante"), t("result", "resultado")], [
          tr([t("trial division: 2, 3, 5, 7, …", "divisão por tentativa: 2, 3, 5, 7, …"), num(n) + " = " + num(f.p) + " × " + num(f.q)]),
          tr([t("divisions tried", "divisões tentadas"), String(f.divisions)]),
          tr(["φ(n) = (p − 1)(q − 1)", num(rec.phi)]),
          tr(["d = e⁻¹ mod φ(n)", { v: num(rec.d) + (rec.d === d ? t(" = the private key ✓", " = a chave privada ✓") : "") }], "bad")
        ]));
        useSay(t("A small n falls to trial division in " + f.divisions + " divisions, and d follows. A 2048-bit n would need about 10" + sup(trialExp(2048)) + " trial divisions; even the best known algorithm (the number field sieve) has never factored a 2048-bit RSA modulus.",
          "Um n pequeno cai por divisão por tentativa em " + f.divisions + " divisões, e d vem junto. Um n de 2048 bits exigiria cerca de 10" + sup(trialExp(2048)) + " divisões; nem o melhor algoritmo conhecido (o crivo de corpos numéricos) já fatorou um módulo RSA de 2048 bits."), "bad");
      }
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("RSA with small numbers: how are the keys built, and why is textbook RSA unsafe?", "RSA com números pequenos: como as chaves são montadas, e por que o RSA de livro-texto é inseguro?") }),
      el("p", { class: "csim-sub", text: t("Pick two primes and a public exponent, then step through key generation. Real keys use the same steps with primes of about 1024 bits each.",
        "Escolha dois primos e um expoente público e avance pela geração das chaves. Chaves reais seguem os mesmos passos, com primos de cerca de 1024 bits cada.") }),
      el("div", { class: "csim-row" }, [sp, sq, ce]),
      bar,
      el("div", { class: "csim-cols" }, [el("div", { class: "csim-stage" }, [steps, keyBox]), el("div", {}, [st])]),
      note,
      el("div", { class: "csim-rsa-use" }, [useBox, useNote])
    ]);
    rebuild();
    return {};
  });
})();
