/* Core of the 2027.1 support tools (concept map and study cards), ported from
   the Machine Learning course's diagram engine. Each tool is a file that calls
   SupDgm.register('<name>', fn) and is mounted in
   <div class="dgm" data-dgm="<name>"></div>.
   - Texts: English, with a Portuguese fallback for the interface (t(en, pt));
     the language comes from <html lang>, read at every mount.
   - Light/dark: every colour comes from support.css and the site palette.
   - Instant navigation: mounts again on every document$ emission (and on
     DOMContentLoaded without it); a root is mounted once (data-sup-mounted).
   - Lesson links: lesson(path) gives the URL of 2027.1/classes/<path>/ from the
     site root of the current page (works under /pt/ too). */
(function () {
  if (window.SupDgm) return;
  let lang = 'en';
  const readLang = () => { lang = (document.documentElement.lang || 'en').toLowerCase().startsWith('pt') ? 'pt' : 'en'; };
  readLang();
  const t = (en, pt) => (lang === 'pt' && pt !== undefined ? pt : en);
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const registry = {};
  const SVGNS = 'http://www.w3.org/2000/svg';
  const scriptSrc = (document.currentScript && document.currentScript.src) || location.href;
  // this file is assets/javascripts/support/dgm.js: three levels up is the site root
  const assetRoot = new URL('../../../', scriptSrc);
  const here = new URL('./', scriptSrc);

  function siteRoot() {
    if (window.ARQ_SITE_ROOT) return new URL(window.ARQ_SITE_ROOT, location.href);
    const p = location.pathname, i = p.indexOf('/2027.1/');
    return i >= 0 ? new URL(p.slice(0, i + 1), location.href) : assetRoot;
  }
  const lesson = (path, anchor) => new URL('2027.1/classes/' + path.replace(/^\/|\/$/g, '') + '/', siteRoot()).pathname + (anchor ? '#' + anchor : '');

  // el('div', {class: 'x', text: '…', onclick: fn}, child, 'text', …)
  function build(node, attrs, children) {
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c === undefined || c === null || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }
  const el = (tag, attrs, ...children) => build(document.createElement(tag), attrs, children);
  const svg = (tag, attrs, ...children) => build(document.createElementNS(SVGNS, tag), attrs, children);

  // header, body and note (the "live caption" of the tool)
  function frame(root, opts) {
    opts = opts || {};
    root.classList.add('dgm--ready');
    root.innerHTML = '';
    if (opts.title) {
      root.appendChild(el('div', { class: 'dgm-head' },
        el('span', { class: 'dgm-kicker', text: t('Interactive map', 'Mapa interativo') }),
        el('span', { class: 'dgm-title', text: opts.title })));
    }
    const body = root.appendChild(el('div', { class: 'dgm-body' }));
    const note = root.appendChild(el('div', { class: 'dgm-note', 'aria-live': 'polite' }));
    return { root, body, note, say: html => { note.innerHTML = html; } };
  }

  const narrow = () => window.matchMedia('(max-width: 44.9375em)').matches;

  // Loads a data script once (several mounts wait for the same promise).
  const loading = {};
  function loadData(file, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    if (!loading[file]) {
      loading[file] = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = new URL(file, here).href;
        sc.onload = () => (window[globalName] ? resolve(window[globalName]) : reject(new Error(file + ' did not define ' + globalName)));
        sc.onerror = () => { delete loading[file]; reject(new Error('could not load ' + file)); };
        document.head.appendChild(sc);
      });
    }
    return loading[file];
  }

  let ready = false;
  function register(name, fn) { registry[name] = fn; if (ready) mountAll(); }
  function mountAll() {
    readLang();
    document.querySelectorAll('.dgm[data-dgm]').forEach(root => {
      const fn = registry[root.dataset.dgm];
      if (!fn || root.dataset.supMounted) return;
      root.dataset.supMounted = '1';
      try { fn(root); } catch (e) { console.error('[support] ' + root.dataset.dgm, e); }
    });
  }
  function boot() { ready = true; mountAll(); }
  if (window.document$ && typeof window.document$.subscribe === 'function') window.document$.subscribe(boot);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.SupDgm = {
    get isPT() { return lang === 'pt'; }, t, reduced, lesson, el, svg, frame, narrow, loadData, register,
  };
})();
