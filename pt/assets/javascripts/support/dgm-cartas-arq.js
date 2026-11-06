/* Study cards for System Architecture 2027.1 (all 16 classes and their
   subpages), in two modes; ported from the Machine Learning course's cards.
   Study: flashcards with three boxes (missed / almost / got it); cards in the
   lower boxes come back first and progress is saved in the browser
   (localStorage 'arq-cartas-v1'; without it everything still works).
   Challenge: a ten-round game; each round shows a production or interview
   situation and three concept cards; the right one scores points (with a
   streak multiplier) while lives last.
   Colours are the design stages, the same in the concept map
   (arq-lessons.js STAGES; hex values in support.css), each also written on
   the card's band.

   <div class="dgm" data-dgm="cartas-arq"></div>

   The cards (and their format) live in cartas-arq-dados.js, loaded on demand. */
(function () {
  const D = window.SupDgm, A = window.ARQ;
  if (!D || !A) return;
  const { el, t } = D;
  const parent = A.parent;
  const CLASSES = A.LESSONS.map(x => x[0]).filter(c => !c.includes('.'));
  const THEMES = A.THEMES.map(([k, name, cls]) => ({ k, name, cls }));
  const STAGE = Object.fromEntries(A.STAGES.map(([k, name, icon]) => [k, { name, icon }]));
  const title = c => A.LESSON[c].title;
  const href = c => D.lesson(A.LESSON[c.l].path, c.s);
  const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');

  let CARDS = [];
  /* pt: the texts of cartas-arq-dados-pt.js, keyed by lesson|English name, over a copy of each card
     (the English data stay untouched: the language can change without a page reload) */
  function prepare(pt) {
    CARDS = (window.CARTAS_ARQ || []).filter(c => A.LESSON[c.l] && STAGE[c.e] && c.q && c.a && c.name).map(c => {
      const o = pt && pt[c.l + '|' + c.name];
      return Object.assign({}, c, o ? { name: o.name, q: o.q, a: o.a, c: o.c === undefined ? c.c : o.c } : {}, { key: c.name });
    });
    // the id comes from the lesson and the English name: renaming a card resets its progress (in both languages)
    CARDS.forEach(c => { c.id = c.l + '-' + slug(c.key); c.theme = A.theme(c.l); });
  }

  /* ─── state saved in the browser (a convenience only) ─── */
  const KEY = 'arq-cartas-v1';
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save(st) { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* no storage */ } }

  const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  function mount(root) {
    const LEVELS = ['', t('warm-up', 'aquecimento'), t('practice', 'prática'), t('challenge', 'desafio')];
    const st = Object.assign({ box: {}, themes: [], lessons: [], stages: [], best: 0, mode: 'study' }, load());
    // drop filters that no longer exist (an old save, a renamed lesson)
    const usedStages = Object.keys(STAGE).filter(k => CARDS.some(c => c.e === k));
    st.themes = [].concat(st.themes || []).filter(k => THEMES.some(x => x.k === k));
    st.lessons = [].concat(st.lessons || []).filter(l => A.LESSON[l] && st.themes.includes(A.theme(l)));
    st.stages = [].concat(st.stages || []).filter(k => usedStages.includes(k));
    root.classList.add('cx', 'dgm--ready');
    root.innerHTML = '';

    /* ─── header: modes and filters ─── */
    const tabs = root.appendChild(el('div', { class: 'cx-tabs', role: 'tablist' }));
    const tabStudy = tabs.appendChild(el('button', { type: 'button', role: 'tab', class: 'cx-tab', onclick: () => mode('study') },
      el('strong', { text: t('Study', 'Estudar') }), el('span', { text: t('cards that flip, with three boxes', 'cartas que viram, com três caixas') })));
    const tabGame = tabs.appendChild(el('button', { type: 'button', role: 'tab', class: 'cx-tab', onclick: () => mode('challenge') },
      el('strong', { text: t('Challenge', 'Desafio') }), el('span', { text: t('situation → right card, with points and lives', 'situação → carta certa, com pontos e vidas') })));

    const count = f => CARDS.filter(f).length;
    const inLesson = (c, l) => c.l === l || (!l.includes('.') && parent(c.l) === l);
    const filters = root.appendChild(el('div', { class: 'cx-filtros' }));
    const rowThemes = filters.appendChild(el('div', { class: 'cx-linha' }, el('span', { class: 'cx-rot', text: t('Topics', 'Temas') })));
    const chipAll = rowThemes.appendChild(el('button', { type: 'button', class: 'cx-chip', onclick: () => { st.themes = []; st.lessons = []; changed(); }, text: t('All', 'Todas') }));
    const chipsTheme = THEMES.map(x => rowThemes.appendChild(el('button', {
      type: 'button', class: 'cx-chip cx-chip-tema', title: x.cls.join(', ') + ' · ' + plural(count(c => c.theme === x.k), t('card', 'carta'), t('cards', 'cartas')),
      onclick: () => {
        if (st.themes.includes(x.k)) { st.themes = st.themes.filter(k => k !== x.k); st.lessons = st.lessons.filter(l => A.theme(l) !== x.k); }
        else st.themes = st.themes.concat(x.k);
        changed();
      }
    }, el('b', { text: x.k }), ' ' + x.name)));
    // the classes (and their pages) of the chosen topics, hidden while no topic is chosen
    const rowLessons = filters.appendChild(el('div', { class: 'cx-linha cx-linha-aulas' }, el('span', { class: 'cx-rot', text: t('Classes', 'Aulas') })));
    const chipsLesson = A.LESSONS.map(([l]) => {
      const n = count(c => inLesson(c, l));
      return rowLessons.appendChild(el('button', {
        type: 'button', class: 'cx-chip' + (l.includes('.') ? ' cx-chip-sub' : ' cx-chip-aula'),
        title: title(l) + ' · ' + plural(n, t('card', 'carta'), t('cards', 'cartas')) + (l.includes('.') ? '' : t(' (with its pages)', ' (com as páginas)')),
        text: l, 'data-aula': l, disabled: n ? null : true,
        onclick: () => { st.lessons = st.lessons.includes(l) ? st.lessons.filter(x => x !== l) : st.lessons.concat(l); changed(); }
      }));
    });
    const rowStages = filters.appendChild(el('div', { class: 'cx-linha' }, el('span', { class: 'cx-rot', text: t('Stages', 'Etapas') })));
    const chipsStage = usedStages.map(k => rowStages.appendChild(el('button', {
      type: 'button', class: 'cx-chip cx-e-' + k, text: STAGE[k].icon + ' ' + STAGE[k].name,
      onclick: () => { st.stages = st.stages.includes(k) ? st.stages.filter(x => x !== k) : st.stages.concat(k); changed(); }
    })));
    const counter = filters.appendChild(el('div', { class: 'cx-contagem', 'aria-live': 'polite' }));

    let study = null;
    const paneStudy = root.appendChild(el('div', { class: 'cx-pane' }));
    const paneGame = root.appendChild(el('div', { class: 'cx-pane' }));

    function deck() {
      return CARDS.filter(c => (!st.themes.length || st.themes.includes(c.theme))
        && (!st.lessons.some(l => A.theme(l) === c.theme) || st.lessons.some(l => inLesson(c, l)))
        && (!st.stages.length || st.stages.includes(c.e)));
    }

    function paintFilters() {
      chipAll.setAttribute('aria-pressed', String(!st.themes.length));
      chipsTheme.forEach((b, i) => b.setAttribute('aria-pressed', String(st.themes.includes(THEMES[i].k))));
      rowLessons.hidden = !st.themes.length;
      chipsLesson.forEach((b, i) => {
        const l = A.LESSONS[i][0];
        b.hidden = !st.themes.includes(A.theme(l));
        b.setAttribute('aria-pressed', String(st.lessons.includes(l)));
      });
      chipsStage.forEach((b, i) => b.setAttribute('aria-pressed', String(st.stages.includes(usedStages[i]))));
      const n = deck().length;
      const which = st.themes.length && !st.lessons.length ? t(' (every class of the chosen topics; pick classes or pages to narrow it)', ' (todas as aulas dos temas escolhidos; escolha aulas ou páginas para restringir)') : '';
      counter.textContent = plural(n, t('card in this deck', 'carta neste baralho'), t('cards in this deck', 'cartas neste baralho')) + which;
    }

    function changed() {
      save(st); paintFilters();
      study.next();
      game.intro();
    }

    function mode(m) {
      st.mode = m; save(st);
      tabStudy.setAttribute('aria-selected', String(m === 'study'));
      tabGame.setAttribute('aria-selected', String(m === 'challenge'));
      paneStudy.hidden = m !== 'study';
      paneGame.hidden = m !== 'challenge';
      if (m === 'study' && study) study.paintProgress();   // the Challenge may have changed the boxes
    }

    const band = (c, tag) => el(tag || 'div', { class: 'cx-faixa' },
      el('span', { text: STAGE[c.e].icon + ' ' + STAGE[c.e].name }),
      el('span', { class: 'cx-aula', title: title(c.l), text: c.l }));

    /* ─── one card (front and back) ─── */
    function face(c, side) {
      return el('div', { class: 'cx-face cx-' + side },
        band(c),
        el('div', { class: 'cx-miolo' },
          side === 'frente'
            ? el('p', { class: 'cx-pergunta', text: c.q })
            : [el('p', { class: 'cx-nome', text: c.name }), el('p', { class: 'cx-resposta', text: c.a })]),
        el('div', { class: 'cx-pe' },
          el('span', { class: 'cx-nivel', title: t('Level ', 'Nível ') + c.n + ': ' + LEVELS[c.n] }, '●'.repeat(c.n) + '○'.repeat(3 - c.n) + ' ' + LEVELS[c.n]),
          side === 'frente'
            ? el('span', { class: 'cx-dica', text: t('click or space to flip', 'clique ou espaço para virar') })
            : el('a', { href: href(c), title: title(c.l), text: t('In ', 'Na aula ') + c.l + ' · ' + title(c.l) + ' →', onclick: e => e.stopPropagation() })));
    }

    /* ─── Study mode ─── */
    study = (function () {
      const prog = paneStudy.appendChild(el('div', { class: 'cx-prog' }));
      const barEl = prog.appendChild(el('div', { class: 'cx-barra' }));
      const seg = [1, 2, 3].map(k => barEl.appendChild(el('span', { class: 'cx-seg cx-seg' + k })));
      const legend = prog.appendChild(el('div', { class: 'cx-legenda' }));
      const stage = paneStudy.appendChild(el('div', { class: 'cx-palco' }));
      const actions = paneStudy.appendChild(el('div', { class: 'cx-acoes' }));
      const btFlip = actions.appendChild(el('button', { type: 'button', class: 'cx-bt cx-bt-pri', onclick: () => flip(), text: t('Flip the card', 'Virar a carta') }));
      const LABEL = { missed: t('Missed', 'Errei'), almost: t('Almost', 'Quase'), got: t('Got it', 'Acertei') };
      const grades = [['missed', 1], ['almost', 2], ['got', 3]]
        .map(([k, key]) => actions.appendChild(el('button', { type: 'button', class: 'cx-bt cx-nota cx-' + k, hidden: true, onclick: () => grade(k) },
          LABEL[k], el('kbd', { text: String(key) }))));
      const extra = paneStudy.appendChild(el('div', { class: 'cx-extra' }));
      extra.appendChild(el('button', { type: 'button', class: 'cx-link', text: t('Skip this card', 'Pular esta carta'), onclick: () => next() }));
      extra.appendChild(el('button', { type: 'button', class: 'cx-link', text: t("Reset this deck's progress", 'Zerar o progresso deste baralho'), onclick: () => {
        deck().forEach(c => { delete st.box[c.id]; }); save(st); next();
      } }));

      let current = null, flipped = false, cardEl = null;
      const seen = {};
      let clock = 0;

      const box = c => st.box[c.id] || 0;   // 0 = never seen

      function paintProgress() {
        const d = deck();
        const n = [0, 0, 0, 0];
        d.forEach(c => { n[box(c)]++; });
        const tot = d.length || 1;
        seg.forEach((s, i) => { s.style.width = (n[i + 1] / tot * 100) + '%'; });
        legend.innerHTML = '';
        legend.append(
          el('span', { class: 'cx-l cx-l1', text: LABEL.missed + ': ' + n[1] }),
          el('span', { class: 'cx-l cx-l2', text: LABEL.almost + ': ' + n[2] }),
          el('span', { class: 'cx-l cx-l3', text: LABEL.got + ': ' + n[3] }),
          el('span', { class: 'cx-l cx-l0', text: t('New: ', 'Novas: ') + n[0] }));
      }

      // First the missed cards, then the new ones, the "almost" ones and last
      // the ones already got right; inside each box, the one seen longest ago.
      // New cards come in rising difficulty: warm-up, practice, challenge.
      const order = { 1: 0, 0: 1, 2: 2, 3: 3 };
      function choose() {
        const d = deck();
        if (!d.length) return null;
        const cand = d.filter(c => !current || c.id !== current.id || d.length === 1);
        const best = Math.min(...cand.map(c => order[box(c)]));
        const group = shuffle(cand.filter(c => order[box(c)] === best));
        group.sort((x, y) => (seen[x.id] || 0) - (seen[y.id] || 0) || (best === 1 ? x.n - y.n : 0));
        return group[0];
      }

      function next() {
        paintProgress();
        current = choose();
        flipped = false;
        stage.innerHTML = '';
        grades.forEach(b => { b.hidden = true; });
        btFlip.hidden = false;
        if (!current) {
          stage.appendChild(el('p', { class: 'cx-vazio', text: t('No card with these filters. Pick other topics, classes or stages.', 'Nenhuma carta com esses filtros. Escolha outros temas, aulas ou etapas.') }));
          btFlip.hidden = true;
          return;
        }
        seen[current.id] = ++clock;
        cardEl = stage.appendChild(el('div', {
          class: 'cx-carta cx-e-' + current.e, tabindex: '0', role: 'button',
          'aria-label': t('Card: ', 'Carta: ') + current.q + t(' Click to flip.', ' Clique para virar.'),
          onclick: () => flip(),
        }, el('div', { class: 'cx-giro' }, face(current, 'frente'), face(current, 'verso'))));
      }

      function flip() {
        if (!current) return;
        flipped = !flipped;
        cardEl.classList.toggle('is-virada', flipped);
        cardEl.setAttribute('aria-label', flipped ? t('Answer: ', 'Resposta: ') + current.name + '. ' + current.a : t('Card: ', 'Carta: ') + current.q);
        grades.forEach(b => { b.hidden = !flipped; });
        btFlip.hidden = flipped;
      }

      function grade(k) {
        if (!current || !flipped) return;
        const b = box(current);
        st.box[current.id] = k === 'missed' ? 1 : k === 'almost' ? 2 : (b === 1 ? 2 : 3);   // a missed card climbs one step at a time
        save(st);
        next();
      }

      paneStudy.addEventListener('keydown', e => {
        if (e.target.closest('a, input')) return;
        if (e.key === ' ' || e.key === 'Enter') { if (e.target.closest('.cx-carta') || e.target === paneStudy) { e.preventDefault(); flip(); } }
        else if (flipped && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); grade(['missed', 'almost', 'got'][+e.key - 1]); }
      });

      return { next, paintProgress, focus: () => cardEl && cardEl.focus({ preventScroll: true }) };
    })();

    /* ─── Challenge mode ─── */
    const game = (function () {
      const ROUNDS = 10, LIVES = 3;
      let g = null;
      const hasScene = c => !!c.c;

      function pool() {
        const d = deck().filter(hasScene);
        return d.length >= 4 ? d : CARDS.filter(hasScene);
      }

      // two wrong options: never a card of the same family (it could also
      // answer the situation) nor one with the same name; first from the
      // chosen deck and the same stage, so they are plausible
      function options(right) {
        const fam = c => [].concat(c.fam || []);
        const names = new Set([right.name.toLowerCase()]);
        const used = new Set();
        const others = CARDS.filter(c => {
          const n = c.name.toLowerCase();
          if (c === right || names.has(n) || used.has(n)) return false;
          if (fam(c).some(f => fam(right).includes(f))) return false;
          used.add(n); return true;
        });
        const inDeck = new Set(deck());
        const groups = [
          others.filter(c => inDeck.has(c) && c.e === right.e),
          others.filter(c => inDeck.has(c) && c.e !== right.e),
          others.filter(c => !inDeck.has(c) && c.e === right.e),
          others.filter(c => !inDeck.has(c) && c.e !== right.e),
        ];
        return shuffle([right, ...groups.flatMap(shuffle).slice(0, 2)]);
      }

      function intro() {
        g = null;
        paneGame.innerHTML = '';
        paneGame.onkeydown = null;
        const n = pool().length;
        const filtered = deck().filter(hasScene).length >= 4;
        const missedBox = t('The cards you miss go to the "Missed" box of the Study mode.', 'As cartas que você errar vão para a caixa "Errei" do modo Estudar.');
        paneGame.appendChild(el('div', { class: 'cx-abertura' },
          el('p', { class: 'cx-titulo', text: t('Which card solves it?', 'Qual carta resolve?') }),
          el('p', {}, t('Each round shows a situation from production or from a design interview, and three concept cards. Pick the card that explains or solves the situation. ',
            'Cada rodada mostra uma situação de produção ou de uma entrevista de design e três cartas de conceito. Escolha a carta que explica ou resolve a situação. '),
          t('Right answers in a row multiply the points (streak); each miss costs a life. There are ', 'Acertos seguidos multiplicam os pontos (sequência); cada erro custa uma vida. São '),
          el('strong', { text: ROUNDS + t(' rounds', ' rodadas') }), t(' and ', ' e '), el('strong', { text: LIVES + t(' lives', ' vidas') }), '.'),
          el('p', { class: 'cx-sub', text: (filtered
            ? t(n + ' situations with the chosen filters. ', n + ' situações com os filtros escolhidos. ')
            : t('These filters leave too few situations: the game uses all ' + n + ' situations of every class. ', 'Com esses filtros há poucas situações: o jogo usa as ' + n + ' situações de todas as aulas. ')) + missedBox }),
          st.best ? el('p', { class: 'cx-recorde', text: t('Your best: ', 'Seu recorde: ') + st.best + t(' points', ' pontos') }) : null,
          el('button', { type: 'button', class: 'cx-bt cx-bt-pri', text: t('Start', 'Começar'), onclick: start, disabled: n ? null : true })));
      }

      function start() {
        g = { queue: shuffle(pool()).slice(0, ROUNDS), r: 0, points: 0, streak: 0, lives: LIVES, wrong: [], right: 0 };
        round();
      }

      function hud() {
        const mult = 1 + Math.min(3, Math.floor(g.streak / 2));
        return el('div', { class: 'cx-hud' },
          el('span', { text: t('Round ', 'Rodada ') + (g.r + 1) + t(' of ', ' de ') + g.queue.length }),
          el('span', { class: 'cx-vidas', 'aria-label': g.lives + t(' lives', ' vidas'), text: '♥'.repeat(g.lives) + '♡'.repeat(LIVES - g.lives) }),
          el('span', { class: 'cx-combo' + (mult > 1 ? ' is-on' : ''), text: t('streak ×', 'sequência ×') + mult }),
          el('span', { class: 'cx-pontos', text: g.points + ' pts' }));
      }

      function round() {
        if (g.r >= g.queue.length || g.lives <= 0) return end();
        const right = g.queue[g.r];
        paneGame.innerHTML = '';
        paneGame.appendChild(hud());
        paneGame.appendChild(el('div', { class: 'cx-cena' },
          el('span', { class: 'cx-rot', text: t('Situation', 'Situação') }),
          el('p', { text: right.c })));
        const hand = paneGame.appendChild(el('div', { class: 'cx-mao', role: 'group', 'aria-label': t('Pick a card', 'Escolha uma carta') }));
        const opts = options(right);
        const btns = opts.map((c, i) => hand.appendChild(el('button', {
          type: 'button', class: 'cx-opcao cx-e-' + c.e, onclick: () => pick(c, right, btns, opts, feedback) },
          band(c, 'span'),
          el('span', { class: 'cx-opnome', text: c.name }),
          el('kbd', { text: String(i + 1) }))));
        const feedback = paneGame.appendChild(el('div', { class: 'cx-retorno', 'aria-live': 'polite' }));
        paneGame.onkeydown = e => {
          if (['1', '2', '3'].includes(e.key) && btns[+e.key - 1] && !btns[0].disabled) { e.preventDefault(); btns[+e.key - 1].click(); }
        };
        btns[0].focus({ preventScroll: true });
      }

      function pick(c, right, btns, opts, feedback) {
        btns.forEach((b, i) => {
          b.disabled = true;
          if (opts[i] === right) b.classList.add('is-certa');
          else if (opts[i] === c) b.classList.add('is-errada');
        });
        const ok = c === right;
        if (ok) {
          const mult = 1 + Math.min(3, Math.floor(g.streak / 2));
          g.points += 100 * mult; g.streak++; g.right++;
        } else {
          g.lives--; g.streak = 0; g.wrong.push(right);
          st.box[right.id] = 1; save(st);
        }
        paneGame.replaceChild(hud(), paneGame.firstChild);
        feedback.innerHTML = '';
        feedback.classList.toggle('is-ok', ok);
        feedback.classList.toggle('is-erro', !ok);
        feedback.append(...[
          el('p', { class: 'cx-veredito', text: ok ? t('Right!', 'Certa!') : t('Not that one: the right card is "', 'Não é essa: a carta certa é "') + right.name + '".' }),
          el('p', { text: right.a }),
          !ok ? el('p', { class: 'cx-sub' }, t('Your pick, "', 'A sua escolha, "') + c.name + '": ' + c.a) : null,
          el('p', { class: 'cx-sub' }, el('a', { href: href(right), text: t('Review it in ', 'Rever em ') + right.l + ' · ' + title(right.l) + ' →' }))].filter(Boolean));
        const over = g.lives <= 0 || g.r + 1 >= g.queue.length;
        const nextBt = feedback.appendChild(el('button', { type: 'button', class: 'cx-bt cx-bt-pri', text: over ? t('See the result', 'Ver o resultado') : t('Next round', 'Próxima rodada'),
          onclick: () => { g.r++; round(); } }));
        nextBt.focus({ preventScroll: true });
      }

      function end() {
        const record = g.points > (st.best || 0);
        if (record) { st.best = g.points; save(st); }
        paneGame.innerHTML = '';
        paneGame.onkeydown = null;
        const dead = g.lives <= 0;
        const pts = t(' points', ' pontos');
        paneGame.appendChild(el('div', { class: 'cx-abertura' },
          el('p', { class: 'cx-titulo', text: dead ? t('Out of lives', 'Fim das vidas') : t('Challenge over', 'Fim do desafio') }),
          el('p', { class: 'cx-placar', text: g.points + pts }),
          el('p', { text: plural(g.right, t('right answer in ', 'acerto em '), t('right answers in ', 'acertos em ')) + plural(g.r, t('round', 'rodada'), t('rounds', 'rodadas')) + '.'
            + (record ? t(' New best!', ' Novo recorde!') : st.best ? t(' Best: ', ' Recorde: ') + st.best + pts + '.' : '') }),
          g.wrong.length ? el('div', { class: 'cx-revisar' },
            el('p', { class: 'cx-rot', text: t('To review (already in the "Missed" box of the Study mode)', 'Para revisar (já estão na caixa "Errei" do modo Estudar)') }),
            el('ul', {}, g.wrong.map(c => el('li', {},
              el('strong', { text: c.name + ': ' }), c.a + ' ',
              el('a', { href: href(c), title: title(c.l), text: c.l + ' →' }))))) : el('p', { text: t('No misses. Try other classes, or all of them.', 'Nenhum erro. Tente com outras aulas ou com todas.') }),
          el('div', { class: 'cx-acoes' },
            el('button', { type: 'button', class: 'cx-bt cx-bt-pri', text: t('Play again', 'Jogar de novo'), onclick: start }),
            g.wrong.length ? el('button', { type: 'button', class: 'cx-bt', text: t('Study the ones I missed', 'Estudar as que errei'), onclick: () => { mode('study'); study.next(); } }) : null)));
      }

      return { intro };
    })();

    paintFilters();
    study.next();
    game.intro();
    mode(st.mode === 'challenge' ? 'challenge' : 'study');
  }

  D.register('cartas-arq', root => {
    root.classList.add('cx');
    root.textContent = t('Loading the cards…', 'Carregando as cartas…');
    D.loadData('cartas-arq-dados.js', 'CARTAS_ARQ')
      .then(() => (D.isPT ? D.loadData('cartas-arq-dados-pt.js', 'CARTAS_ARQ_PT').catch(() => null) : null))
      .then(pt => { prepare(pt); mount(root); })
      .catch(err => { console.error('[support] cartas-arq', err); root.textContent = t('The cards could not be loaded. Reload the page.', 'Não foi possível carregar as cartas. Recarregue a página.'); });
  });
})();
