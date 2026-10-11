// Language selector: switch between English (/platform/...) and Portuguese
// (/platform/pt/...) keeping the current page. Both sites share the same
// paths (scripts/i18n/build.py), so the page is the same path under the other
// base. The bases come from the selector links themselves (extra.alternate).
document.addEventListener("click", function (ev) {
  var link = ev.target.closest && ev.target.closest("a.md-select__link[hreflang]");
  if (!link) return;
  var bases = Array.prototype.map.call(
    document.querySelectorAll("a.md-select__link[hreflang]"),
    function (a) { return new URL(a.href).pathname; }
  ).sort(function (a, b) { return b.length - a.length; });   // longest first: /platform/pt/ before /platform/
  var path = location.pathname;
  var current = bases.filter(function (b) { return path.indexOf(b) === 0; })[0];
  if (!current) return;
  ev.preventDefault();
  ev.stopPropagation();
  location.href = new URL(link.href).pathname + path.slice(current.length) + location.hash;
}, true);
