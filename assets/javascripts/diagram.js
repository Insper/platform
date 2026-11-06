/*
 * Diagrams (2027.1): our own renderer for the class pages' diagrams, in the page theme.
 *
 *   ``` diagram          a static diagram
 *   ``` diagram-sim      the same, played step by step (edges / messages in source order)
 *
 * The source is Mermaid syntax, so authors keep what they know, but Mermaid is not used:
 *
 *   - flowchart / graph (LR, RL, TD, TB, BT): shapes [], (), ([]), [()], (()), {}, {{}}, [[]], [//],
 *     edges -->, ---, -.->, -.-, ==>, <-->, --x, --o, ~~~, labels |text| or -- text -->, chains and &,
 *     subgraph … end, :::class (comp, tech, problem, and any other name as a neutral tone);
 *   - sequenceDiagram: participant / actor (as), ->>, -->>, ->, -->, -x, --x, -), --), +/- activation,
 *     activate / deactivate, autonumber, Note left of / right of / over, loop, alt/else, opt, par/and,
 *     critical/option, break, rect;
 *   - stateDiagram-v2: [*], transitions with labels, state "x" as y, composite states, <<choice>>,
 *     <<fork>>/<<join>>, notes.
 *
 * Flowcharts and state diagrams are laid out by ELK (layered, orthogonal edges, loaded on demand);
 * sequence diagrams by this file. Text is measured with the page font, and when a left-to-right
 * diagram would have to shrink below a readable size, it is laid out top-down instead.
 * Every color is a CSS class of assets/stylesheets/diagram.css (Material's variables), so a palette
 * switch needs no re-render. The parsers are pure and exported for node (scripts/diagram/test.mjs).
 */
(function () {
  "use strict";

  /* ================================================================== parsing */

  function clean(s) {
    s = String(s === undefined ? "" : s).trim();
    if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') s = s.slice(1, -1);
    if (s.length >= 2 && s[0] === "`" && s[s.length - 1] === "`") s = s.slice(1, -1);
    return s
      .replace(/<br\s*\/?>/gi, "\n").replace(/\\n/g, "\n")
      .replace(/<\/?(b|strong|i|em|small|code|span|sub|sup|u)[^>]*>/gi, "")
      .replace(/#quot;/g, '"').replace(/&quot;/g, '"').replace(/#lt;/g, "<").replace(/#gt;/g, ">")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
      .replace(/[ \t]+/g, " ").split("\n").map(function (l) { return l.trim(); }).join("\n").trim();
  }

  function lines(src) {
    return String(src).replace(/\r/g, "").split("\n").map(function (l) {
      return l.replace(/%%.*$/, "").replace(/\s+$/, "");
    });
  }

  /* --- flowchart --- */

  var OPENERS = [
    ["(((", ")))", "circle"], ["([", "])", "stadium"], ["[(", ")]", "cylinder"], ["[[", "]]", "subroutine"],
    ["((", "))", "circle"], ["{{", "}}", "hexagon"], ["[/", "/]", "para"], ["[\\", "\\]", "para"],
    [">", "]", "flag"], ["[", "]", "box"], ["(", ")", "round"], ["{", "}", "diamond"]
  ];
  /* ids: letters, digits, _ and single - or . between them (so A-->B is A, then -->) */
  var ID = /^[A-Za-z0-9_À-ɏ](?:[\wÀ-ɏ]|[-.](?=[\wÀ-ɏ]))*/;
  var EDGE_LABELLED = /^([<xo])?(--(?=\s)|==(?=\s)|-\.)\s*("[^"]*"|[^"|>\-.=\s][^"|]*?)\s*(-{2,}>|={2,}>|\.-+>|-{3,}|={3,}|\.-+)(?=\s|$|[A-Za-z0-9_"])/;
  var EDGE = /^([<xo])?(~{3}|-{2,}|={2,}|-\.+-)([>xo])?(?:\s*\|("[^"]*"|[^|]*)\|)?/;

  function readNode(s, i) {
    var m = ID.exec(s.slice(i));
    if (!m) return null;
    var id = m[0];
    var node = { id: id };
    var j = i + id.length;
    for (var k = 0; k < OPENERS.length; k++) {
      var op = OPENERS[k];
      if (s.substr(j, op[0].length) !== op[0]) continue;
      var start = j + op[0].length, end;
      var rest = s.slice(start).replace(/^\s+/, "");
      start = s.length - rest.length;
      if (rest[0] === '"') {
        var q = s.indexOf('"', start + 1);
        if (q < 0) return null;
        end = s.indexOf(op[1], q + 1);
        node.label = s.slice(start + 1, q);
      } else {
        var closers = op[1] === "/]" || op[1] === "\\]" ? ["/]", "\\]"] : [op[1]];
        end = -1;
        closers.forEach(function (c) { var e = s.indexOf(c, start); if (e >= 0 && (end < 0 || e < end)) end = e; });
        node.label = end >= 0 ? s.slice(start, end) : null;
      }
      if (end < 0) return null;
      node.shape = op[2];
      j = end + op[1].length;
      break;
    }
    var cm = /^:::([\w-]+)/.exec(s.slice(j));
    if (cm) { node.cls = cm[1]; j += cm[0].length; }
    node.end = j;
    return node;
  }

  function readEdge(s, i) {
    var t = s.slice(i), m = EDGE_LABELLED.exec(t), e;
    if (m) {
      var body = m[2] + m[4];
      e = { label: m[3], tail: m[1] || "", head: /[>]$/.test(m[4]) ? ">" : "", len: m[0].length };
      e.style = /=/.test(body) ? "thick" : /\./.test(body) ? "dashed" : "solid";
      return e;
    }
    m = EDGE.exec(t);
    if (!m) return null;
    /* "--" alone is not an edge unless followed by an arrow head or a label */
    if (/^-{2}$/.test(m[2]) && !m[3] && !m[1] && m[4] === undefined) return null;
    e = { label: m[4], tail: m[1] || "", head: m[3] || "", len: m[0].length };
    e.style = /~/.test(m[2]) ? "invisible" : /=/.test(m[2]) ? "thick" : /\./.test(m[2]) ? "dashed" : "solid";
    return e;
  }

  function parseFlow(src) {
    var L = lines(src);
    var head = (L.shift() || "").trim().split(/\s+/);
    var g = { type: "flow", dir: (head[1] || "TB").toUpperCase(), nodes: {}, order: [], edges: [], groups: {}, gorder: [], errors: [], seq: 0 };
    if (g.dir === "TD") g.dir = "TB";
    var stack = [];
    function node(n) {
      var cur = g.nodes[n.id];
      if (!cur) { cur = g.nodes[n.id] = { id: n.id, label: n.id, shape: "box", cls: "", parent: stack.length ? stack[stack.length - 1] : null, seq: g.seq++ }; g.order.push(n.id); }
      /* as in Mermaid, a node mentioned inside a subgraph belongs to it (the last one wins) */
      if (stack.length) cur.parent = stack[stack.length - 1];
      if (n.label !== undefined && n.label !== null) { cur.label = clean(n.label); cur.shape = n.shape; }
      if (n.cls) cur.cls = n.cls;
      return cur;
    }
    L.forEach(function (raw, ln) {
      var l = raw.trim().replace(/;$/, "");
      if (!l) return;
      var m;
      if ((m = /^subgraph\s+(.*)$/.exec(l))) {
        var spec = m[1].trim(), id, label;
        var sm = /^([\w\-.]+)\s*\[\s*("?)(.*?)\2\s*\]$/.exec(spec);
        if (sm) { id = sm[1]; label = sm[3]; }
        else if (/^"/.test(spec)) { label = spec; id = "sg" + g.gorder.length; }
        else if (/^[\w\-.]+$/.test(spec)) { id = spec; label = spec; }
        else { label = spec; id = "sg" + g.gorder.length; }
        g.groups[id] = { id: id, label: clean(label), parent: stack.length ? stack[stack.length - 1] : null, seq: g.seq++ };
        g.gorder.push(id);
        stack.push(id);
        return;
      }
      if (l === "end") { stack.pop(); return; }
      if ((m = /^direction\s+(\w+)$/.exec(l))) {
        if (stack.length) g.groups[stack[stack.length - 1]].dir = m[1].toUpperCase() === "TD" ? "TB" : m[1].toUpperCase();
        return;
      }
      if (/^(classDef|style|linkStyle|click|accTitle|accDescr|title)\b/.test(l)) return;
      if ((m = /^class\s+([\w,\s-]+?)\s+([\w-]+)$/.exec(l))) {
        m[1].split(",").forEach(function (id) { id = id.trim(); if (g.nodes[id]) g.nodes[id].cls = m[2]; });
        return;
      }
      /* a chain: nodes (joined by &) and edges */
      var i = 0, prev = null, pending = null, ok = true;
      function skip() { while (i < l.length && /\s/.test(l[i])) i++; }
      while (i < l.length && ok) {
        skip();
        var group = [];
        for (;;) {
          var n = readNode(l, i);
          if (!n) { ok = false; break; }
          group.push(node(n));
          i = n.end; skip();
          if (l[i] === "&") { i++; skip(); continue; }
          break;
        }
        if (!ok) break;
        if (pending && prev) {
          prev.forEach(function (a) {
            group.forEach(function (b) {
              g.edges.push({ from: a.id, to: b.id, label: pending.label === undefined ? "" : clean(pending.label), style: pending.style, head: pending.head, tail: pending.tail, line: ln });
            });
          });
        }
        prev = group; pending = null;
        skip();
        if (i >= l.length) break;
        var e = readEdge(l, i);
        if (!e) { ok = false; break; }
        pending = e; i += e.len;
      }
      if (!ok || pending) g.errors.push((ln + 2) + ": " + raw.trim());
    });
    /* an id used as a subgraph is not a node: edges to it connect to the whole group */
    g.gorder.forEach(function (id) {
      if (g.nodes[id]) { delete g.nodes[id]; g.order.splice(g.order.indexOf(id), 1); }
    });
    g.order.forEach(function (id) { var n = g.nodes[id]; if (n.parent && !g.groups[n.parent]) n.parent = null; });
    return g;
  }

  /* --- state diagram, as a flow graph --- */

  function parseState(src) {
    var L = lines(src);
    L.shift();
    var g = { type: "flow", state: true, dir: "TB", nodes: {}, order: [], edges: [], groups: {}, gorder: [], errors: [], seq: 0 };
    var stack = [], notes = 0;
    function scope() { return stack.length ? stack[stack.length - 1] : null; }
    function node(id, opts) {
      var real = id;
      if (id === "[*]") real = (scope() || "root") + (opts && opts.end ? "__end" : "__start");
      var n = g.nodes[real];
      if (!n) {
        n = g.nodes[real] = { id: real, label: id === "[*]" ? "" : id, shape: id === "[*]" ? (opts && opts.end ? "end" : "start") : "state", cls: "", parent: scope(), seq: g.seq++ };
        g.order.push(real);
      }
      return n;
    }
    for (var ln = 0; ln < L.length; ln++) {
      var l = L[ln].trim(), m;
      if (!l || /^(direction|classDef|class|style|accTitle|accDescr|title|hide empty)\b/.test(l)) {
        if ((m = /^direction\s+(\w+)/.exec(l)) && !stack.length) g.dir = m[1].toUpperCase() === "TD" ? "TB" : m[1].toUpperCase();
        continue;
      }
      if (l === "}") { stack.pop(); continue; }
      if (l === "--") continue;
      if ((m = /^state\s+"([^"]*)"\s+as\s+([\w-]+)\s*(\{)?$/.exec(l))) {
        if (m[3]) { g.groups[m[2]] = { id: m[2], label: clean(m[1]), parent: scope(), seq: g.seq++ }; g.gorder.push(m[2]); stack.push(m[2]); }
        else node(m[2]).label = clean(m[1]);
        continue;
      }
      if ((m = /^state\s+([\w-]+)\s*<<(choice|fork|join)>>$/.exec(l))) { var c = node(m[1]); c.shape = m[2] === "choice" ? "choice" : "bar"; c.label = ""; continue; }
      if ((m = /^state\s+([\w-]+)\s*\{$/.exec(l))) { g.groups[m[1]] = { id: m[1], label: m[1], parent: scope(), seq: g.seq++ }; g.gorder.push(m[1]); stack.push(m[1]); continue; }
      if ((m = /^state\s+([\w-]+)$/.exec(l))) { node(m[1]); continue; }
      if ((m = /^note\s+(left|right)\s+of\s+([\w-]+)\s*:\s*(.*)$/i.exec(l))) { addNote(m[2], m[3]); continue; }
      if ((m = /^note\s+(left|right)\s+of\s+([\w-]+)\s*$/i.exec(l))) {
        var text = [];
        while (++ln < L.length && !/^\s*end\s+note\s*$/i.test(L[ln])) text.push(L[ln].trim());
        addNote(m[2], text.join("\n"));
        continue;
      }
      if ((m = /^([\w-]+|\[\*\])\s*-->\s*([\w-]+|\[\*\])\s*(?::\s*(.*))?$/.exec(l))) {
        var a = node(m[1]), b = node(m[2], { end: true });
        g.edges.push({ from: a.id, to: b.id, label: m[3] ? clean(m[3]) : "", style: "solid", head: ">", tail: "", line: ln });
        continue;
      }
      if ((m = /^([\w-]+)\s*:\s*(.*)$/.exec(l))) { node(m[1]).label = clean(m[2]); continue; }
      g.errors.push((ln + 2) + ": " + l);
    }
    function addNote(target, text) {
      var id = "note" + (++notes);
      var t = node(target);
      g.nodes[id] = { id: id, label: clean(text), shape: "note", cls: "", parent: t.parent, seq: g.seq++ };
      g.order.push(id);
      g.edges.push({ from: t.id, to: id, label: "", style: "dashed", head: "", tail: "", note: true });
    }
    return g;
  }

  /* --- sequence diagram --- */

  var ARROWS = [
    ["<<-->>", "dashed", "both"], ["<<->>", "solid", "both"], ["-->>", "dashed", "arrow"], ["->>", "solid", "arrow"],
    ["--x", "dashed", "cross"], ["-x", "solid", "cross"], ["--)", "dashed", "async"], ["-)", "solid", "async"],
    ["-->", "dashed", "open"], ["->", "solid", "open"]
  ];

  function parseSeq(src) {
    var L = lines(src);
    L.shift();
    var d = { type: "seq", parts: [], byId: {}, items: [], autonumber: false, errors: [] };
    function part(id, label, kind) {
      var p = d.byId[id];
      if (!p) { p = d.byId[id] = { id: id, label: id, kind: "participant", index: d.parts.length }; d.parts.push(p); }
      if (label !== undefined) p.label = clean(label);
      if (kind) p.kind = kind;
      return p;
    }
    var depth = 0;
    L.forEach(function (raw, ln) {
      var l = raw.trim(), m;
      if (!l) return;
      if (/^(title|accTitle|accDescr|box|links?|properties|details)\b/.test(l)) { if (/^box\b/.test(l)) depth++; return; }
      if (l === "autonumber" || /^autonumber\b/.test(l)) { d.autonumber = true; return; }
      if ((m = /^(participant|actor)\s+("[^"]+"|[^\s]+)(?:\s+as\s+(.+))?$/.exec(l))) {
        var id = m[2].replace(/^"|"$/g, "");
        part(id, m[3] !== undefined ? m[3] : id, m[1]);
        return;
      }
      if ((m = /^(activate|deactivate)\s+(.+)$/.exec(l))) { d.items.push({ t: m[1], p: part(m[2].trim()).id }); return; }
      if ((m = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i.exec(l))) {
        var ps = m[2].split(",").map(function (x) { return part(x.trim()).id; });
        d.items.push({ t: "note", where: m[1].toLowerCase(), ps: ps, text: clean(m[3]) });
        return;
      }
      if ((m = /^(loop|alt|opt|par|critical|break|rect)\b\s*(.*)$/.exec(l))) { d.items.push({ t: "open", kind: m[1], text: m[1] === "rect" ? "" : clean(m[2]) }); depth++; return; }
      if ((m = /^(else|and|option)\b\s*(.*)$/.exec(l))) { d.items.push({ t: "split", kind: m[1], text: clean(m[2]) }); return; }
      if (l === "end") { if (depth > 0) { depth--; d.items.push({ t: "close" }); } return; }
      /* the arrow is the earliest one in the line (the message text may contain arrows too) */
      var best = null;
      ARROWS.forEach(function (a) {
        var at = l.indexOf(a[0]);
        if (at > 0 && (!best || at < best.at || at === best.at && a[0].length > best.a[0].length)) best = { a: a, at: at };
      });
      for (var k = 0; best && k < 1; k++) {
        var a = best.a, at = best.at;
        var from = l.slice(0, at).trim();
        var rest = l.slice(at + a[0].length);
        var mm = /^\s*([+-]?)\s*([^:]+?)\s*:\s*(.*)$/.exec(rest) || /^\s*([+-]?)\s*([^:]+?)\s*$/.exec(rest);
        if (!mm || /\s/.test(from) && !/^"/.test(from)) continue;
        d.items.push({ t: "msg", from: part(from).id, to: part(mm[2].trim()).id, text: clean(mm[3] || ""), line: a[1], head: a[2], act: mm[1] });
        return;
      }
      d.errors.push((ln + 2) + ": " + l);
    });
    return d;
  }

  function parse(src) {
    var first = (lines(src).filter(function (l) { return l.trim(); })[0] || "").trim();
    var body = String(src).slice(String(src).indexOf(first));
    if (/^(flowchart|graph)\b/.test(first)) return parseFlow(body);
    if (/^stateDiagram/.test(first)) return parseState(body);
    if (/^sequenceDiagram/.test(first)) return parseSeq(body);
    return { type: "unknown", errors: ["unsupported diagram: " + first] };
  }

  /* ================================================================== measuring and the ELK graph */

  var FONT = 13, SMALL = 11.5, LINE = 17, SLINE = 15;
  var measureCtx = null, family = "sans-serif";

  /* text width with the page font (in node, for the tests, an estimate) */
  function measure(text, size, weight) {
    if (typeof document === "undefined") return String(text).length * size * (weight >= 600 ? 0.6 : 0.55);
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
    measureCtx.font = (weight || 400) + " " + size + "px " + family;
    return measureCtx.measureText(text).width;
  }
  /* split a label into lines no wider than max (keeps explicit line breaks) */
  function wrap(text, size, max, weight) {
    var out = [];
    /* a word wider than the line (a URL, a long identifier) breaks after & ? / = , or, failing that, anywhere */
    function pieces(w) {
      if (measure(w, size, weight) <= max) return [w];
      var parts = w.split(/(?<=[&?\/=,])/), res = [], cur = "";
      parts.forEach(function (p) {
        if (cur && measure(cur + p, size, weight) > max) { res.push(cur); cur = ""; }
        while (measure(p, size, weight) > max && p.length > 1) {
          var n = p.length;
          while (n > 1 && measure(p.slice(0, n), size, weight) > max) n--;
          res.push(p.slice(0, n)); p = p.slice(n);
        }
        cur += p;
      });
      if (cur) res.push(cur);
      return res.map(function (r, i) { return i ? "\u0000" + r : r; });   /* \u0000: joins without a space */
    }
    String(text).split("\n").forEach(function (para) {
      var words = [].concat.apply([], para.split(" ").map(pieces)), cur = "";
      words.forEach(function (w) {
        var glue = w[0] === "\u0000" ? "" : " ";
        w = w.replace(/^\u0000/, "");
        var tryLine = cur ? cur + glue + w : w;
        if (cur && measure(tryLine, size, weight) > max) { out.push(cur); cur = w; }
        else cur = tryLine;
      });
      out.push(cur);
    });
    return out;
  }
  function widest(ls, size, weight) {
    return ls.reduce(function (m, l) { return Math.max(m, measure(l, size, weight)); }, 0);
  }

  /* ---------------------------------------------------------- flow layout (ELK) */

  var PAD = { box: [14, 9], round: [16, 9], stadium: [20, 9], cylinder: [16, 14], circle: [14, 14], diamond: [18, 14],
    hexagon: [22, 9], subroutine: [22, 9], para: [22, 9], flag: [22, 9], state: [16, 9], note: [12, 8] };

  function nodeSize(n, maxw) {
    if (n.shape === "start" || n.shape === "end") return { w: 18, h: 18, ls: [] };
    if (n.shape === "choice") return { w: 26, h: 26, ls: [] };
    if (n.shape === "bar") return { w: 70, h: 8, ls: [] };
    var size = n.shape === "note" ? SMALL : FONT, line = n.shape === "note" ? SLINE : LINE;
    var ls = wrap(n.label, size, n.shape === "note" ? Math.min(200, maxw) : maxw, n.shape === "note" ? 400 : 500);
    var w = widest(ls, size, n.shape === "note" ? 400 : 500), h = ls.length * line;
    var p = PAD[n.shape] || PAD.box;
    w += 2 * p[0]; h += 2 * p[1];
    if (n.shape === "circle") { var dmt = Math.max(w, h); w = h = dmt; }
    if (n.shape === "diamond") { w = w * 1.35; h = h * 1.45; }
    if (n.shape === "cylinder") h += 8;
    return { w: Math.max(Math.ceil(w), 48), h: Math.max(Math.ceil(h), 34), ls: ls, size: size, line: line };
  }

  /* opts.compact: narrower labels and tighter spacing, to fit a left-to-right diagram in the column */
  function elkGraph(g, dir, compact, titleW) {
    var maxw = compact ? 125 : 230;
    var vertical = dir === "TB" || dir === "BT";
    var sizes = {};
    var DIRS = { LR: "RIGHT", RL: "LEFT", TB: "DOWN", BT: "UP" };
    var root = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": DIRS[dir] || "DOWN",
        "elk.hierarchyHandling": "INCLUDE_CHILDREN",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.layered.spacing.nodeNodeBetweenLayers": vertical ? (compact ? "18" : "24") : (compact ? "26" : "38"),
        "elk.spacing.nodeNode": compact ? "16" : "22",
        "elk.spacing.edgeNode": "14",
        "elk.spacing.edgeEdge": "10",
        "elk.layered.spacing.edgeNodeBetweenLayers": "14",
        "elk.layered.spacing.edgeEdgeBetweenLayers": "10",
        "elk.spacing.edgeLabel": "4",
        "elk.edgeLabels.inline": "false",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.layered.crossingMinimization.semiInteractive": "true",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
        "elk.padding": "[top=6,left=6,bottom=6,right=6]"
      },
      children: [], edges: []
    };
    var holders = { root: root };
    /* the groups a node or group sits in, innermost first */
    function chain(id) {
      var out = [], p = g.nodes[id] ? g.nodes[id].parent : g.groups[id] ? g.groups[id].parent : null;
      if (g.groups[id]) out.push(id);
      while (p) { out.push(p); p = g.groups[p].parent; }
      return out;
    }
    /* a subgraph with its own direction keeps it when no edge crosses its border (ELK lays it out apart) */
    var apart = {};
    g.gorder.forEach(function (id) {
      if (!g.groups[id].dir || g.groups[id].dir === dir) return;
      apart[id] = !g.edges.some(function (e) {
        var a = chain(e.from).indexOf(id) >= 0 && e.from !== id, b = chain(e.to).indexOf(id) >= 0 && e.to !== id;
        return a !== b;
      });
    });
    g.gorder.forEach(function (id) {
      var gr = g.groups[id];
      /* the title: one line when it fits; titleW (from a first layout) narrows it to the group's width */
      var ls = wrap(gr.label, SMALL, (titleW && titleW[id]) || 400, 700);
      var lo = { "elk.padding": "[top=" + (ls.length * SLINE + 18) + ",left=12,bottom=12,right=12]" };
      if (apart[id]) {
        Object.keys(root.layoutOptions).forEach(function (k) { if (k !== "elk.padding") lo[k] = root.layoutOptions[k]; });
        lo["elk.hierarchyHandling"] = "SEPARATE_CHILDREN";
        lo["elk.direction"] = DIRS[gr.dir] || lo["elk.direction"];
      }
      holders[id] = { id: "g:" + id, children: [], edges: [], layoutOptions: lo };
      sizes["g:" + id] = { ls: ls };
    });
    /* children in the order they appear in the source: the cycle breaker and the ordering follow it */
    var items = g.gorder.map(function (id) { return { group: true, id: id, seq: g.groups[id].seq || 0 }; })
      .concat(g.order.map(function (id) { return { id: id, seq: g.nodes[id].seq || 0 }; }))
      .sort(function (a, b) { return a.seq - b.seq; });
    items.forEach(function (it) {
      if (it.group) { (holders[g.groups[it.id].parent] || root).children.push(holders[it.id]); return; }
      var n = g.nodes[it.id], sz = nodeSize(n, maxw);
      sizes[it.id] = sz;
      (holders[n.parent] || root).children.push({ id: it.id, width: sz.w, height: sz.h });
    });
    g.edges.forEach(function (e, i) {
      var end = function (id) { return g.groups[id] ? "g:" + id : id; };
      var ed = { id: "e" + i, sources: [end(e.from)], targets: [end(e.to)] };
      if (e.label) {
        var ls = wrap(e.label, SMALL, compact ? 100 : 170, 400);
        e._ls = ls;
        ed.labels = [{ text: e.label, width: widest(ls, SMALL, 400) + 10, height: ls.length * SLINE + 4 }];
      }
      /* an edge lives in the innermost laid-out-apart group holding both ends, else in the root */
      var ca = chain(e.from).filter(function (x) { return x !== e.from; }), cb = chain(e.to).filter(function (x) { return x !== e.to; });
      var home = ca.filter(function (x) { return apart[x] && cb.indexOf(x) >= 0; })[0];
      (home ? holders[home] : root).edges.push(ed);
    });
    return { graph: root, sizes: sizes };
  }

  var API = { parse: parse, parseFlow: parseFlow, parseSeq: parseSeq, parseState: parseState, clean: clean, elkGraph: elkGraph };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ================================================================== rendering */

  var ELK_URL = "https://cdn.jsdelivr.net/npm/elkjs@0.9.3/lib/elk.bundled.js";
  var SVGNS = "http://www.w3.org/2000/svg";
  var PT = (document.documentElement.lang || "").indexOf("pt") === 0;
  var T = PT ? {
    steps: "passos", hint: "Aperte play para simular", reset: "Recomeçar", prev: "Passo anterior (←)",
    play: "Reproduzir / pausar (espaço)", next: "Próximo passo (→)", all: "Ver o diagrama inteiro", speed: "Velocidade", goto: "Ir para o passo "
  } : {
    steps: "steps", hint: "Press play to simulate", reset: "Restart", prev: "Previous step (←)",
    play: "Play / pause (space)", next: "Next step (→)", all: "Show the whole diagram", speed: "Speed", goto: "Go to step "
  };
  var MIN_SCALE = 0.86;   /* below this the text gets smaller than ~11 px: try another layout */
  var elkLoading = null, elk = null;

  function loadElk() {
    if (elk) return Promise.resolve(elk);
    if (!elkLoading) {
      elkLoading = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = ELK_URL;
        s.onload = function () { elk = new window.ELK(); resolve(elk); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return elkLoading;
  }

  function s(tag, attrs, kids) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function textBlock(ls, x, y, size, line, cls, anchor) {
    var t = s("text", { x: x, y: y, "text-anchor": anchor || "middle", class: cls || "", "font-size": size });
    var top = y - ((ls.length - 1) * line) / 2;
    ls.forEach(function (l, i) {
      var sp = s("tspan", { x: x, y: top + i * line, "dominant-baseline": "central" });
      sp.textContent = l;
      t.appendChild(sp);
    });
    return t;
  }

  function defs(svg, uid) {
    var d = s("defs");
    [["", "dg-mk"], ["-on", "dg-mk on"], ["-done", "dg-mk done"]].forEach(function (v) {
      d.appendChild(s("marker", { id: uid + "-arrow" + v[0], viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse", class: v[1] }, [
        s("path", { d: "M 0 0.8 L 9.4 5 L 0 9.2 L 2.2 5 z" })]));
      d.appendChild(s("marker", { id: uid + "-open" + v[0], viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse", class: v[1] + " open" }, [
        s("path", { d: "M 1 1 L 9 5 L 1 9", fill: "none" })]));
      d.appendChild(s("marker", { id: uid + "-cross" + v[0], viewBox: "0 0 10 10", refX: 5, refY: 5, markerWidth: 8, markerHeight: 8, orient: "auto", class: v[1] + " open" }, [
        s("path", { d: "M 1.5 1.5 L 8.5 8.5 M 8.5 1.5 L 1.5 8.5", fill: "none" })]));
      d.appendChild(s("marker", { id: uid + "-circle" + v[0], viewBox: "0 0 10 10", refX: 5, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto", class: v[1] + " ring" }, [
        s("circle", { cx: 5, cy: 5, r: 3.4 })]));
    });
    svg.appendChild(d);
  }
  function marker(uid, kind) {
    return kind ? "url(#" + uid + "-" + kind + ")" : null;
  }

  function roundedPath(pts, r) {
    if (!pts.length) return "";
    var d = "M" + pts[0].x + "," + pts[0].y;
    for (var i = 1; i < pts.length - 1; i++) {
      var p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      var d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y), d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      var rr = Math.min(r, d1 / 2, d2 / 2);
      var a = { x: p1.x + (p0.x - p1.x) * rr / (d1 || 1), y: p1.y + (p0.y - p1.y) * rr / (d1 || 1) };
      var b = { x: p1.x + (p2.x - p1.x) * rr / (d2 || 1), y: p1.y + (p2.y - p1.y) * rr / (d2 || 1) };
      d += " L" + a.x + "," + a.y + " Q" + p1.x + "," + p1.y + " " + b.x + "," + b.y;
    }
    var last = pts[pts.length - 1];
    return d + " L" + last.x + "," + last.y;
  }

  function shape(n, x, y, w, h) {
    var cls = "dg-shape";
    switch (n.shape) {
      case "round": case "state": return s("rect", { x: x, y: y, width: w, height: h, rx: 12, class: cls });
      case "stadium": return s("rect", { x: x, y: y, width: w, height: h, rx: h / 2, class: cls });
      case "circle": return s("circle", { cx: x + w / 2, cy: y + h / 2, r: Math.min(w, h) / 2, class: cls });
      case "start": return s("circle", { cx: x + w / 2, cy: y + h / 2, r: 8, class: "dg-start" });
      case "end": return s("g", {}, [s("circle", { cx: x + w / 2, cy: y + h / 2, r: 8.5, class: "dg-endring" }), s("circle", { cx: x + w / 2, cy: y + h / 2, r: 4.5, class: "dg-start" })]);
      case "bar": return s("rect", { x: x, y: y, width: w, height: h, rx: 3, class: "dg-start" });
      case "diamond": case "choice":
        return s("path", { d: "M" + (x + w / 2) + "," + y + " L" + (x + w) + "," + (y + h / 2) + " L" + (x + w / 2) + "," + (y + h) + " L" + x + "," + (y + h / 2) + " Z", class: cls });
      case "hexagon": {
        var k = Math.min(16, w / 4);
        return s("path", { d: "M" + (x + k) + "," + y + " H" + (x + w - k) + " L" + (x + w) + "," + (y + h / 2) + " L" + (x + w - k) + "," + (y + h) + " H" + (x + k) + " L" + x + "," + (y + h / 2) + " Z", class: cls });
      }
      case "para": case "flag": {
        var q = 10;
        return s("path", { d: "M" + (x + q) + "," + y + " H" + (x + w) + " L" + (x + w - q) + "," + (y + h) + " H" + x + " Z", class: cls });
      }
      case "subroutine":
        return s("g", {}, [s("rect", { x: x, y: y, width: w, height: h, rx: 4, class: cls }),
          s("path", { d: "M" + (x + 8) + "," + y + " V" + (y + h) + " M" + (x + w - 8) + "," + y + " V" + (y + h), class: "dg-inner" })]);
      case "cylinder": {
        var ry = 6;
        return s("g", {}, [
          s("path", { d: "M" + x + "," + (y + ry) + " A" + w / 2 + "," + ry + " 0 0 1 " + (x + w) + "," + (y + ry) + " V" + (y + h - ry) +
            " A" + w / 2 + "," + ry + " 0 0 1 " + x + "," + (y + h - ry) + " Z", class: cls }),
          s("path", { d: "M" + x + "," + (y + ry) + " A" + w / 2 + "," + ry + " 0 0 0 " + (x + w) + "," + (y + ry), class: "dg-inner" })]);
      }
      case "note": {
        var f = 9;
        return s("path", { d: "M" + x + "," + y + " H" + (x + w - f) + " L" + (x + w) + "," + (y + f) + " V" + (y + h) + " H" + x + " Z", class: "dg-note" });
      }
      default: return s("rect", { x: x, y: y, width: w, height: h, rx: 6, class: cls });
    }
  }

  function tone(cls) {
    if (!cls) return "";
    if (cls === "comp") return " t-ok";
    if (cls === "tech") return " t-ink";
    if (cls === "problem") return " t-bad";
    return " t-" + cls.replace(/[^\w-]/g, "");
  }

  function layoutFlow(g, dir, compact) {
    var eg = elkGraph(g, dir, compact);
    return loadElk().then(function (e) {
      return e.layout(eg.graph).then(function (out) {
        /* a group narrower than its title: wrap the title to that width and lay out again, once */
        var titleW = {}, again = false;
        (function walk(n) {
          (n.children || []).forEach(function (c) {
            if (c.id.indexOf("g:") !== 0) return;
            var id = c.id.slice(2), w = widest(eg.sizes[c.id].ls, SMALL, 700);
            if (w + 24 > c.width) { titleW[id] = Math.max(60, c.width - 24); again = true; }
            walk(c);
          });
        })(out);
        if (!again) return { out: out, sizes: eg.sizes, dir: dir };
        var eg2 = elkGraph(g, dir, compact, titleW);
        return e.layout(eg2.graph).then(function (out2) { return { out: out2, sizes: eg2.sizes, dir: dir }; });
      });
    });
  }

  function drawFlow(g, lay, uid) {
    var out = lay.out, sizes = lay.sizes;
    var svg = s("svg", { class: "dg-svg dg-flow", role: "img" });
    defs(svg, uid);
    var groupsLayer = s("g"), edgesLayer = s("g"), labelsLayer = s("g"), nodesLayer = s("g");
    var nodeEls = {}, steps = [];
    /* ELK gives each node relative to its parent and each edge relative to its container */
    var origin = { root: { x: 0, y: 0 } };
    (function walk(n, ox, oy) {
      (n.children || []).forEach(function (c0) {
        var c = { id: c0.id, x: c0.x + ox, y: c0.y + oy, width: c0.width, height: c0.height, children: c0.children };
        origin[c.id] = { x: c.x, y: c.y };
        if (c.id.indexOf("g:") === 0) {
          var ls = sizes[c.id].ls;
          groupsLayer.appendChild(s("g", { class: "dg-group" }, [
            s("rect", { x: c.x, y: c.y, width: c.width, height: c.height, rx: 10, class: "dg-groupbox" }),
            textBlock(ls, c.x + 12, c.y + 9 + (ls.length * SLINE) / 2, SMALL, SLINE, "dg-grouptitle", "start")
          ]));
          walk(c0, c.x, c.y);
        } else {
          var nd = g.nodes[c.id], sz = sizes[c.id];
          var el = s("g", { class: "dg-node s-" + nd.shape + tone(nd.cls) }, [shape(nd, c.x, c.y, c.width, c.height)]);
          if (sz.ls && sz.ls.length && sz.ls.join("")) {
            var cy = c.y + c.height / 2 + (nd.shape === "cylinder" ? 4 : 0);
            el.appendChild(textBlock(sz.ls, c.x + c.width / 2, cy, sz.size, sz.line, "dg-label"));
          }
          nodeEls[c.id] = el;
          nodesLayer.appendChild(el);
        }
      });
    })(out, 0, 0);
    var allEdges = [];
    (function collect(n) { (n.edges || []).forEach(function (e) { allEdges.push(e); }); (n.children || []).forEach(collect); })(out);
    allEdges.forEach(function (oe) {
      var i = +oe.id.slice(1), e = g.edges[i];
      if (e.style === "invisible") return;
      var pts = [], o = origin[oe.container] || origin.root;
      var at = function (p) { return { x: p.x + o.x, y: p.y + o.y }; };
      (oe.sections || []).forEach(function (sec) {
        pts.push(at(sec.startPoint));
        (sec.bendPoints || []).forEach(function (b) { pts.push(at(b)); });
        pts.push(at(sec.endPoint));
      });
      if (pts.length < 2) return;
      var head = e.head === ">" ? "arrow" : e.head === "x" ? "cross" : e.head === "o" ? "circle" : "";
      var tail = e.tail === "<" ? "arrow" : e.tail === "x" ? "cross" : e.tail === "o" ? "circle" : "";
      var path = s("path", { d: roundedPath(pts, 8), class: "dg-edge " + e.style + (e.note ? " note" : ""),
        "marker-end": marker(uid, head), "marker-start": marker(uid, tail) });
      path._mk = { head: head, tail: tail };
      edgesLayer.appendChild(path);
      var lab = null;
      if (e.label && oe.labels && oe.labels[0]) {
        var L0 = { x: oe.labels[0].x + o.x, y: oe.labels[0].y + o.y, width: oe.labels[0].width, height: oe.labels[0].height };
        lab = s("g", { class: "dg-elabel" }, [
          s("rect", { x: L0.x, y: L0.y, width: L0.width, height: L0.height, rx: 4 }),
          textBlock(e._ls, L0.x + L0.width / 2, L0.y + L0.height / 2, SMALL, SLINE, "")
        ]);
        labelsLayer.appendChild(lab);
      }
      var name = function (id) { return (g.nodes[id] || g.groups[id]).label.replace(/\n/g, " "); };
      if (!e.note) steps.push({ i: i, path: path, els: [path, lab].filter(Boolean), nodes: [nodeEls[e.from], nodeEls[e.to]].filter(Boolean),
        who: name(e.from) + " → " + name(e.to), what: e.label.replace(/\n/g, " "), line: e.line });
    });
    steps.sort(function (a, b) { return a.i - b.i; });
    svg.appendChild(groupsLayer); svg.appendChild(edgesLayer); svg.appendChild(nodesLayer); svg.appendChild(labelsLayer);
    var W = Math.ceil(out.width), H = Math.ceil(out.height);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    return { svg: svg, w: W, h: H, steps: steps, nodes: nodeEls, uid: uid };
  }

  /* ---------------------------------------------------------- sequence layout */

  function drawSeq(d, uid, compact) {
    var svg = s("svg", { class: "dg-svg dg-seq", role: "img" });
    defs(svg, uid);
    var P = d.parts;
    /* compact: 0 (roomy), 1 or 2 (narrower labels and gaps, for diagrams wider than the column) */
    var MAXW = [250, 160, 120][compact], PW = [150, 100, 76][compact];
    P.forEach(function (p) {
      p.ls = wrap(p.label, FONT, PW, 600);
      p.w = Math.max(widest(p.ls, FONT, 600) + [28, 20, 16][compact], [84, 70, 60][compact]);
      p.h = p.ls.length * LINE + 16 + (p.kind === "actor" ? 22 : 0);
    });
    var gaps = P.map(function (p, i) { return i < P.length - 1 ? Math.max((p.w + P[i + 1].w) / 2 + [24, 14, 10][compact], [110, 84, 72][compact]) : 0; });
    function need(a, b, width) {
      if (a === b) { if (a < P.length - 1) gaps[a] = Math.max(gaps[a], width + 30); return; }
      var lo = Math.min(a, b), hi = Math.max(a, b), have = 0;
      for (var i = lo; i < hi; i++) have += gaps[i];
      if (have < width) for (var j = lo; j < hi; j++) gaps[j] += (width - have) / (hi - lo);
    }
    d.items.forEach(function (it) {
      if (it.t === "msg") {
        var a = d.byId[it.from].index, b = d.byId[it.to].index;
        it.ls = it.text ? wrap(it.text, SMALL, a === b ? [190, 130, 100][compact] : MAXW, 400) : [];
        need(a, b, widest(it.ls, SMALL, 400) + (d.autonumber ? 44 : 28));
      } else if (it.t === "note") {
        it.ls = wrap(it.text, SMALL, [230, 160, 130][compact], 400);
        it.w = widest(it.ls, SMALL, 400) + 20;
        if (it.ps.length > 1) need(d.byId[it.ps[0]].index, d.byId[it.ps[it.ps.length - 1]].index, it.w - 40);
      }
    });
    var left = 12 + P[0].w / 2;
    P.forEach(function (p, i) { p.x = i === 0 ? left : P[i - 1].x + gaps[i - 1]; });
    /* notes on the outer sides need room */
    var minX = 0, maxX = P[P.length - 1].x + P[P.length - 1].w / 2 + 12;
    d.items.forEach(function (it) {
      if (it.t !== "note") return;
      var p = d.byId[it.ps[0]];
      if (it.where === "left of") minX = Math.min(minX, p.x - 12 - it.w - 6);
      if (it.where === "right of") maxX = Math.max(maxX, p.x + 12 + it.w + 6);
      if (it.where === "over" && it.ps.length === 1) { minX = Math.min(minX, p.x - it.w / 2 - 6); maxX = Math.max(maxX, p.x + it.w / 2 + 6); }
    });
    var headH = Math.max.apply(null, P.map(function (p) { return p.h; }));
    var y = 8 + headH + 18;
    var lifeTop = 8 + headH;
    var layers = { frames: s("g"), life: s("g"), acts: s("g"), msgs: s("g"), heads: s("g"), notes: s("g") };
    var steps = [], frames = [], acts = {}, n = 0;
    var headEls = {};
    P.forEach(function (p) {
      var x = p.x - p.w / 2, g = s("g", { class: "dg-node s-actorbox" + (p.kind === "actor" ? " actor" : "") });
      g.appendChild(s("rect", { x: x, y: 8 + headH - p.h, width: p.w, height: p.h, rx: 8, class: "dg-shape" }));
      if (p.kind === "actor") {
        var cy = 8 + headH - p.h + 12;
        g.appendChild(s("g", { class: "dg-person" }, [s("circle", { cx: p.x, cy: cy, r: 4.5 }), s("path", { d: "M" + (p.x - 8) + "," + (cy + 15) + " a8,7 0 0 1 16,0" })]));
      }
      g.appendChild(textBlock(p.ls, p.x, 8 + headH - p.h / 2 + (p.kind === "actor" ? 11 : 0), FONT, LINE, "dg-label"));
      layers.heads.appendChild(g);
      headEls[p.id] = g;
    });
    function frameSpan(fr) {
      var lo = fr.lo, hi = fr.hi;
      if (lo === Infinity) { lo = 0; hi = P.length - 1; }
      return { x0: P[lo].x - P[lo].w / 2 + 4 - 8 * fr.depth, x1: P[hi].x + P[hi].w / 2 - 4 + 8 * fr.depth };
    }
    function touch(idx) { frames.forEach(function (fr) { fr.lo = Math.min(fr.lo, idx); fr.hi = Math.max(fr.hi, idx); }); }
    function activate(pid, at) { (acts[pid] = acts[pid] || []).push(at); }
    function deactivate(pid, at) {
      var st = acts[pid];
      if (!st || !st.length) return;
      var from = st.pop(), p = d.byId[pid], off = st.length * 5;
      layers.acts.appendChild(s("rect", { x: p.x - 5 + off, y: from, width: 10, height: Math.max(8, at - from), rx: 2, class: "dg-act" }));
    }
    d.items.forEach(function (it) {
      if (it.t === "open") {
        var fr = { kind: it.kind, text: it.text, y0: y, lo: Infinity, hi: -Infinity, splits: [], inner: 0, depth: 0 };
        frames.forEach(function (f) { f.inner++; f.depth = Math.max(f.depth, f.inner); });
        frames.push(fr);
        y += it.kind === "rect" ? 10 : 30;
      } else if (it.t === "split") {
        var top = frames[frames.length - 1];
        if (top) { top.splits.push({ y: y + 4, text: it.text }); y += 26; }
      } else if (it.t === "close") {
        var f = frames.pop();
        if (!f) return;
        frames.forEach(function (o) { o.inner = Math.max(0, o.inner - 1); o.lo = Math.min(o.lo, f.lo); o.hi = Math.max(o.hi, f.hi); });
        y += 8;
        var sp = frameSpan(f);
        var g = s("g", { class: "dg-frame k-" + f.kind });
        g.appendChild(s("rect", { x: sp.x0, y: f.y0, width: sp.x1 - sp.x0, height: y - f.y0, rx: 8, class: "dg-framebox" }));
        if (f.kind !== "rect") {
          var tagW = measure(f.kind, 10.5, 700) + 14;
          g.appendChild(s("path", { d: "M" + sp.x0 + "," + (f.y0 + 8) + " a8,8 0 0 1 8,-8 H" + (sp.x0 + tagW) + " V" + (f.y0 + 14) + " a6,6 0 0 1 -6,6 H" + sp.x0 + " Z", class: "dg-frametag" }));
          var tt = s("text", { x: sp.x0 + 7, y: f.y0 + 10.5, "dominant-baseline": "central", class: "dg-frametagtext", "font-size": 10.5 });
          tt.textContent = f.kind;
          g.appendChild(tt);
          if (f.text) {
            var ct = s("text", { x: sp.x0 + tagW + 8, y: f.y0 + 10.5, "dominant-baseline": "central", class: "dg-framecond", "font-size": SMALL });
            ct.textContent = "[" + f.text + "]";
            g.appendChild(ct);
          }
        }
        f.splits.forEach(function (spl) {
          g.appendChild(s("line", { x1: sp.x0, x2: sp.x1, y1: spl.y, y2: spl.y, class: "dg-framesplit" }));
          if (spl.text) {
            var st = s("text", { x: sp.x0 + 8, y: spl.y + 11, "dominant-baseline": "central", class: "dg-framecond", "font-size": SMALL });
            st.textContent = "[" + spl.text + "]";
            g.appendChild(st);
          }
        });
        layers.frames.insertBefore(g, layers.frames.firstChild);
        y += 6;
      } else if (it.t === "activate") {
        activate(it.p, y - 6); touch(d.byId[it.p].index);
      } else if (it.t === "deactivate") {
        deactivate(it.p, y - 6);
      } else if (it.t === "note") {
        var ps = it.ps.map(function (id) { return d.byId[id]; });
        var nx, nw = it.w, nh = it.ls.length * SLINE + 12;
        if (it.where === "left of") nx = ps[0].x - 12 - nw;
        else if (it.where === "right of") nx = ps[0].x + 12;
        else {
          var a = ps[0].x, b = ps[ps.length - 1].x;
          var lo2 = Math.min(a, b), hi2 = Math.max(a, b);
          nw = Math.max(nw, hi2 - lo2 + 40);
          nx = (lo2 + hi2) / 2 - nw / 2;
        }
        ps.forEach(function (p) { touch(p.index); });
        layers.notes.appendChild(s("g", { class: "dg-snote" }, [
          s("rect", { x: nx, y: y, width: nw, height: nh, rx: 6, class: "dg-note" }),
          textBlock(it.ls, nx + nw / 2, y + nh / 2, SMALL, SLINE, "")
        ]));
        y += nh + 12;
      } else if (it.t === "msg") {
        var A = d.byId[it.from], B = d.byId[it.to];
        touch(A.index); touch(B.index);
        n++;
        var th = it.ls.length * SLINE;
        var self = A === B;
        var ya = y + th + 4;
        var stA = (acts[A.id] || []).length, stB = (acts[B.id] || []).length;
        var dir = B.x >= A.x ? 1 : -1;
        var x1 = A.x + (stA ? 5 * dir : 0), x2 = B.x - (stB || it.act === "+" ? 5 * dir : 0);
        var path, cls = "dg-edge " + it.line;
        if (self) {
          var sx = A.x + (stA ? 5 : 0);
          path = s("path", { d: "M" + sx + "," + ya + " h34 a6,6 0 0 1 6,6 v10 a6,6 0 0 1 -6,6 H" + (sx + 2), class: cls });
          ya += 22;
        } else {
          path = s("path", { d: "M" + x1 + "," + ya + " L" + x2 + "," + ya, class: cls });
        }
        var hk = it.head === "arrow" ? "arrow" : it.head === "open" || it.head === "async" ? "open" : it.head === "cross" ? "cross" : "arrow";
        path.setAttribute("marker-end", marker(uid, hk));
        if (it.head === "both") path.setAttribute("marker-start", marker(uid, "arrow"));
        path._mk = { head: hk, tail: it.head === "both" ? "arrow" : "" };
        layers.msgs.appendChild(path);
        var tx = self ? A.x + 48 : (A.x + B.x) / 2;
        if (self) maxX = Math.max(maxX, tx + widest(it.ls, SMALL, 400) + 8);
        var label = it.ls.length ? textBlock(it.ls, tx, y + th / 2 + 1, SMALL, SLINE, "dg-msgtext", self ? "start" : "middle") : null;
        if (label) layers.msgs.appendChild(label);
        var num = null;
        if (d.autonumber) {
          num = s("g", { class: "dg-num" }, [s("circle", { cx: x1, cy: ya - (self ? 22 : 0), r: 8 }), textBlock([String(n)], x1, ya - (self ? 22 : 0), 9.5, 10, "")]);
          layers.msgs.appendChild(num);
        }
        if (it.act === "+") activate(B.id, ya);
        if (it.act === "-") deactivate(A.id, ya);
        steps.push({ path: path, els: [path, label, num].filter(Boolean), nodes: [headEls[A.id], headEls[B.id]], who: A.label.replace(/\n/g, " ") + " → " + B.label.replace(/\n/g, " "), what: it.text.replace(/\n/g, " "), n: n });
        y = ya + 16;
      }
    });
    Object.keys(acts).forEach(function (pid) { while (acts[pid].length) deactivate(pid, y - 4); });
    var H = y + 6;
    P.forEach(function (p) {
      layers.life.appendChild(s("line", { x1: p.x, x2: p.x, y1: lifeTop, y2: H - 4, class: "dg-life" }));
    });
    [layers.frames, layers.life, layers.acts, layers.notes, layers.msgs, layers.heads].forEach(function (l) { svg.appendChild(l); });
    var W = Math.ceil(maxX - minX);
    svg.setAttribute("viewBox", Math.floor(minX) + " 0 " + W + " " + Math.ceil(H));
    return { svg: svg, w: W, h: Math.ceil(H), steps: steps, uid: uid };
  }

  /* ---------------------------------------------------------- the block */

  var counter = 0, blocks = [];

  function Block(pre, play) {
    this.source = pre.textContent;
    this.play = play;
    this.root = document.createElement("div");
    this.root.className = "dg" + (play ? " dg-play" : "");
    this.root.tabIndex = play ? 0 : -1;
    this.canvas = document.createElement("div");
    this.canvas.className = "dg-canvas";
    this.root.appendChild(this.canvas);
    pre.replaceWith(this.root);
    this.idx = -1;
    this.speed = 1;
    this.model = parse(this.source);
    if (this.model.errors && this.model.errors.length) console.warn("diagram: lines not understood\n" + this.model.errors.join("\n"));
  }

  Block.prototype.render = function () {
    var self = this, m = this.model, uid = "dg" + (++counter);
    var avail = Math.max(240, this.canvas.clientWidth - 8);
    this.width = avail;
    var done;
    if (m.type === "seq") {
      /* too wide for the column: narrower labels and gaps */
      done = Promise.resolve(drawSeq(m, uid, 0)).then(function (r) {
        for (var level = 1; level <= 2 && r.w * MIN_SCALE > avail; level++) r = drawSeq(m, "dg" + (++counter), level);
        return r;
      });
    }
    else if (m.type === "flow") {
      var dir = m.dir;
      /* the author's direction; if the text would get too small, the same direction with narrower nodes,
         then the other direction: the first that fits, else the most readable */
      var other = dir === "LR" || dir === "RL" ? "TB" : "LR";
      var plans = [[dir, false], [dir, true], [other, false], [other, true]];
      var fits = function (l) { return l.out.width * MIN_SCALE <= avail; };
      done = (function next(i, best) {
        if (i >= plans.length) return Promise.resolve(best);
        return layoutFlow(m, plans[i][0], plans[i][1]).then(function (l) {
          if (fits(l)) return l;
          return next(i + 1, !best || l.out.width < best.out.width ? l : best);
        });
      })(0, null).then(function (l) { return drawFlow(m, l, uid); });
    } else {
      this.canvas.innerHTML = '<pre class="dg-error"></pre>';
      this.canvas.firstChild.textContent = this.source;
      return Promise.resolve();
    }
    return done.then(function (r) {
      self.drawn = r;
      self.canvas.innerHTML = "";
      r.svg.setAttribute("width", r.w);
      r.svg.style.maxWidth = "100%";
      r.svg.style.minWidth = Math.min(r.w, Math.round(r.w * MIN_SCALE)) + "px";
      self.canvas.appendChild(r.svg);
      self.steps = r.steps;
      if (self.play) { self.buildBar(); self.idx = Math.min(self.idx, self.steps.length - 1); self.apply(); }
    }).catch(function (err) {
      console.warn("diagram:", err);
      self.canvas.innerHTML = '<pre class="dg-error"></pre>';
      self.canvas.firstChild.textContent = self.source;
    });
  };

  function icon(name) {
    var P = {
      reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>', prev: '<path d="m15 18-6-6 6-6"/>',
      play: '<path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/>',
      pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
      next: '<path d="m9 18 6-6-6-6"/>', all: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
    };
    return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + P[name] + "</svg>";
  }
  function esc(x) { return String(x).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  Block.prototype.buildBar = function () {
    var self = this;
    [".dg-bar", ".dg-caption"].forEach(function (c) { var o = self.root.querySelector(c); if (o) o.remove(); });
    this.bar = null;
    if (this.steps.length < 2) return;
    var bar = document.createElement("div");
    bar.className = "dg-bar";
    bar.innerHTML =
      '<button type="button" data-dg="reset" title="' + T.reset + '">' + icon("reset") + "</button>" +
      '<button type="button" data-dg="prev" title="' + T.prev + '">' + icon("prev") + "</button>" +
      '<button type="button" data-dg="play" class="dg-playbtn" title="' + T.play + '">' + icon("play") + "</button>" +
      '<button type="button" data-dg="next" title="' + T.next + '">' + icon("next") + "</button>" +
      '<span class="dg-count"></span><span class="dg-progress">' +
      this.steps.map(function (st, i) { return '<button type="button" data-dg-go="' + i + '" title="' + T.goto + (i + 1) + (st.what ? ": " + esc(st.what) : "") + '"></button>'; }).join("") +
      '</span><button type="button" data-dg="speed" class="dg-speed" title="' + T.speed + '">' + this.speed + "×</button>" +
      '<button type="button" data-dg="all" title="' + T.all + '">' + icon("all") + "</button>";
    var cap = document.createElement("div");
    cap.className = "dg-caption";
    cap.setAttribute("aria-live", "polite");
    this.root.appendChild(bar);
    this.root.appendChild(cap);
    this.bar = bar; this.cap = cap;
  };

  Block.prototype.apply = function () {
    var self = this, idx = this.idx, uid = this.drawn.uid, touched = new Set();
    this.steps.forEach(function (st, i) {
      var state = idx < 0 ? "" : i < idx ? "done" : i === idx ? "active" : "todo";
      st.els.forEach(function (el) {
        el.classList.remove("dg-done", "dg-active", "dg-todo");
        if (state) el.classList.add("dg-" + state);
      });
      var v = state === "active" ? "-on" : state === "done" ? "-done" : "";
      if (st.path._mk.head) st.path.setAttribute("marker-end", "url(#" + uid + "-" + st.path._mk.head + v + ")");
      if (st.path._mk.tail) st.path.setAttribute("marker-start", "url(#" + uid + "-" + st.path._mk.tail + v + ")");
      if (idx >= 0 && i <= idx) st.nodes.forEach(function (n) { touched.add(n); });
    });
    var cur = idx >= 0 ? this.steps[idx].nodes : [];
    this.steps.forEach(function (st) {
      st.nodes.forEach(function (n) {
        n.classList.toggle("dg-todo", idx >= 0 && !touched.has(n) && !n.classList.contains("s-actorbox"));
        n.classList.toggle("dg-seen", idx >= 0 && touched.has(n) && cur.indexOf(n) < 0);
        n.classList.toggle("dg-cur", cur.indexOf(n) >= 0);
      });
    });
    this.drawn.svg.classList.toggle("dg-running", idx >= 0);
    this.dot(idx >= 0 ? this.steps[idx] : null);
    if (!this.bar) return;
    this.bar.querySelector(".dg-count").textContent = idx < 0 ? this.steps.length + " " + T.steps : (idx + 1) + "/" + this.steps.length;
    this.bar.querySelectorAll("[data-dg-go]").forEach(function (b, i) { b.className = idx < 0 ? "" : i < idx ? "done" : i === idx ? "cur" : ""; });
    this.bar.querySelector(".dg-playbtn").innerHTML = icon(this.timer ? "pause" : "play");
    var st = idx >= 0 ? this.steps[idx] : null;
    this.cap.innerHTML = st
      ? '<span class="dg-n">' + (idx + 1) + '</span><span class="dg-who">' + esc(st.who) + "</span>" + (st.what ? '<span class="dg-what">' + esc(st.what) + "</span>" : "")
      : '<span class="dg-hint">' + T.hint + " ▶</span>";
  };

  Block.prototype.dot = function (step) {
    var self = this;
    if (this.raf) cancelAnimationFrame(this.raf);
    (this.marks || []).forEach(function (m) { m.remove(); });
    this.marks = null;
    if (!step) return;
    var path = step.path, len = path.getTotalLength();
    var halo = s("circle", { r: 10, class: "dg-halo" }), dot = s("circle", { r: 4.5, class: "dg-dot" });
    path.parentNode.appendChild(halo); path.parentNode.appendChild(dot);
    this.marks = [halo, dot];
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var ms = 900 / this.speed, t0 = performance.now();
    var frame = function (now) {
      var t = reduce ? 1 : Math.min(1, (now - t0) / ms);
      var p = path.getPointAtLength(len * (1 - Math.pow(1 - t, 2)));
      [halo, dot].forEach(function (c) { c.setAttribute("cx", p.x); c.setAttribute("cy", p.y); });
      if (t < 1) self.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  };

  Block.prototype.go = function (i) { this.idx = Math.max(-1, Math.min(this.steps.length - 1, i)); this.apply(); };
  Block.prototype.stop = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.bar) this.bar.querySelector(".dg-playbtn").innerHTML = icon("play");
  };
  Block.prototype.toggle = function () {
    var self = this;
    if (this.timer) return this.stop();
    if (this.idx >= this.steps.length - 1) this.idx = -1;
    var tick = function () {
      if (!document.contains(self.root) || self.idx >= self.steps.length - 1) return self.stop();
      self.go(self.idx + 1);
    };
    this.timer = setInterval(tick, 1600 / this.speed);
    tick();
  };
  Block.prototype.action = function (a) {
    if (a === "play") return this.toggle();
    if (a === "speed") {
      this.speed = [1, 2, 0.5][([1, 2, 0.5].indexOf(this.speed) + 1) % 3];
      this.bar.querySelector(".dg-speed").textContent = this.speed + "×";
      if (this.timer) { this.stop(); this.toggle(); }
      return;
    }
    this.stop();
    if (a === "next") this.go(this.idx + 1);
    else if (a === "prev") this.go(this.idx - 1);
    else if (a === "reset") this.go(0);
    else if (a === "all") this.go(-1);
  };

  function find(el) { for (var i = 0; i < blocks.length; i++) if (blocks[i].root === el) return blocks[i]; return null; }

  document.addEventListener("click", function (ev) {
    var t = ev.target.closest && ev.target.closest(".dg [data-dg], .dg [data-dg-go]");
    if (!t) return;
    var b = find(t.closest(".dg"));
    if (!b) return;
    if (t.hasAttribute("data-dg-go")) { b.stop(); b.go(+t.getAttribute("data-dg-go")); }
    else b.action(t.getAttribute("data-dg"));
  });
  document.addEventListener("keydown", function (ev) {
    var b = ev.target.classList && ev.target.classList.contains("dg") ? find(ev.target) : null;
    if (!b || !b.bar) return;
    var map = { ArrowRight: "next", ArrowLeft: "prev", " ": "play" };
    if (!map[ev.key]) return;
    ev.preventDefault();
    b.action(map[ev.key]);
  });

  var observer = null, queue = Promise.resolve();
  function schedule(b) {
    if (b.pending) return;
    b.pending = true;
    queue = queue.then(function () { return b.render(); });
  }
  function sweep() { blocks.forEach(function (b) { if (!b.pending && b.root.offsetParent !== null) schedule(b); }); }

  function init() {
    blocks = blocks.filter(function (b) { var alive = document.contains(b.root); if (!alive) b.stop(); return alive; });
    var pres = document.querySelectorAll("pre.diagram, pre.diagram-sim");
    if (!pres.length) return;
    family = getComputedStyle(document.querySelector(".md-typeset") || document.body).fontFamily || family;
    measureCtx = null;
    observer = observer || new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        observer.unobserve(en.target);
        var b = find(en.target);
        if (b) schedule(b);
      });
    }, { rootMargin: "300px" });
    var fresh = [];
    pres.forEach(function (pre) {
      var b = new Block(pre, pre.classList.contains("diagram-sim"));
      blocks.push(b);
      fresh.push(b);
    });
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () {
      fresh.forEach(function (b) { observer.observe(b.root); });
      sweep();
    });
  }

  /* re-layout when the column width changes a lot (rotation, sidebar) */
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      blocks.forEach(function (b) {
        if (!b.drawn || b.timer) return;
        var w = b.canvas.clientWidth - 8;
        if (Math.abs(w - b.width) > 120) { b.pending = false; schedule(b); }
      });
    }, 300);
  });
  document.addEventListener("click", function () { setTimeout(sweep, 60); });
  document.addEventListener("toggle", sweep, true);

  /* for the browser console: Diagram.layout(source, "LR", compact) → ELK's result */
  window.Diagram = { parse: parse, layout: function (src, dir, compact) { return layoutFlow(parse(src), dir, compact).then(function (l) { return l.out; }); } };

  if (typeof document$ !== "undefined") document$.subscribe(init);
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
