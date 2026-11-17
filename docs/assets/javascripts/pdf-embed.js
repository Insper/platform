/*
 * Opens the PDFs listed in the navigation (2026.2 > Support > Midterm > Type A-D) inside the
 * site: the content area shows the PDF in an iframe, with download and new-tab links, while the
 * navigation stays. The page's own content is only hidden by CSS (body.pdf-viewer--open, in
 * extra.css), so its scripts keep working, and it comes back with the browser's Back. The URL gets #pdf=<path>, so a reload or a shared link reopens it.
 *
 * Only links of the navigation to a .pdf of this site are handled; Ctrl/Cmd/Shift-click still
 * opens the file as usual. Runs on every page load, including instant navigation (document$).
 */
(function () {
  var VIEWER = "pdf-viewer";
  var active = [];    // nav links that were active before
  var title = null;   // document title before

  function isPt() {
    return (document.documentElement.lang || "").toLowerCase().indexOf("pt") === 0;
  }

  function pdfUrl(a) {
    var url = new URL(a.getAttribute("href"), location.href);
    return url.origin === location.origin && /\.pdf$/i.test(url.pathname) ? url : null;
  }

  function navLink(el) {
    var a = el && el.closest ? el.closest(".md-nav a[href]") : null;
    return a && pdfUrl(a) ? a : null;
  }

  function findLink(path) {
    var links = document.querySelectorAll(".md-sidebar--primary .md-nav a[href]");
    for (var i = 0; i < links.length; i++) {
      var url = pdfUrl(links[i]);
      if (url && url.pathname === path) return links[i];
    }
    return null;
  }

  // "Midterm: Type A": the section title of the nav level, then the link text
  function label(a) {
    var nav = a.closest("nav.md-nav");
    var head = nav ? nav.querySelector(":scope > .md-nav__title") : null;
    var section = head ? head.textContent.trim() : "";
    var name = a.textContent.trim();
    return section ? section + ": " + name : name;
  }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (text) node.textContent = text;
    return node;
  }

  function show(a) {
    var inner = document.querySelector(".md-content__inner");
    if (!inner) return;
    var url = pdfUrl(a).href;
    var name = label(a);

    var old = inner.querySelector(":scope > ." + VIEWER);
    if (old) old.remove();
    else {
      active = Array.prototype.slice.call(document.querySelectorAll(".md-nav__link--active"));
      title = document.title;
    }

    var viewer = el("div", { "class": VIEWER });
    viewer.appendChild(el("h1", {}, name));
    var bar = el("p", { "class": VIEWER + "__links" });
    var down = el("a", { href: url, download: "", "class": "md-button md-button--primary" },
      isPt() ? "Baixar o PDF" : "Download the PDF");
    var tab = el("a", { href: url, target: "_blank", rel: "noopener", "class": "md-button" },
      isPt() ? "Abrir em outra aba" : "Open in a new tab");
    bar.appendChild(down);
    bar.appendChild(document.createTextNode(" "));
    bar.appendChild(tab);
    viewer.appendChild(bar);
    var frame = el("div", { "class": VIEWER + "__frame" });
    frame.appendChild(el("iframe", { src: url, title: name }));
    viewer.appendChild(frame);
    inner.appendChild(viewer);

    document.querySelectorAll(".md-nav__link--active").forEach(function (n) {
      n.classList.remove("md-nav__link--active");
    });
    a.classList.add("md-nav__link--active");
    for (var p = a.closest(".md-nav__item--nested"); p; p = p.parentElement.closest(".md-nav__item--nested")) {
      var toggle = p.querySelector(":scope > .md-nav__toggle");
      if (toggle) toggle.checked = true;
    }
    if (title) document.title = name + " - " + title.split(" - ").pop();
    document.body.classList.add(VIEWER + "--open");
    var drawer = document.getElementById("__drawer");
    if (drawer) drawer.checked = false;
    window.scrollTo(0, 0);
  }

  function restore() {
    var viewer = document.querySelector(".md-content__inner > ." + VIEWER);
    if (!viewer) return;
    viewer.remove();
    document.querySelectorAll(".md-nav__link--active").forEach(function (n) {
      n.classList.remove("md-nav__link--active");
    });
    active.forEach(function (n) { n.classList.add("md-nav__link--active"); });
    if (title) document.title = title;
    document.body.classList.remove(VIEWER + "--open");
    active = []; title = null;
  }

  function sync() {
    var m = location.hash.match(/^#pdf=(.+)$/);
    var a = m ? findLink(decodeURIComponent(m[1])) : null;
    if (a) show(a);
    else restore();
  }

  // Capture phase on window: runs before the theme's instant navigation sees the click.
  window.addEventListener("click", function (ev) {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var a = navLink(ev.target);
    if (!a) return;
    ev.preventDefault();
    ev.stopPropagation();
    var hash = "#pdf=" + pdfUrl(a).pathname;
    if (location.hash !== hash) history.pushState(null, "", location.pathname + location.search + hash);
    show(a);
  }, true);

  window.addEventListener("popstate", sync);
  window.addEventListener("hashchange", sync);

  function onPage() {
    active = []; title = null;   // a new page: nothing of ours is in it
    document.body.classList.remove(VIEWER + "--open");
    sync();
  }

  if (window.document$ && window.document$.subscribe) {
    window.document$.subscribe(onPage);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onPage);
  } else {
    onPage();
  }
})();
