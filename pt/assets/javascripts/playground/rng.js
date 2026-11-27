/*
 * System Design Playground: seeded random numbers.
 *
 * Every random draw of the simulator comes from here, so that the same seed,
 * the same design and the same load profile always produce the same run.
 * A run owns one generator per *purpose* (arrivals, events, traces, ...):
 * changing the chaos level, for example, draws more numbers from the
 * "events" stream but does not reshuffle the arrivals of the clients.
 *
 * Works in the browser (window.SDP.rng) and in Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.SDP = root.SDP || {}; root.SDP.rng = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* 32-bit string hash (xmur3 finaliser): turns "seed:purpose" into a state. */
  function hash(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  /* mulberry32: tiny, fast PRNG with a 32-bit state; plenty for a simulator. */
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Stream(seed, name) {
    this.next = mulberry32(hash(String(seed) + ":" + name));
    this.spare = null;
  }

  Stream.prototype = {
    /* uniform in [0, 1) */
    random: function () { return this.next(); },
    uniform: function (a, b) { return a + (b - a) * this.next(); },
    /* integer in [a, b] */
    int: function (a, b) { return a + Math.floor((b - a + 1) * this.next()); },
    chance: function (p) { return this.next() < p; },
    pick: function (arr) { return arr.length ? arr[Math.floor(arr.length * this.next())] : undefined; },
    /* index chosen with probability proportional to weights[i] */
    weighted: function (weights) {
      var total = 0, i;
      for (i = 0; i < weights.length; i++) total += weights[i];
      if (!(total > 0)) return -1;
      var r = this.next() * total;
      for (i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
      return weights.length - 1;
    },
    /* standard normal (Box–Muller, caching the second value) */
    normal: function () {
      if (this.spare !== null) { var s = this.spare; this.spare = null; return s; }
      var u = 0, v = 0;
      while (u === 0) u = this.next();
      v = this.next();
      var r = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * v;
      this.spare = r * Math.sin(th);
      return r * Math.cos(th);
    },
    /* lognormal with the given median and shape sigma: median · e^(σ·Z) */
    lognormal: function (median, sigma) { return median * Math.exp(sigma * this.normal()); },
    exponential: function (mean) { return mean > 0 ? -mean * Math.log(1 - this.next()) : 0; },
    /* Poisson count with the given mean: exact (Knuth) for small means,
       normal approximation for large ones (a tick can carry 200 000 arrivals). */
    poisson: function (mean) {
      if (!(mean > 0)) return 0;
      if (mean < 30) {
        var L = Math.exp(-mean), k = 0, p = 1;
        do { k++; p *= this.next(); } while (p > L);
        return k - 1;
      }
      return Math.max(0, Math.round(mean + Math.sqrt(mean) * this.normal()));
    }
  };

  /* One generator per purpose, all derived from the same seed. */
  function create(seed) {
    var streams = {};
    return {
      seed: seed,
      stream: function (name) {
        return streams[name] || (streams[name] = new Stream(seed, name));
      }
    };
  }

  /* A fresh random seed for the 🎲 button (not reproducible on purpose). */
  function newSeed() { return 1 + Math.floor(Math.random() * 999999); }

  /* Standard normal CDF (Abramowitz–Stegun 7.1.26), used by the engine to get
     P(latency > timeout) of a lognormal without sampling. */
  function phi(x) {
    var s = x < 0 ? -1 : 1, z = Math.abs(x) / Math.SQRT2;
    var t = 1 / (1 + 0.3275911 * z);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return 0.5 * (1 + s * y);
  }

  return { create: create, hash: hash, mulberry32: mulberry32, newSeed: newSeed, phi: phi, Stream: Stream };
});
