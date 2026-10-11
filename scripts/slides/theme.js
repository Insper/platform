// Light or dark, following the site. Inside the class page (same-origin
// <iframe>) the deck reads the scheme Zensical resolved on the page <body>
// ("default" or "slate") and follows it when the reader switches the palette.
// Opened on its own, it uses the palette saved in localStorage or, failing
// that, the system preference.
//
// The Marp theme (theme.css) is scoped to the slides, so the scheme goes on
// every <section> as data-scheme — data-theme already belongs to Marp.
(function () {
  let dark = null;

  function apply(isDark) {
    dark = isDark;
    const scheme = isDark ? 'dark' : 'light';
    document.documentElement.dataset.scheme = scheme;
    document.querySelectorAll('section').forEach(s => { s.dataset.scheme = scheme; });
    if (document.body) document.body.style.background = isDark ? 'hsl(225, 15%, 3%)' : '#e8e8e8';
  }

  function parentBody() {
    try {
      if (window.parent !== window) return window.parent.document.body;
    } catch (e) { /* another origin: fall through */ }
    return null;
  }

  function savedScheme() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.endsWith('__palette')) {
          const scheme = JSON.parse(localStorage.getItem(key)).color.scheme;
          if (scheme === 'slate' || scheme === 'default') return scheme;
        }
      }
    } catch (e) { /* storage blocked or unexpected format */ }
    return null;
  }

  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const body = parentBody();

  if (body) {
    const read = () => apply(body.getAttribute('data-md-color-scheme') === 'slate');
    read();
    new MutationObserver(read).observe(body, { attributes: true, attributeFilter: ['data-md-color-scheme'] });
  } else {
    const read = () => {
      const scheme = savedScheme();
      apply(scheme ? scheme === 'slate' : system.matches);
    };
    read();
    system.addEventListener('change', read);
  }

  // this script runs in the first slide: the next ones do not exist yet
  document.addEventListener('DOMContentLoaded', () => apply(dark));
})();
