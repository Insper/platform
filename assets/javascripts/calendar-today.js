/*
 * Circles today's date in the course calendar (.calendar-wrap table) of an edition page.
 *
 * Each row is one week: an optional month label (Aug/Ago, Sep/Set, ...) followed by
 * Sun..Sat cells that list only the days that matter. A week that crosses a month
 * boundary is split into two rows, one per month, so today goes to the row of the same
 * week AND the same month. If that cell is empty, the day number is written in so the
 * circle still shows. The year comes from the URL (/2026.2/, also /pt/2026.2/).
 *
 * Runs on every page load, including Material's instant navigation (document$).
 */
(function () {
  var MONTHS = {
    jan: 0, fev: 1, feb: 1, mar: 2, abr: 3, apr: 3, mai: 4, may: 4, jun: 5,
    jul: 6, ago: 7, aug: 7, set: 8, sep: 8, out: 9, oct: 9, nov: 10,
    dez: 11, dec: 11
  };
  var DAY = 24 * 60 * 60 * 1000;

  function mark() {
    var table = document.querySelector(".calendar-wrap table");
    if (!table || table.querySelector(".calendar-today")) return;

    var match = location.pathname.match(/\/(\d{4})\.\d\//);
    var now = new Date();
    var year = match ? +match[1] : now.getFullYear();
    if (now.getFullYear() !== year) return;
    var today = new Date(year, now.getMonth(), now.getDate());

    var month = null;
    var rows = table.tBodies[0] ? table.tBodies[0].rows : [];
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r].cells;
      var label = cells[0].textContent.trim().slice(0, 3).toLowerCase();
      if (label in MONTHS) month = MONTHS[label];
      if (month !== today.getMonth()) continue;

      // Any listed day pins the row to a week (cells[1] is Sunday).
      for (var c = 1; c < cells.length; c++) {
        var day = parseInt(cells[c].textContent, 10);
        if (!day) continue;
        var sunday = new Date(year, month, day - (c - 1));
        var offset = Math.round((today - sunday) / DAY);
        if (offset < 0 || offset > 6) break;

        var cell = cells[offset + 1];
        var ring = document.createElement("span");
        ring.className = "calendar-today";
        ring.title = (document.documentElement.lang || "").indexOf("pt") === 0 ? "Hoje" : "Today";
        if (cell.textContent.trim()) {
          while (cell.firstChild) ring.appendChild(cell.firstChild);
        } else {
          ring.textContent = String(today.getDate()).padStart(2, "0");
        }
        cell.appendChild(ring);
        return;
      }
    }
  }

  if (window.document$ && window.document$.subscribe) {
    window.document$.subscribe(mark);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mark);
  } else {
    mark();
  }
})();
