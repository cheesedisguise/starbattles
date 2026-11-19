/* Star Battle puzzle generator and solver.
 * Builds a random valid star layout, grows regions around it, then
 * reshapes regions until the puzzle has exactly one solution. */
(function (global) {
  'use strict';

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function popcount(x) {
    let c = 0;
    while (x) { x &= x - 1; c++; }
    return c;
  }

  // All row masks with exactly k stars and no two side by side.
  function rowCombos(n, k) {
    const out = [];
    for (let m = 0; m < (1 << n); m++) {
      if (popcount(m) === k && (m & (m << 1)) === 0) out.push(m);
    }
    return out;
  }

  /* Count solutions (stops at `limit`). Returns { count, solutions }
   * where each solution is an array of row masks. */
  function solve(regions, n, k, limit) {
    limit = limit || 2;
    const combos = rowCombos(n, k);
    const lastRow = new Array(n).fill(-1);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) lastRow[regions[r][c]] = r;

    const regCount = new Array(n).fill(0);
    const colCount = new Array(n).fill(0);
    const rows = new Array(n);
    const solutions = [];

    function rec(r, prev) {
      if (solutions.length >= limit) return;
      if (r === n) { solutions.push(rows.slice()); return; }
      const blocked = prev | (prev << 1) | (prev >> 1);
      const remainingAfter = n - r - 1;
      for (let i = 0; i < combos.length; i++) {
        const m = combos[i];
        if (m & blocked) continue;
        let ok = true;
        // column and region capacity
        for (let c = 0; c < n && ok; c++) {
          if (m & (1 << c)) {
            if (colCount[c] >= k) ok = false;
            else if (regCount[regions[r][c]] >= k) ok = false;
          }
        }
        if (!ok) continue;
        // a region can hold at most k; count new stars per region
        for (let c = 0; c < n; c++) if (m & (1 << c)) { colCount[c]++; regCount[regions[r][c]]++; }
        let feasible = true;
        for (let c = 0; c < n && feasible; c++) {
          if (regCount[regions[r][c]] > k) feasible = false;
        }
        if (feasible) {
          for (let g = 0; g < n && feasible; g++) {
            if (lastRow[g] <= r && regCount[g] < k) feasible = false;
          }
          for (let c = 0; c < n && feasible; c++) {
            // stars in one column can't sit in neighbouring rows
            const need = k - colCount[c];
            const room = (m & (1 << c)) ? Math.ceil((remainingAfter - 1) / 2) : Math.ceil(remainingAfter / 2);
            if (need > Math.max(0, room)) feasible = false;
          }
        }
        if (feasible) { rows[r] = m; rec(r + 1, m); }
        for (let c = 0; c < n; c++) if (m & (1 << c)) { colCount[c]--; regCount[regions[r][c]]--; }
        if (solutions.length >= limit) return;
      }
    }
    rec(0, 0);
    return { count: solutions.length, solutions };
  }

  // Random valid star layout (k per row/column, none touching).
  function randomLayout(n, k) {
    const combos = rowCombos(n, k);
    const colCount = new Array(n).fill(0);
    const rows = new Array(n);
    let steps = 0;
    function rec(r, prev) {
      if (++steps > 200000) return false;
      if (r === n) return true;
      const blocked = prev | (prev << 1) | (prev >> 1);
      const remainingAfter = n - r - 1;
      const order = shuffle(combos.slice());
      for (const m of order) {
        if (m & blocked) continue;
        let ok = true;
        for (let c = 0; c < n; c++) if ((m & (1 << c)) && colCount[c] >= k) { ok = false; break; }
        if (!ok) continue;
        for (let c = 0; c < n; c++) if (m & (1 << c)) colCount[c]++;
        let feasible = true;
        for (let c = 0; c < n; c++) if (k - colCount[c] > Math.ceil(remainingAfter / 2)) { feasible = false; break; }
        if (feasible) { rows[r] = m; if (rec(r + 1, m)) return true; }
        for (let c = 0; c < n; c++) if (m & (1 << c)) colCount[c]--;
      }
      return false;
    }
    return rec(0, 0) ? rows : null;
  }

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // Grow one seed region per star, randomly, until the grid is full.
  function growRegions(n, seeds) {
    const reg = Array.from({ length: n }, () => new Array(n).fill(-1));
    const frontier = [];
    seeds.forEach(([r, c], i) => { reg[r][c] = i; frontier.push([r, c]); });
    let filled = seeds.length;
    while (filled < n * n) {
      const idx = (Math.random() * frontier.length) | 0;
      const [r, c] = frontier[idx];
      const free = DIRS.map(([dr, dc]) => [r + dr, c + dc])
        .filter(([y, x]) => y >= 0 && y < n && x >= 0 && x < n && reg[y][x] === -1);
      if (!free.length) { frontier.splice(idx, 1); continue; }
      const [y, x] = free[(Math.random() * free.length) | 0];
      reg[y][x] = reg[r][c];
      frontier.push([y, x]);
      filled++;
    }
    return reg;
  }

  // For 2-star puzzles: merge 2n mini regions into n pairs of neighbours.
  function pairRegions(n, mini) {
    const m = 2 * n;
    const adj = Array.from({ length: m }, () => new Set());
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      for (const [dr, dc] of [[1, 0], [0, 1]]) {
        const y = r + dr, x = c + dc;
        if (y < n && x < n && mini[y][x] !== mini[r][c]) {
          adj[mini[r][c]].add(mini[y][x]);
          adj[mini[y][x]].add(mini[r][c]);
        }
      }
    }
    for (let attempt = 0; attempt < 300; attempt++) {
      const match = new Array(m).fill(-1);
      let ok = true;
      for (let step = 0; step < n; step++) {
        // pick the unmatched region with fewest unmatched neighbours
        let best = -1, bestDeg = Infinity;
        for (let i = 0; i < m; i++) {
          if (match[i] !== -1) continue;
          let d = 0;
          adj[i].forEach((j) => { if (match[j] === -1) d++; });
          d += Math.random() * 0.9;
          if (d < bestDeg) { bestDeg = d; best = i; }
        }
        const opts = [...adj[best]].filter((j) => match[j] === -1);
        if (!opts.length) { ok = false; break; }
        const j = opts[(Math.random() * opts.length) | 0];
        match[best] = j; match[j] = best;
      }
      if (!ok) continue;
      const id = new Array(m).fill(-1);
      let next = 0;
      for (let i = 0; i < m; i++) if (id[i] === -1) { id[i] = id[match[i]] = next++; }
      return mini.map((row) => row.map((v) => id[v]));
    }
    return null;
  }

  function connectedWithout(reg, n, g, skipR, skipC) {
    let start = null, total = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (reg[r][c] === g && !(r === skipR && c === skipC)) { total++; if (!start) start = [r, c]; }
    }
    if (!start) return false;
    const seen = new Set([start[0] * n + start[1]]);
    const stack = [start];
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [dr, dc] of DIRS) {
        const y = r + dr, x = c + dc;
        if (y < 0 || y >= n || x < 0 || x >= n) continue;
        if (y === skipR && x === skipC) continue;
        if (reg[y][x] !== g || seen.has(y * n + x)) continue;
        seen.add(y * n + x);
        stack.push([y, x]);
      }
    }
    return seen.size === total;
  }

  // Move a non-star cell to a neighbouring region if that keeps things valid.
  function tryMove(reg, n, isStar, r, c) {
    if (isStar[r][c]) return false;
    const g = reg[r][c];
    const targets = shuffle(DIRS.map(([dr, dc]) => [r + dr, c + dc])
      .filter(([y, x]) => y >= 0 && y < n && x >= 0 && x < n && reg[y][x] !== g)
      .map(([y, x]) => reg[y][x]));
    if (!targets.length) return false;
    if (!connectedWithout(reg, n, g, r, c)) return false;
    reg[r][c] = targets[0];
    return true;
  }

  function generate(n, k, opts) {
    opts = opts || {};
    const deadline = Date.now() + (opts.timeLimit || 4000);
    let fallback = null;
    while (true) {
      const rows = randomLayout(n, k);
      if (!rows) continue;
      const stars = [];
      const isStar = Array.from({ length: n }, () => new Array(n).fill(false));
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (rows[r] & (1 << c)) { stars.push([r, c]); isStar[r][c] = true; }
      }
      let reg;
      if (k === 1) reg = growRegions(n, stars);
      else {
        reg = pairRegions(n, growRegions(n, stars));
        if (!reg) continue;
      }
      if (!fallback) fallback = { regions: reg.map((x) => x.slice()), solution: rows.slice(), unique: false };

      for (let iter = 0; iter < 400; iter++) {
        const res = solve(reg, n, k, 2);
        if (res.count === 1) return { regions: reg, solution: rows, unique: true };
        const alt = res.solutions.find((s) => s.some((m, i) => m !== rows[i]));
        // cells that are stars only in the alternative solution
        const cand = [];
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
          if ((alt[r] & (1 << c)) && !isStar[r][c]) cand.push([r, c]);
        }
        shuffle(cand);
        let moved = false;
        for (const [r, c] of cand) if (tryMove(reg, n, isStar, r, c)) { moved = true; break; }
        if (!moved) {
          for (let t = 0; t < 30 && !moved; t++) {
            moved = tryMove(reg, n, isStar, (Math.random() * n) | 0, (Math.random() * n) | 0);
          }
        }
        if (Date.now() > deadline) return fallback;
      }
      if (Date.now() > deadline) return fallback;
    }
  }

  const api = { generate, solve, rowCombos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.StarGen = api;
})(typeof self !== 'undefined' ? self : this);
