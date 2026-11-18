/*
 * Roadmaps (the class overviews of 2026.2 and 2027.1): the list right after `## Roadmap { #roadmap }`
 * (pt `## Roteiro { #roadmap }`) is drawn as a trail of numbered steps by assets/stylesheets/extra.css.
 *
 * The source stays plain Markdown, `1. [Title](page/index.md) — description`. This script only splits
 * each item at its first " — ": the title stays where it is and the description moves into
 * <span class="rm-desc">, its own line. Without JavaScript the steps still show, title and description
 * on one line.
 */
(function () {
  "use strict";

  var SEP = " — ";

  function split(li) {
    var nodes = Array.prototype.slice.call(li.childNodes);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType !== 3 || n.nodeValue.indexOf(SEP) < 0) continue;
      var at = n.nodeValue.indexOf(SEP);
      var desc = document.createElement("span");
      desc.className = "rm-desc";
      desc.appendChild(document.createTextNode(n.nodeValue.slice(at + SEP.length)));
      n.nodeValue = n.nodeValue.slice(0, at);
      for (var j = i + 1; j < nodes.length; j++) desc.appendChild(nodes[j]);
      li.appendChild(desc);
      return;
    }
  }

  function init() {
    document.querySelectorAll(".md-typeset h2#roadmap + ol:not(.rm-ready)").forEach(function (ol) {
      Array.prototype.forEach.call(ol.children, split);
      ol.classList.add("rm-ready");
    });
  }

  if (typeof document$ !== "undefined") document$.subscribe(init);
  else document.addEventListener("DOMContentLoaded", init);
})();
