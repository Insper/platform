// Animate `.termy` blocks on every page load, including pages reached through
// instant navigation. The generated markup already carries `data-termynal`,
// so a separate marker keeps a block from being initialized twice.
document$.subscribe(function () {
  document.querySelectorAll(".termy:not([data-termy-init])").forEach(function (node) {
    node.setAttribute("data-termy-init", "");
    new Termynal(node, { lineDelay: 500 });
  });
});
