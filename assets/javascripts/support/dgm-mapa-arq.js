/* Concept map of System Architecture 2027.1 (Support > Concept Map): how the
   ideas of the 16 classes connect. Ported from the Machine Learning course's
   concept map (same features and UX).
   Rows: the theme of the class where each concept first appears, in course
   order (arq-lessons.js THEMES). Columns: the design stage (STAGES: requirements
   & numbers, building blocks, data & consistency, operate at scale), with the
   same colours as the study cards.
   Tapping a concept lights its neighbours, draws the connections and opens the
   panel with what it is, the classes where it is taught (linked to the section)
   and one sentence per neighbour ("leads to" / "comes from"). Trails walk one
   of the course's questions step by step; the class buttons (grouped by theme)
   light the concepts of each class; the search finds a concept by name or
   definition. On a phone the grid becomes chips by theme, the classes sit under
   one tab per theme and the panel is a bottom sheet (× , Esc or tap again).
   The data (concepts, connections, trails) live in mapa-arq-dados.js, loaded
   on demand.

   <div class="dgm" data-dgm="mapa-arq" data-title="..."></div> */
(function () {
  const D = window.SupDgm, A = window.ARQ;
  if (!D || !A) return;
  const { el, svg, t } = D;
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ­]/g, '').toLowerCase();
  const parent = A.parent;
  const CLASSES = A.LESSONS.map(x => x[0]).filter(c => !c.includes('.'));
  const title = c => A.LESSON[c].title;
  const href = (c, anchor) => D.lesson(A.LESSON[c].path, anchor);
  const THEME = Object.fromEntries(A.THEMES.map(([k, name, cls]) => [k, { name, cls }]));
  const range = k => { const cs = THEME[k].cls; return cs.length > 1 ? cs[0] + '–' + cs[cs.length - 1] : cs[0]; };
  const STAGE = Object.fromEntries(A.STAGES.map(([k, name, icon]) => [k, { name, icon }]));

  function prepare(data) {
    const NODES = data.nodes.filter(n => n.a.every(([c]) => A.LESSON[c]));
    NODES.forEach(n => {
      // the row: the first lesson in course order, unless f names the lesson that really teaches it
      n.first = n.f && A.LESSON[n.f] ? n.f : n.a.map(x => x[0]).sort((p, q) => A.LESSON[p].i - A.LESSON[q].i)[0];
      n.theme = A.theme(n.first);
    });
    const NODE = Object.fromEntries(NODES.map(n => [n.id, n]));
    const EDGES = data.edges.filter(([a, b]) => NODE[a] && NODE[b]);
    const TRAILS = data.trails.filter(T => T.p.every(([id]) => NODE[id]));
    return { NODES, NODE, EDGES, TRAILS };
  }

  function mount(root, data) {
    const { NODES, NODE, EDGES, TRAILS } = prepare(data);
    const f = D.frame(root, { title: root.dataset.title || t('The concepts of System Architecture and how they connect', 'Os conceitos de Arquitetura de Sistemas e como eles se ligam') });
    root.classList.add('mp');
    const help = t('Tap a concept to see what it is and what it connects to. Or follow a trail.',
      'Toque num conceito para ver o que ele é e com o que se liga. Ou siga uma trilha.');
    f.say(help);

    /* ─── bar: search, trails, classes and legend ─── */
    const bar = f.body.appendChild(el('div', { class: 'mp-barra' }));
    const search = bar.appendChild(el('input', {
      type: 'search', class: 'mp-busca', placeholder: t('Search a concept: quorum, outbox, p99, canary…', 'Procure um conceito: quórum, outbox, p99, canário…'),
      'aria-label': t('Search a concept', 'Procurar um conceito'), oninput: () => find(search.value),
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); const k = matches(search.value); if (k.length) pick(k[0].id); } },
    }));
    const status = bar.appendChild(el('div', { class: 'mp-status', 'aria-live': 'polite' }));
    const rowT = bar.appendChild(el('div', { class: 'mp-linha' }, el('span', { class: 'mp-rot', text: t('Trails', 'Trilhas') })));
    const rollT = rowT.appendChild(el('div', { class: 'mp-rolo' }));
    const btTrails = TRAILS.map((T, i) => rollT.appendChild(el('button', {
      type: 'button', class: 'mp-chip mp-chip-trilha', 'aria-pressed': 'false',
      onclick: () => (state.type === 'trail' && state.t === i ? close() : trail(i, 0)) },
      el('span', { class: 'mp-chip-n', text: String(i + 1) }), T.n)));
    // classes grouped by theme; on a phone, the theme tabs choose which group shows
    const rowA = bar.appendChild(el('div', { class: 'mp-linha mp-linha-aulas' }, el('span', { class: 'mp-rot', text: t('Classes', 'Aulas') })));
    const boxA = rowA.appendChild(el('div', { class: 'mp-aulas-caixa' }));
    const tabs = boxA.appendChild(el('div', { class: 'mp-rolo mp-temas', role: 'tablist', 'aria-label': t('Themes', 'Temas') }));
    const rollA = boxA.appendChild(el('div', { class: 'mp-rolo mp-grupos' }));
    const groups = {}, btTabs = {}, btClasses = {};
    A.THEMES.forEach(([k, name, cls]) => {
      btTabs[k] = tabs.appendChild(el('button', { type: 'button', class: 'mp-chip mp-aba', role: 'tab', 'aria-selected': 'false',
        onclick: () => showTheme(k) }, el('b', { text: k }), name));
      groups[k] = rollA.appendChild(el('span', { class: 'mp-grupo' },
        el('b', { class: 'mp-grupo-rot', title: name, text: k })));
      cls.forEach(c => {
        btClasses[c] = groups[k].appendChild(el('button', {
          type: 'button', class: 'mp-chip mp-chip-aula', 'aria-pressed': 'false', text: c, title: c + ' · ' + title(c), onclick: () => lesson(c) }));
      });
    });
    function showTheme(k) {
      A.THEMES.forEach(([j]) => {
        groups[j].classList.toggle('is-ativo', j === k);
        btTabs[j].setAttribute('aria-selected', String(j === k));
      });
    }
    showTheme(A.THEMES[0][0]);
    bar.appendChild(el('div', { class: 'mp-legenda', 'aria-hidden': 'true' },
      A.STAGES.map(([k, name, icon]) => el('span', { class: 'mp-leg mp-e-' + k }, el('b', { text: icon }), name))));

    /* ─── grid: themes × stages ─── */
    const body = f.body.appendChild(el('div', { class: 'mp-corpo' }));
    const grid = body.appendChild(el('div', { class: 'mp-grade' }));
    const panel = body.appendChild(el('aside', { class: 'mp-painel', 'aria-label': t('Map details', 'Detalhes do mapa') }));
    grid.appendChild(el('div', { class: 'mp-canto' }));
    A.STAGES.forEach(([k, name, icon]) => grid.appendChild(el('div', { class: 'mp-col mp-e-' + k },
      el('span', { class: 'mp-col-ic', text: icon }), name)));
    const buttons = {};
    A.THEMES.forEach(([k, name]) => {
      grid.appendChild(el('div', { class: 'mp-sem' },
        el('span', { class: 'mp-sem-n', text: k }),
        el('span', { class: 'mp-sem-t' }, el('strong', { text: name }), el('span', { text: range(k) }))));
      A.STAGES.forEach(([e]) => {
        const cell = grid.appendChild(el('div', { class: 'mp-cel mp-e-' + e }));
        NODES.filter(n => n.theme === k && n.e === e).sort((x, y) => A.LESSON[x.first].i - A.LESSON[y.first].i).forEach(n => {
          buttons[n.id] = cell.appendChild(el('button', {
            type: 'button', class: 'mp-no mp-e-' + n.e, 'aria-pressed': 'false', onclick: () => pick(n.id) },
            el('span', { class: 'mp-num' }),
            el('span', { class: 'mp-no-nome', text: n.n }),
            el('span', { class: 'mp-cod', text: n.first })));
        });
      });
    });

    /* ─── drawn connections (wide grid only) ─── */
    const layer = grid.appendChild(svg('svg', { class: 'mp-svg', 'aria-hidden': 'true' }));
    const suffix = Math.random().toString(36).slice(2, 8);
    layer.appendChild(svg('defs', {}, A.STAGES.map(([k]) => k).concat('trilha').map(k => svg('marker', {
      id: 'mp-ponta-' + k + '-' + suffix, viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' },
      svg('path', { d: 'M1,1 L9,5 L1,9', class: 'mp-cab mp-e-' + k })))));
    const strokes = layer.appendChild(svg('g', {}));
    let lines = [];

    function box(id) {
      const g = grid.getBoundingClientRect(), r = buttons[id].getBoundingClientRect();
      return { x: r.left - g.left, y: r.top - g.top, w: r.width, h: r.height };
    }
    function curve(P, Q) {
      const ax = P.x + P.w / 2, bx = Q.x + Q.w / 2;
      if (Math.abs(ax - bx) < Math.max(P.w, Q.w) / 2) {   // same column: loop on the right
        const x1 = P.x + P.w, y1 = P.y + P.h / 2, x2 = Q.x + Q.w + 2, y2 = Q.y + Q.h / 2;
        const dx = 18 + Math.min(40, Math.abs(y2 - y1) / 6);
        return `M${x1},${y1} C${x1 + dx},${y1} ${x2 + dx},${y2} ${x2},${y2}`;
      }
      const dir = bx > ax ? 1 : -1;
      const x1 = dir > 0 ? P.x + P.w : P.x, y1 = P.y + P.h / 2;
      const x2 = dir > 0 ? Q.x - 2 : Q.x + Q.w + 2, y2 = Q.y + Q.h / 2;
      const m = (x1 + x2) / 2;
      return `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`;
    }
    function draw() {
      if (D.narrow() || !grid.isConnected) return;
      const g = grid.getBoundingClientRect();
      layer.setAttribute('width', g.width); layer.setAttribute('height', g.height);
      layer.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
      lines.forEach(L => L.el.setAttribute('d', curve(box(L.a), box(L.b))));
    }
    // pairs [from, to, extra class]; the colour is the stage of the arrival node
    function connect(pairs) {
      strokes.innerHTML = '';
      lines = pairs.map(([a, b, cls]) => {
        const e = cls === 'mp-trilha' ? 'trilha' : NODE[b].e;
        return { a, b, el: strokes.appendChild(svg('path', { class: 'mp-traco mp-e-' + e + (cls ? ' ' + cls : ''), 'marker-end': `url(#mp-ponta-${e}-${suffix})` })) };
      });
      draw();
    }
    if ('ResizeObserver' in window) new ResizeObserver(draw).observe(grid);
    window.addEventListener('load', draw);

    /* ─── state ─── */
    let state = { type: 'none' };

    function clear() {
      Object.values(buttons).forEach(b => {
        b.classList.remove('is-on', 'is-viz', 'is-off', 'is-futuro', 'is-achado');
        b.setAttribute('aria-pressed', 'false');
        b.querySelector('.mp-num').textContent = '';
      });
      btTrails.forEach(b => b.setAttribute('aria-pressed', 'false'));
      Object.values(btClasses).forEach(b => b.setAttribute('aria-pressed', 'false'));
      connect([]);
    }
    function close() {
      state = { type: 'none' };
      clear();
      root.classList.remove('mp-aberto');
      initialPanel();
      if (search.value.trim()) find(search.value);
      else { f.say(help); status.textContent = ''; }
    }
    // Opens the panel (the bottom sheet on a phone), focuses it (so Esc and the
    // arrows keep working after a click) and, on a narrow screen, scrolls the
    // grid to the concept, which would otherwise sit under the sheet.
    const tight = () => window.matchMedia('(max-width: 59.9375em)').matches;
    function open(id) {
      root.classList.add('mp-aberto');
      panel.scrollTop = 0;
      const target = panel.querySelector('.mp-pnome');
      if (target) { target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }
      if (id && tight()) buttons[id].scrollIntoView({ block: 'start' });
      else if (!tight()) {
        const top = panel.getBoundingClientRect().top;
        if (top > window.innerHeight - 120) window.scrollBy(0, top - 80);
      }
    }

    /* ─── panel pieces ─── */
    const head = (tone, label) => el('div', { class: 'mp-pcab mp-e-' + tone },
      el('span', { class: 'mp-pcab-rot', text: label }),
      el('button', { type: 'button', class: 'mp-fechar', 'aria-label': t('Close', 'Fechar'), text: '×', onclick: close }));
    // one link per class page (its first section), even if the concept returns in another section
    const lessonLinks = n => el('div', { class: 'mp-aulas' },
      n.a.filter(([c], i) => n.a.findIndex(x => x[0] === c) === i)
        .map(([c, anchor]) => el('a', { class: 'mp-aula', href: href(c, anchor), text: c + ' · ' + title(c) + ' →' })));
    const goTo = id => el('button', { type: 'button', class: 'mp-ir mp-e-' + NODE[id].e, onclick: () => pick(id) },
      el('b', { text: STAGE[NODE[id].e].icon }), NODE[id].n);

    function pick(id) {
      if (state.type === 'node' && state.id === id) return close();
      state = { type: 'node', id };
      clear();
      const n = NODE[id];
      const out = EDGES.filter(([a]) => a === id), inc = EDGES.filter(([, b]) => b === id);
      const nb = new Set(out.map(l => l[1]).concat(inc.map(l => l[0])));
      Object.entries(buttons).forEach(([k, b]) => b.classList.add(k === id ? 'is-on' : nb.has(k) ? 'is-viz' : 'is-off'));
      buttons[id].setAttribute('aria-pressed', 'true');
      connect(out.map(([a, b]) => [a, b]).concat(inc.map(([a, b]) => [a, b])));
      const highlight = (a, b, on) => lines.forEach(L => { if (L.a === a && L.b === b) L.el.classList.toggle('is-forte', on); });
      const list = (label, items, other) => items.length ? [
        el('p', { class: 'mp-rot', text: label + ' · ' + items.length }),
        el('ul', { class: 'mp-lista' }, items.map(([a, b, s]) => el('li', {
          onmouseenter: () => highlight(a, b, true), onmouseleave: () => highlight(a, b, false) },
          goTo(other(a, b)), el('span', { text: s })))),
      ] : [];
      panel.innerHTML = '';
      panel.append(
        head(n.e, STAGE[n.e].icon + ' ' + STAGE[n.e].name + ' · ' + THEME[n.theme].name + ' · ' + n.first),
        el('div', { class: 'mp-pcorpo' },
          el('p', { class: 'mp-pnome', text: n.n }),
          el('p', { class: 'mp-pdef', text: n.d }),
          lessonLinks(n),
          list(t('Leads to', 'Leva a'), out, (a, b) => b),
          list(t('Comes from', 'Vem de'), inc, a => a)));
      f.say(t('Tap a neighbour to follow the thread; tap the concept again (or ×) to close.',
        'Toque num vizinho para seguir o fio; toque de novo no conceito (ou no ×) para fechar.'));
      open(id);
    }

    function trail(ti, step) {
      const T = TRAILS[ti];
      step = Math.max(0, Math.min(T.p.length - 1, step));
      state = { type: 'trail', t: ti, step };
      clear();
      btTrails[ti].setAttribute('aria-pressed', 'true');
      const ids = T.p.map(p => p[0]);
      Object.entries(buttons).forEach(([k, b]) => {
        const i = ids.indexOf(k);
        if (i < 0) { b.classList.add('is-off'); return; }
        b.classList.add(i === step ? 'is-on' : i < step ? 'is-viz' : 'is-futuro');
        b.querySelector('.mp-num').textContent = String(i + 1);
      });
      const pairs = [];
      for (let i = 0; i < step; i++) pairs.push([ids[i], ids[i + 1], 'mp-trilha']);
      connect(pairs);
      const [id, sentence] = T.p[step];
      const n = NODE[id];
      const last = step === T.p.length - 1;
      panel.innerHTML = '';
      panel.append(
        head('trilha', t('Trail', 'Trilha') + ' ' + (ti + 1) + ' · ' + t('step', 'passo') + ' ' + (step + 1) + ' ' + t('of', 'de') + ' ' + T.p.length),
        el('div', { class: 'mp-pcorpo' },
          el('p', { class: 'mp-ptrilha', text: T.n }),
          el('div', { class: 'mp-passos', role: 'group', 'aria-label': t('Trail steps', 'Passos da trilha') },
            T.p.map((p, i) => el('button', {
              type: 'button', class: 'mp-passo mp-e-' + NODE[p[0]].e + (i === step ? ' is-on' : i < step ? ' is-feito' : ''),
              'aria-label': t('Step', 'Passo') + ' ' + (i + 1) + ': ' + NODE[p[0]].n, title: NODE[p[0]].n, onclick: () => trail(ti, i) }))),
          el('p', { class: 'mp-pnome mp-e-' + n.e }, el('b', { class: 'mp-pic', text: STAGE[n.e].icon }), n.n),
          el('p', { class: 'mp-pdef', text: sentence }),
          lessonLinks(n),
          el('div', { class: 'mp-nav' },
            el('button', { type: 'button', class: 'mp-bt', text: t('‹ Back', '‹ Anterior'), disabled: step === 0, onclick: () => trail(ti, step - 1) }),
            last
              ? el('button', { type: 'button', class: 'mp-bt mp-bt-pri', text: ti + 1 < TRAILS.length ? t('Next trail ›', 'Próxima trilha ›') : t('Close', 'Fechar'), onclick: () => (ti + 1 < TRAILS.length ? trail(ti + 1, 0) : close()) })
              : el('button', { type: 'button', class: 'mp-bt mp-bt-pri', text: t('Next ›', 'Próximo ›'), onclick: () => trail(ti, step + 1) }))));
      f.say(t('Use ‹ › in the panel (or the arrow keys) to walk the trail.', 'Use ‹ › no painel (ou as setas do teclado) para andar pela trilha.'));
      open(id);
    }

    function lesson(c) {
      if (state.type === 'lesson' && state.c === c) return close();
      state = { type: 'lesson', c };
      clear();
      showTheme(A.theme(c));
      btClasses[c].setAttribute('aria-pressed', 'true');
      const mine = NODES.filter(n => n.a.some(x => parent(x[0]) === c));
      Object.entries(buttons).forEach(([k, b]) => b.classList.add(mine.some(n => n.id === k) ? 'is-viz' : 'is-off'));
      const fresh = mine.filter(n => parent(n.first) === c), old = mine.filter(n => parent(n.first) !== c);
      const group = (label, items, extra) => items.length ? [
        el('p', { class: 'mp-rot', text: label + ' · ' + items.length }),
        el('ul', { class: 'mp-lista' }, items.map(n => el('li', {}, goTo(n.id), extra ? el('span', { text: extra(n) }) : null))),
      ] : [];
      const pages = A.LESSONS.map(x => x[0]).filter(x => parent(x) === c);   // the class and its subpages
      panel.innerHTML = '';
      panel.append(
        head('trilha', t('Class', 'Aula') + ' ' + c + ' · ' + THEME[A.theme(c)].name),
        el('div', { class: 'mp-pcorpo' },
          el('p', { class: 'mp-pnome', text: c + ' · ' + title(c) }),
          el('div', { class: 'mp-aulas' }, pages.map(x => el('a', { class: 'mp-aula', href: href(x),
            text: (x === c ? t('Open the class', 'Abrir a aula') : x + ' · ' + title(x)) + ' →' }))),
          group(t('Introduced here', 'Apresentados aqui'), fresh),
          group(t('Revisited', 'Retomados'), old, n => t('first seen in ', 'apareceu em ') + n.first + ' · ' + title(n.first))));
      f.say(t('Tap the class again (or ×) to close.', 'Toque de novo na aula (ou no ×) para fechar.'));
      open();
    }

    // the search looks at the name and at the definition
    function matches(q) {
      const k = norm(q.trim());
      if (!k) return [];
      return NODES.filter(n => norm(n.n + ' ' + (n.alt || '') + ' ' + n.d).includes(k))
        .sort((x, y) => norm(y.n + ' ' + (y.alt || '')).includes(k) - norm(x.n + ' ' + (x.alt || '')).includes(k));
    }
    function find(q) {
      if (state.type !== 'none') close();
      clear();
      if (!q.trim()) { f.say(help); status.textContent = ''; return; }
      const k = matches(q);
      Object.entries(buttons).forEach(([id, b]) => b.classList.add(k.some(n => n.id === id) ? 'is-achado' : 'is-off'));
      status.textContent = k.length
        ? k.length + ' ' + (k.length === 1 ? t('concept found', 'conceito encontrado') : t('concepts found', 'conceitos encontrados')) + t(': tap one (or press Enter to open the first).', ': toque num deles (ou Enter para abrir o primeiro).')
        : t('No concept with that name. Try another word.', 'Nenhum conceito com esse nome. Tente outra palavra.');
    }

    function initialPanel() {
      panel.innerHTML = '';
      panel.append(
        el('div', { class: 'mp-pcorpo' },
          el('p', { class: 'mp-rot', text: t('How to read', 'Como ler') }),
          el('p', { text: t('Each concept sits in the row of the theme of the class where it first appears and in the column of its design stage. The code in the corner is that class (C9.2 = class 9, second page).',
            'Cada conceito está na linha do tema da aula em que aparece pela primeira vez e na coluna da etapa do projeto. O código no canto é essa aula (C9.2 = aula 9, segunda página).') }),
          el('p', { text: NODES.length + t(' concepts and ', ' conceitos e ') + EDGES.length + t(' connections. Start with a trail:', ' ligações. Comece por uma trilha:') }),
          el('ul', { class: 'mp-lista' }, TRAILS.map((T, i) => el('li', {},
            el('button', { type: 'button', class: 'mp-ir mp-e-trilha', onclick: () => trail(i, 0) },
              el('b', { text: String(i + 1) }), T.n))))));
    }

    function onKey(e) {
      if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (state.type === 'none' || e.target.closest('input, textarea, select')) return;
      if (e.target !== document.body && !root.contains(e.target)) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (state.type !== 'trail') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); trail(state.t, state.step + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); trail(state.t, state.step - 1); }
    }
    document.addEventListener('keydown', onKey);

    initialPanel();
  }

  D.register('mapa-arq', root => {
    root.classList.add('mp');
    root.textContent = t('Loading the map…', 'Carregando o mapa…');
    D.loadData('mapa-arq-dados.js', 'MAPA_ARQ')
      .then(data => mount(root, data))
      .catch(err => { console.error('[support] mapa-arq', err); root.textContent = t('The map could not be loaded. Reload the page.', 'Não foi possível carregar o mapa. Recarregue a página.'); });
  });
})();
