import { load, test, eq, ok, tipHas, fmt } from "./lib.mjs";

const R = load("rsa");
const S = x => String(x);   // BigInt → string, for eq (JSON cannot hold a BigInt)

test("square-and-multiply matches repeated multiplication on small numbers", () => {
  for (let b = 0n; b < 40n; b += 3n) for (let e = 0n; e < 30n; e++) for (const m of [7n, 97n, 3233n]) {
    let naive = 1n % m;
    for (let i = 0n; i < e; i++) naive = naive * b % m;
    ok(R.modpow(b, e, m) === naive, `${b}^${e} mod ${m}`);
  }
});

test("square-and-multiply works on big numbers (Fermat on the Mersenne prime 2^127 − 1)", () => {
  const p = 2n ** 127n - 1n;
  for (const a of [2n, 3n, 65537n, 10n ** 30n + 7n]) eq(S(R.modpow(a, p - 1n, p)), "1", `${a}^(p−1) mod p`);
  /* a 2048-bit-sized exponent costs about one squaring per bit, not 2^2048 multiplications */
  const tr = R.modpowTrace(3n, 2n ** 2047n + 12345n, p);
  ok(tr.squarings === 2047 && tr.multiplications < 20, `ops ${tr.squarings} + ${tr.multiplications}`);
});

test("operation count: one squaring per bit after the first, one multiplication per further 1 bit", () => {
  const a = R.modpowTrace(65, 17, 3233), b = R.modpowTrace(2790, 2753, 3233);
  eq([a.bits, a.squarings, a.multiplications], ["10001", 4, 1], "65^17");
  eq([b.bits, b.squarings, b.multiplications], ["101011000001", 11, 4], "2790^2753");
});

test("extended Euclid: every remainder is t·e mod φ, and the last nonzero one is the gcd", () => {
  for (const phi of [120n, 3120n, 8448n, 1000n]) for (const e of [3n, 5n, 7n, 11n, 13n, 17n]) {
    const x = R.euclid(phi, e);
    x.rows.forEach(r => { ok(r.a === r.q * r.b + r.r, "division"); if (r.r) ok(R.mod(r.t * e, phi) === r.r % phi, `${r.r} ≡ ${r.t}·${e}`); });
    ok(x.gcd === R.gcd(phi, e), "gcd");
    if (x.gcd === 1n) ok(R.mod(R.inverse(e, phi) * e, phi) === 1n, "inverse");
    else ok(R.inverse(e, phi) === null, "no inverse");
  }
});

test("the page's key: p = 61, q = 53, e = 17 → n = 3233, φ = 3120, d = 2753 in 4 divisions", () => {
  const k = R.keygen(61, 53, 17);
  eq([S(k.n), S(k.phi), S(k.gcd), S(k.d), k.rows.length, R.stepCount(k)], ["3233", "3120", "1", "2753", 4, 7], "key");
  eq(k.rows.map(r => [S(r.a), S(r.q), S(r.b), S(r.r), S(r.t)]),
    [["3120", "183", "17", "9", "-183"], ["17", "1", "9", "8", "184"], ["9", "1", "8", "1", "-367"], ["8", "8", "1", "0", "3120"]], "rows");
  /* the standards' λ(n) = lcm(60, 52) = 780 gives a smaller d that works the same */
  eq(S(R.inverse(17n, 780n)), "413", "d with λ");
  ok(R.decrypt(R.encrypt(65n, 17n, 3233n), 413n, 3233n) === 65n, "d = 413 decrypts too");
});

test("bad choices are refused: e sharing a factor with φ, p = q, non-primes", () => {
  eq([3, 5, 13].map(e => S(R.keygen(61, 53, e).gcd)), ["3", "5", "13"], "gcd with 3120 = 2⁴·3·5·13");
  ok([3, 5, 13].every(e => R.keygen(61, 53, e).error === "gcd" && R.keygen(61, 53, e).d === null), "no d");
  eq(S(R.keygen(61, 53, 7).d), "1783", "e = 7 works");
  eq(R.keygen(61, 61, 17).error, "same", "p = q");
  eq(R.keygen(60, 53, 17).error, "notprime", "60");
  eq(R.stepCount(R.keygen(61, 61, 17)), 0, "no walk-through");
});

test("every key from the prime list round-trips every m < n, and signatures verify", () => {
  let keys = 0;
  for (const p of R.PRIMES) for (const q of R.PRIMES) for (const e of R.EXPONENTS) {
    if (p >= q) continue;
    const k = R.keygen(p, q, e);
    if (k.error) { ok(k.error === "gcd", `${p},${q},${e}: ${k.error}`); continue; }
    keys++;
    const step = k.n > 2000n ? 37n : 1n;
    for (let m = 0n; m < k.n; m += step) {
      ok(R.decrypt(R.encrypt(m, k.e, k.n), k.d, k.n) === m, `${p},${q},${e}: m = ${m}`);
      ok(R.verify(R.sign(m, k.d, k.n), k.e, k.n, m).ok, `sign ${m}`);
    }
  }
  ok(keys > 300, `${keys} keys`);
});

test("encrypt 65 → 2790, sign 123 → 2746; a tampered signature fails", () => {
  eq(S(R.encrypt(65n, 17n, 3233n)), "2790", "c");
  eq(S(R.decrypt(2790n, 2753n, 3233n)), "65", "m");
  eq(S(R.sign(123n, 2753n, 3233n)), "2746", "s");
  const bad = R.verify(2747n, 17n, 3233n, 123n);
  eq([bad.ok, S(bad.recovered)], [false, "837"], "tampered");
});

test("textbook RSA is deterministic: HELLO encrypts both L's to 2726", () => {
  const rows = R.encryptAll(R.encode("HELLO", 3233n).items, 17n, 3233n, 2753n);
  eq(rows.map(r => S(r.c)), ["3000", "28", "2726", "2726", "1307"], "c");
  eq(rows.map(r => r.dupOf), [-1, -1, -1, 2, -1], "dup");
  ok(rows.every(r => r.back === r.m), "decrypts back");
  eq(R.encode("70000", 3233n).error, "big", "m ≥ n");
  eq(R.encode("é", 143n).error, "big", "code ≥ n");
  eq(R.encode("", 3233n).error, "empty", "empty");
});

test("malleability: c·2^e decrypts to 2m", () => {
  eq(S(R.decrypt(2790n * R.modpow(2n, 17n, 3233n) % 3233n, 2753n, 3233n)), "130", "2·65");
});

test("dictionary attack: grade B found in 2 tries; a random pad multiplies the work by PAD", () => {
  const cands = R.GRADES.map(g => g.codePointAt(0));
  const c = R.encrypt(66n, 17n, 3233n);
  const a = R.dictionaryAttack(c, 17n, 3233n, cands, false);
  eq([S(a.m), a.tries, R.attackSpace(cands, false)], ["66", 2, 6], "plain");
  ok(R.canPad(70, 3233n) && !R.canPad(70, 143n), "room for the pad");
  const seen = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const r = BigInt(Math.floor(R.rng(seed)() * R.PAD));
    const cp = R.padEncrypt(66n, r, 17n, 3233n);
    seen.add(S(cp));
    const b = R.dictionaryAttack(cp, 17n, 3233n, cands, true);
    ok(b.m === 66n && b.r === r && b.tries === R.PAD + Number(r) + 1, `padded tries ${b.tries}`);
  }
  ok(seen.size > 3, "the same grade gives different ciphertexts");
  eq(R.attackSpace(cands, true), 60, "padded space");
});

test("trial division factors 3233 in 27 divisions and recovers d; 2048 bits ≈ 10^308", () => {
  const r = R.recoverD(3233n, 17n);
  eq([S(r.factors.p), S(r.factors.q), r.factors.divisions, S(r.phi), S(r.d)], ["53", "61", 27, "3120", "2753"], "attack");
  eq(R.factor(97n * 89n).divisions, 1 + (89 - 3) / 2 + 1, "89 × 97");
  eq([R.trialExp(2048), R.sup(308)], [308, "³⁰⁸"], "2048 bits");
});

test("the tip quotes the model's numbers", () => {
  const k = R.keygen(61, 53, 17), f = R.factor(k.n);
  const cands = R.GRADES.map(g => g.codePointAt(0));
  tipHas("rsa", lang => [
    "p = 61", "q = 53", "e = 17",
    "n = " + fmt(Number(k.n), 0, lang), "φ(n) = " + fmt(Number(k.phi), 0, lang), "d = " + fmt(Number(k.d), 0, lang),
    String(k.rows.length) + (lang === "pt" ? " divisões" : " divisions"),
    "gcd(3, " + fmt(Number(k.phi), 0, lang) + ") = 3",
    "65 → " + fmt(Number(R.encrypt(65n, 17n, 3233n)), 0, lang),
    "L → " + fmt(Number(R.encrypt(76n, 17n, 3233n)), 0, lang),
    "123 → " + fmt(Number(R.sign(123n, k.d, k.n)), 0, lang),
    S(R.dictionaryAttack(R.encrypt(66n, 17n, 3233n), 17n, 3233n, cands, false).tries),
    S(R.attackSpace(cands, true)),
    S(f.p) + " × " + S(f.q), S(f.divisions),
    "10" + R.sup(R.trialExp(2048))
  ]);
});
