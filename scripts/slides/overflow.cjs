// Measures every slide of a bare Marp render (argv[2]) at 1280×720; used by overflow.py.
const puppeteer = require(process.env.PUPPETEER_CORE);
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: "new" });
  const pg = await b.newPage();
  await pg.setViewport({ width: 1280, height: 720 });
  await pg.goto("file://" + process.argv[2], { waitUntil: "load" });
  const res = await pg.evaluate(() => {
    const out = [];
    const secs = [...document.querySelectorAll("section")];
    secs.forEach((s, i) => {
      const r = s.getBoundingClientRect(), k = r.height / 720;
      let top = Infinity, bot = -Infinity, right = -Infinity;
      s.querySelectorAll("*").forEach(e => {
        const q = e.getBoundingClientRect();
        if (!q.height) return;
        top = Math.min(top, q.top); bot = Math.max(bot, q.bottom); right = Math.max(right, q.right);
      });
      const ot = (r.top - top) / k, ob = (bot - r.bottom) / k, orr = (right - r.right) / k;
      const wide = [...s.querySelectorAll("pre, table")].filter(e => e.scrollWidth > e.clientWidth + 2).length;
      const h = (s.querySelector("h1,h2") || {}).textContent || "";
      if (ot > 1 || ob > 1 || orr > 1 || wide)
        out.push(`#${i + 1} "${h}" top+${ot.toFixed(0)} bottom+${ob.toFixed(0)} right+${orr.toFixed(0)} wide=${wide}`);
    });
    return `slides=${secs.length}` + (out.length ? "\n  " + out.join("\n  ") : " OK");
  });
  console.log(res);
  await b.close();
})();
