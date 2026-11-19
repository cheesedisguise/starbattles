(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const cellsEl = $('cells');
  const bandsEl = $('bands');
  const linesEl = $('lines');
  const rowLocksEl = $('rowLocks');
  const colLocksEl = $('colLocks');
  const statusEl = $('status');
  const timerEl = $('timer');
  const sizeSel = $('sizeSel');

  const EMPTY = 0, DOT = 1, STAR = 2;
  const SVGNS = 'http://www.w3.org/2000/svg';

  const ICONS = {
    star: '<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.4l2.83 6.13 6.7.73-5 4.53 1.4 6.6L12 17.02 6.07 20.4l1.4-6.6-5-4.53 6.7-.73z"/></svg>',
    lockOpen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="shackle" d="M8 11V7a4 4 0 0 1 7.75-1.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="5" y="11" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    lockShut: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="shackle" d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="5" y="11" width="14" height="10" rx="2.5" fill="currentColor"/><circle cx="12" cy="16" r="1.5" fill="var(--surface)"/></svg>',
    soundOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
    soundOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
  };

  /* ================= storage helpers ================= */
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  /* ================= sound ================= */
  const Sound = (() => {
    let ctx = null, master = null;
    let enabled = load('sb-sound', true);

    function ensure() {
      if (!enabled) return null;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.55;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function tone(freq, dur, opts) {
      opts = opts || {};
      const c = ensure(); if (!c) return;
      const t = c.currentTime + (opts.delay || 0);
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
      const vol = opts.vol == null ? 0.2 : opts.vol;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + (opts.attack || 0.005));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = osc;
      if (opts.filter) {
        const f = c.createBiquadFilter();
        f.type = opts.filter.type || 'lowpass';
        f.frequency.value = opts.filter.freq;
        osc.connect(f); node = f;
      }
      node.connect(g); g.connect(master);
      osc.start(t); osc.stop(t + dur + 0.05);
    }

    function noise(dur, opts) {
      opts = opts || {};
      const c = ensure(); if (!c) return;
      const t = c.currentTime + (opts.delay || 0);
      const len = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = opts.type || 'bandpass';
      f.frequency.setValueAtTime(opts.freq || 2000, t);
      if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
      f.Q.value = opts.q || 1;
      const g = c.createGain();
      g.gain.value = opts.vol == null ? 0.3 : opts.vol;
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t);
    }

    const fx = {
      dot() {
        tone(1300, 0.045, { type: 'triangle', vol: 0.12 });
      },
      star() {
        tone(1046.5, 0.32, { vol: 0.16 });
        tone(1568, 0.38, { vol: 0.12, delay: 0.05 });
        tone(2093, 0.5, { vol: 0.05, delay: 0.1 });
        noise(0.18, { type: 'highpass', freq: 6000, vol: 0.05, delay: 0.04 });
      },
      clash() {
        tone(1046.5, 0.25, { vol: 0.12 });
        tone(1108.7, 0.3, { vol: 0.1, delay: 0.03 });
        tone(220, 0.2, { type: 'triangle', vol: 0.12, delay: 0.05 });
      },
      erase() {
        tone(700, 0.08, { vol: 0.1, to: 380 });
      },
      lock() {
        noise(0.025, { type: 'highpass', freq: 3000, vol: 0.4 });
        tone(170, 0.09, { type: 'square', vol: 0.06, filter: { freq: 900 } });
        noise(0.03, { type: 'bandpass', freq: 1800, q: 3, vol: 0.5, delay: 0.06 });
        tone(110, 0.12, { type: 'square', vol: 0.06, delay: 0.06, filter: { freq: 600 } });
      },
      unlock() {
        noise(0.03, { type: 'bandpass', freq: 2400, q: 3, vol: 0.4 });
        tone(260, 0.07, { type: 'square', vol: 0.05, filter: { freq: 1200 } });
        noise(0.02, { type: 'highpass', freq: 4000, vol: 0.3, delay: 0.05 });
        tone(420, 0.06, { vol: 0.07, delay: 0.05 });
      },
      denied() {
        tone(150, 0.16, { type: 'sawtooth', vol: 0.08, filter: { freq: 700 } });
        tone(140, 0.16, { type: 'sawtooth', vol: 0.06, delay: 0.09, filter: { freq: 600 } });
      },
      undo() {
        tone(500, 0.1, { vol: 0.1, to: 320 });
        noise(0.08, { type: 'bandpass', freq: 1500, to: 600, vol: 0.12 });
      },
      fresh() {
        noise(0.45, { type: 'bandpass', freq: 400, to: 4000, q: 0.8, vol: 0.18 });
        tone(523.25, 0.4, { vol: 0.06, delay: 0.25 });
      },
      win() {
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
        notes.forEach((f, i) => {
          tone(f, 0.6, { vol: 0.13, delay: i * 0.085 });
          tone(f * 2, 0.4, { vol: 0.03, delay: i * 0.085 + 0.02 });
        });
        noise(1.2, { type: 'highpass', freq: 7000, vol: 0.05, delay: 0.4 });
        [1046.5, 1318.5, 1568, 2093].forEach((f) => tone(f, 1.4, { vol: 0.05, delay: 0.55, attack: 0.05 }));
      }
    };

    return {
      play(name) { if (enabled && fx[name]) try { fx[name](); } catch (e) { /* ignore */ } },
      get enabled() { return enabled; },
      toggle() { enabled = !enabled; save('sb-sound', enabled); if (enabled) fx.dot(); return enabled; }
    };
  })();

  /* ================= game state ================= */
  let G = null;           // { n, k, regions, solution, cells, rowLock, colLock, elapsed, solved }
  let history = [];
  let cellSize = 52;
  let timerStart = 0;
  let timerId = null;

  function blankGrid(n, v) { return Array.from({ length: n }, () => new Array(n).fill(v)); }

  function newGame(n, k) {
    statusEl.textContent = 'generating…';
    statusEl.className = 'status';
    setTimeout(() => {
      const p = StarGen.generate(n, k, { timeLimit: 3000 });
      G = {
        n, k,
        regions: p.regions,
        solution: p.solution,
        cells: blankGrid(n, EMPTY),
        rowLock: new Array(n).fill(false),
        colLock: new Array(n).fill(false),
        elapsed: 0,
        solved: false
      };
      history = [];
      statusEl.textContent = '';
      buildBoard();
      startTimer();
      persist();
      Sound.play('fresh');
    }, 20);
  }

  function persist() { if (G) save('sb-game', Object.assign({}, G, { elapsed: currentElapsed() })); }

  function snapshot() {
    return {
      cells: G.cells.map((r) => r.slice()),
      rowLock: G.rowLock.slice(),
      colLock: G.colLock.slice()
    };
  }
  function pushHistory() {
    history.push(snapshot());
    if (history.length > 300) history.shift();
    $('undoBtn').disabled = false;
  }

  /* ================= timer ================= */
  function currentElapsed() {
    if (!G) return 0;
    return G.solved ? G.elapsed : G.elapsed + (timerStart ? Date.now() - timerStart : 0);
  }
  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function startTimer() {
    clearInterval(timerId);
    timerStart = G.solved ? 0 : Date.now();
    timerEl.textContent = fmt(currentElapsed());
    if (G.solved) return;
    timerId = setInterval(() => { timerEl.textContent = fmt(currentElapsed()); }, 500);
  }
  function stopTimer() {
    G.elapsed = currentElapsed();
    timerStart = 0;
    clearInterval(timerId);
    timerEl.textContent = fmt(G.elapsed);
  }

  /* ================= layout ================= */
  function computeCellSize() {
    const lockw = 34, gap = 6;
    const avail = Math.min(window.innerWidth - 32 - lockw - gap, 560);
    const availH = window.innerHeight - 260;
    const fit = Math.floor(Math.min(avail, Math.max(availH, 260)) / G.n);
    return Math.max(28, Math.min(56, fit));
  }

  function buildBoard() {
    const { n } = G;
    cellSize = computeCellSize();
    document.documentElement.style.setProperty('--cell', cellSize + 'px');
    boardEl.style.setProperty('--n', n);
    boardEl.classList.remove('solved');
    sizeSel.value = n + '-' + G.k;

    // cells
    cellsEl.innerHTML = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const b = document.createElement('button');
        b.className = 'cell';
        b.dataset.r = r; b.dataset.c = c;
        b.setAttribute('role', 'gridcell');
        b.tabIndex = r === 0 && c === 0 ? 0 : -1;
        cellsEl.appendChild(b);
      }
    }

    // locks
    colLocksEl.innerHTML = '';
    rowLocksEl.innerHTML = '';
    for (let i = 0; i < n; i++) {
      colLocksEl.appendChild(makeLock('col', i));
      rowLocksEl.appendChild(makeLock('row', i));
    }

    drawLines();
    render();
    $('undoBtn').disabled = history.length === 0;
  }

  function makeLock(kind, i) {
    const b = document.createElement('button');
    b.className = 'lock';
    b.dataset.kind = kind;
    b.dataset.i = i;
    b.addEventListener('click', () => toggleLock(kind, i, b));
    return b;
  }

  function drawLines() {
    const { n, regions } = G;
    const s = cellSize, size = n * s;
    linesEl.setAttribute('viewBox', `0 0 ${size} ${size}`);
    linesEl.innerHTML = '';
    const add = (x1, y1, x2, y2, cls) => {
      const l = document.createElementNS(SVGNS, 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1);
      l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      l.setAttribute('class', cls);
      return l;
    };
    const thin = [], thick = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (c < n - 1) {
          const l = add((c + 1) * s, r * s, (c + 1) * s, (r + 1) * s,
            regions[r][c] !== regions[r][c + 1] ? 'region-line' : 'grid-line');
          (l.getAttribute('class') === 'region-line' ? thick : thin).push(l);
        }
        if (r < n - 1) {
          const l = add(c * s, (r + 1) * s, (c + 1) * s, (r + 1) * s,
            regions[r][c] !== regions[r + 1][c] ? 'region-line' : 'grid-line');
          (l.getAttribute('class') === 'region-line' ? thick : thin).push(l);
        }
      }
    }
    thin.forEach((l) => linesEl.appendChild(l));
    thick.forEach((l) => linesEl.appendChild(l));
    const frame = document.createElementNS(SVGNS, 'rect');
    frame.setAttribute('x', 1.5); frame.setAttribute('y', 1.5);
    frame.setAttribute('width', size - 3); frame.setAttribute('height', size - 3);
    frame.setAttribute('rx', 5);
    frame.setAttribute('class', 'frame');
    linesEl.appendChild(frame);
  }

  /* ================= rules ================= */
  function analyse() {
    const { n, k, cells, regions } = G;
    const rowC = new Array(n).fill(0), colC = new Array(n).fill(0), regC = new Array(n).fill(0);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (cells[r][c] === STAR) { rowC[r]++; colC[c]++; regC[regions[r][c]]++; }
    }
    const bad = blankGrid(n, false);
    let anyBad = false;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (cells[r][c] !== STAR) continue;
      let b = rowC[r] > k || colC[c] > k || regC[regions[r][c]] > k;
      for (let dr = -1; dr <= 1 && !b; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const y = r + dr, x = c + dc;
        if (y >= 0 && y < n && x >= 0 && x < n && cells[y][x] === STAR) { b = true; break; }
      }
      bad[r][c] = b;
      if (b) anyBad = true;
    }
    const complete = !anyBad &&
      rowC.every((v) => v === k) && colC.every((v) => v === k) && regC.every((v) => v === k);
    return { bad, complete };
  }

  function isLocked(r, c) { return G.solved || G.rowLock[r] || G.colLock[c]; }

  /* ================= rendering ================= */
  function render() {
    const { n, cells } = G;
    const { bad } = analyse();
    const els = cellsEl.children;
    let starIdx = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const el = els[r * n + c];
      const v = cells[r][c];
      if (el._v !== v) {
        el.innerHTML = v === STAR ? ICONS.star : v === DOT ? '<span class="dot"></span>' : '';
        el._v = v;
      }
      el.classList.toggle('bad', !!bad[r][c]);
      el.classList.toggle('locked', !G.solved && (G.rowLock[r] || G.colLock[c]));
      el.setAttribute('aria-label',
        `row ${r + 1}, column ${c + 1}, ${v === STAR ? 'star' : v === DOT ? 'dot' : 'empty'}` +
        (G.rowLock[r] || G.colLock[c] ? ', locked' : ''));
      if (v === STAR) el.style.setProperty('--d', (starIdx++ * 0.06) + 's');
    }
    [...colLocksEl.children].forEach((b, i) => renderLock(b, G.colLock[i], 'column', i));
    [...rowLocksEl.children].forEach((b, i) => renderLock(b, G.rowLock[i], 'row', i));
    renderBands();
  }

  function renderLock(b, on, label, i) {
    if (b._on !== on) {
      b.innerHTML = on ? ICONS.lockShut : ICONS.lockOpen;
      b._on = on;
    }
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
    b.setAttribute('aria-label', (on ? 'Unlock ' : 'Lock ') + label + ' ' + (i + 1));
  }

  // Red rounded band over each whole locked line.
  function renderBands() {
    const { n } = G;
    const s = cellSize, inset = 3;
    const want = [];
    const len = n * s - inset * 2;
    for (let r = 0; r < n; r++) if (G.rowLock[r]) {
      want.push({ key: 'r' + r, x: inset, y: r * s + inset, w: len, h: s - inset * 2 });
    }
    for (let c = 0; c < n; c++) if (G.colLock[c]) {
      want.push({ key: 'c' + c, x: c * s + inset, y: inset, w: s - inset * 2, h: len });
    }
    // keep existing bands so they don't re-animate
    const existing = new Map([...bandsEl.children].map((el) => [el.dataset.key, el]));
    const keep = new Set();
    for (const b of want) {
      keep.add(b.key);
      let el = existing.get(b.key);
      if (!el) {
        el = document.createElement('div');
        el.className = 'band';
        el.dataset.key = b.key;
        bandsEl.appendChild(el);
      }
      Object.assign(el.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
    }
    existing.forEach((el, key) => { if (!keep.has(key)) el.remove(); });
  }

  function afterChange() {
    const { complete } = analyse();
    render();
    if (complete && !G.solved) win();
    persist();
  }

  function win() {
    G.solved = true;
    stopTimer();
    // stars twinkle in order
    [...cellsEl.children].forEach((el) => el.classList.remove('locked'));
    boardEl.classList.add('solved');
    statusEl.textContent = `solved in ${fmt(G.elapsed)} ✦`;
    statusEl.className = 'status win';
    Sound.play('win');
    persist();
  }

  /* ================= actions ================= */
  function setCell(r, c, v) {
    if (G.cells[r][c] === v) return false;
    G.cells[r][c] = v;
    return true;
  }

  function denied(r, c) {
    const el = cellsEl.children[r * G.n + c];
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    if (!G.solved) Sound.play('denied');
  }

  function soundFor(r, c, v) {
    if (v === STAR) Sound.play(analyse().bad[r][c] ? 'clash' : 'star');
    else if (v === DOT) Sound.play('dot');
    else Sound.play('erase');
  }

  function toggleLock(kind, i, btn) {
    if (!G || G.solved) return;
    pushHistory();
    const arr = kind === 'row' ? G.rowLock : G.colLock;
    arr[i] = !arr[i];
    Sound.play(arr[i] ? 'lock' : 'unlock');
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
    afterChange();
  }

  function undo() {
    if (!history.length || !G || G.solved) return;
    const s = history.pop();
    G.cells = s.cells; G.rowLock = s.rowLock; G.colLock = s.colLock;
    Sound.play('undo');
    $('undoBtn').disabled = history.length === 0;
    afterChange();
  }

  function reset() {
    if (!G) return;
    const empty = G.cells.every((row) => row.every((v) => v === EMPTY)) &&
      !G.rowLock.some(Boolean) && !G.colLock.some(Boolean);
    if (empty && !G.solved) return;
    if (!G.solved) pushHistory();
    G.cells = blankGrid(G.n, EMPTY);
    G.rowLock.fill(false); G.colLock.fill(false);
    if (G.solved) { G.solved = false; G.elapsed = 0; history = []; boardEl.classList.remove('solved'); startTimer(); }
    statusEl.textContent = ''; statusEl.className = 'status';
    Sound.play('undo');
    afterChange();
  }

  /* ================= pointer input ================= */
  function cellFromEvent(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest ? el.closest('.cell') : null;
    if (!cell || !cellsEl.contains(cell)) return null;
    return [+cell.dataset.r, +cell.dataset.c];
  }

  cellsEl.addEventListener('pointerdown', (e) => {
    if (!G || e.button !== 0) return;
    const pos = cellFromEvent(e);
    if (!pos) return;
    e.preventDefault();
    const [r, c] = pos;
    cellsEl.children[r * G.n + c].focus({ preventScroll: true });
    if (isLocked(r, c)) { denied(r, c); return; }
    const next = G.cells[r][c] === STAR ? EMPTY : STAR;
    pushHistory();
    setCell(r, c, next);
    soundFor(r, c, next);
    afterChange();
  });
  boardEl.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ================= keyboard ================= */
  cellsEl.addEventListener('keydown', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || !G) return;
    let r = +cell.dataset.r, c = +cell.dataset.c;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[e.key]) {
      e.preventDefault();
      r = Math.max(0, Math.min(G.n - 1, r + moves[e.key][0]));
      c = Math.max(0, Math.min(G.n - 1, c + moves[e.key][1]));
      cell.tabIndex = -1;
      const next = cellsEl.children[r * G.n + c];
      next.tabIndex = 0; next.focus();
      return;
    }
    const map = { Enter: 'cycle', ' ': 'cycle', s: STAR, '*': STAR, Backspace: EMPTY, Delete: EMPTY };
    if (!(e.key in map)) return;
    e.preventDefault();
    if (isLocked(r, c)) { denied(r, c); return; }
    const next = map[e.key] === 'cycle' ? (G.cells[r][c] === STAR ? EMPTY : STAR) : map[e.key];
    if (G.cells[r][c] === next) return;
    pushHistory();
    setCell(r, c, next);
    soundFor(r, c, next);
    afterChange();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  });

  /* ================= chrome ================= */
  function isDark() {
    const t = document.documentElement.dataset.theme;
    if (t) return t === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function renderChrome() {
    $('themeBtn').innerHTML = isDark() ? ICONS.sun : ICONS.moon;
    $('soundBtn').innerHTML = Sound.enabled ? ICONS.soundOn : ICONS.soundOff;
  }

  $('themeBtn').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('sb-theme', next); } catch (e) { /* ignore */ }
    Sound.play('dot');
    renderChrome();
  });
  $('soundBtn').addEventListener('click', () => { Sound.toggle(); renderChrome(); });
  $('helpBtn').addEventListener('click', () => $('help').showModal());
  $('undoBtn').addEventListener('click', undo);
  $('resetBtn').addEventListener('click', reset);
  $('newBtn').addEventListener('click', () => {
    const [n, k] = sizeSel.value.split('-').map(Number);
    newGame(n, k);
  });
  sizeSel.addEventListener('change', () => {
    const [n, k] = sizeSel.value.split('-').map(Number);
    newGame(n, k);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderChrome);

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!G) return;
      const s = computeCellSize();
      if (s !== cellSize) {
        cellSize = s;
        document.documentElement.style.setProperty('--cell', s + 'px');
        drawLines();
        renderBands();
      }
    }, 100);
  });
  window.addEventListener('beforeunload', persist);
  document.addEventListener('visibilitychange', persist);

  /* ================= boot ================= */
  renderChrome();
  const saved = load('sb-game', null);
  if (saved && saved.regions && saved.cells && saved.n === saved.cells.length) {
    G = saved;
    G.cells = G.cells.map((row) => row.map((v) => (v === STAR ? STAR : EMPTY)));
    buildBoard();
    startTimer();
    if (G.solved) {
      boardEl.classList.add('solved');
      statusEl.textContent = `solved in ${fmt(G.elapsed)} ✦`;
      statusEl.className = 'status win';
    }
  } else {
    newGame(8, 1);
  }
})();
