(function () {
  const CFG = Object.assign(
    { apiUrl: '', title: 'Daily Games', minPlaysForAverage: 3, placementPoints: [3, 2, 1], minForUsual: 4, hotStreakWins: 3, minForStartRank: 8, minForRival: 5, playerTimezones: {} },
    window.LEADERBOARD_CONFIG || {}
  );
  const API = (CFG.apiUrl || '').trim();
  const DEMO = !API;
  const DEMO_KEY = 'lb_demo_rows';
  const NAME_KEY = 'lb_name';
  const CACHE_KEY = 'lb_rows_cache';
  const UNDO_WINDOW_MS = 24 * 3600 * 1000; // must match the backend

  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const localDate = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  };
  const addDays = (iso, n) =>
    new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  // This browser's IANA time zone, e.g. "America/New_York" ('' if it can't tell).
  const myTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } };
  // Calendar day (YYYY-MM-DD) of a timestamp in a given time zone, or null if the zone is unknown/invalid.
  const dayFormats = {};
  function dayIn(ts, tz) {
    if (!tz) return null;
    try {
      const f = dayFormats[tz] || (dayFormats[tz] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }));
      return f.format(new Date(ts));
    } catch (e) { return null; }
  }
  const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  let rows = []; // raw submissions: {ts, player, text}
  let loaded = false; // false until the first load() finishes: the board shows a skeleton instead of "no results"
  let entries = []; // parsed + de-duplicated results
  let displayName = {}; // normalized name -> name as first written
  const state = { tab: 'overall', range: 'all', mode: 'points', day: null, profile: null, h2h: '', wrGame: 'all', week: null, histDay: null, calMode: 'count', ptab: 'overview' };
  let puzzleBest = {}; // game|puzzle -> best value (for games scored relative to the day's best)
  let winRun = {}; // player|game -> { n: current run of consecutive wins, date: date of their latest result }
  let dateIdx = {}; // player -> (gameId | '*') -> Set of dates played, for streaks
  let winRunBest = {}; // player|game -> { n: longest run of consecutive wins, date: when it peaked }
  let ratings = {}; // player -> { r: current Elo rating, n: matches, peak, peakDate, hist: [{date, r}] }
  let puzzleDiff = {}; // game|puzzle -> { avg, n, z, tag: 'hard' | 'easy' | null } (2+ players)
  let upsets = []; // { e: winning entry, loser: entry, gap: rating difference before the puzzle }

  // ---------- identity ----------
  function getName() { return store.get(NAME_KEY) || ''; }
  function setName(n) {
    n = String(n || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    if (!n) return;
    store.set(NAME_KEY, n);
    $('#me-name').textContent = n;
  }
  function askName() {
    const dl = $('#known-players');
    dl.innerHTML = Object.values(displayName).map((n) => `<option value="${esc(n)}">`).join('');
    $('#name-input').value = getName();
    const d = $('#name-dialog');
    if (d.showModal) d.showModal();
    else { const n = prompt('Your name?'); if (n) setName(n); }
  }

  // ---------- data ----------
  async function load() {
    if (DEMO) {
      rows = JSON.parse(store.get(DEMO_KEY) || '[]');
    } else {
      try {
        const r = await fetch(API + (API.includes('?') ? '&' : '?') + 't=' + Date.now());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        rows = j.rows || [];
        store.set(CACHE_KEY, JSON.stringify(rows));
        $('#offline-banner').hidden = true;
      } catch (e) {
        // Offline or the backend is down: show the last results we saw.
        const cached = store.get(CACHE_KEY);
        if (!cached) throw e;
        rows = JSON.parse(cached);
        $('#offline-banner').hidden = false;
      }
    }
    loaded = true;
    rebuild();
    render();
  }

  // Grey placeholder rows shown while results load (same markup as the one in index.html).
  const skeletonHtml = () => `<div class="skel" role="status" aria-label="Loading results"><div class="skel-table">${
    [70, 55, 62, 48, 58].map((w) => `<div class="skel-row"><i class="sk-rank"></i><i class="sk-name" style="width:${w}%"></i><i class="sk-num"></i><i class="sk-num"></i></div>`).join('')
  }</div></div>`;

  function rebuild() {
    const seen = new Map();
    displayName = {};
    const sorted = [...rows].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    for (const row of sorted) {
      const p = normName(row.player);
      if (!p) continue;
      if (!displayName[p]) displayName[p] = String(row.player).trim().replace(/\s+/g, ' ');
      for (const r of parseShareText(row.text).results) {
        const g = GAME_BY_ID[r.game];
        // Day the puzzle belongs to (same worldwide) vs the day the player submitted it in their own zone.
        // A result counts for the earlier of the two: someone in the US can get tomorrow's puzzle in their
        // evening, and that evening is the day they played. Late backfills still count for the puzzle's day.
        const puzzleDate = r.puzzle != null && g.date ? g.date(r.puzzle) : null;
        const playedDate = dayIn(row.ts, row.tz || (CFG.playerTimezones || {})[p]);
        const date = puzzleDate ? (playedDate && playedDate < puzzleDate ? playedDate : puzzleDate) : playedDate || localDate(row.ts);
        const puzzle = r.puzzle != null ? r.puzzle : date;
        const key = `${p}|${g.id}|${puzzle}`;
        if (seen.has(key)) continue; // first submission for a puzzle counts
        seen.set(key, { player: p, game: g.id, puzzle, date, puzzleDate: puzzleDate || date, moved: !!puzzleDate && date !== puzzleDate, value: r.value, par: r.par, display: r.display, detail: r.detail, ts: row.ts, tz: row.tz || (CFG.playerTimezones || {})[p] || '' });
      }
    }
    entries = [...seen.values()];
    puzzleBest = {};
    dateIdx = {};
    for (const e of entries) {
      const g = GAME_BY_ID[e.game], k = e.game + '|' + e.puzzle;
      if (g.relative && (puzzleBest[k] === undefined || (g.better === 'higher' ? e.value > puzzleBest[k] : e.value < puzzleBest[k]))) puzzleBest[k] = e.value;
      const m = (dateIdx[e.player] = dateIdx[e.player] || {});
      for (const k of [e.game, '*']) (m[k] = m[k] || new Set()).add(e.date);
    }

    // Who won each puzzle (outright or tied 1st, with 2+ players) and who finished last (3+ players).
    for (const list of groupBy(entries, (e) => e.game + '|' + e.puzzle).values()) {
      const ranked = rankPuzzle(list, GAME_BY_ID[list[0].game]);
      const lastRank = Math.max(...ranked.map((r) => r.rank));
      for (const r of ranked) {
        const e = list.find((x) => x.player === r.player);
        e.won = r.rank === 1 && list.length > 1;
        e.solo = list.length === 1; // nobody to beat (yet): doesn't count for or against a win run
        e.last = list.length >= 3 && r.rank === lastRank && r.rank > 1;
      }
    }

    // First-guess luck: rank each opening guess against every opening ever shared for that game.
    const pools = {};
    for (const e of entries) {
      const g = GAME_BY_ID[e.game];
      const q = g.firstGuess && e.detail ? g.firstGuess(e.detail) : null;
      if (q != null) { e.q = q; (pools[e.game] = pools[e.game] || []).push(q); }
    }
    for (const e of entries) {
      const pool = pools[e.game];
      if (e.q == null || pool.length < CFG.minForStartRank) continue;
      const below = pool.filter((v) => v < e.q - 1e-9).length, same = pool.filter((v) => Math.abs(v - e.q) <= 1e-9).length;
      e.start = { pct: Math.round((100 * (below + same / 2)) / pool.length), n: pool.length }; // 100 = best opening so far
    }

    // Per player and game, in puzzle order: each result vs the player's own earlier results ("usual"),
    // and the current run of consecutive wins.
    winRun = {};
    winRunBest = {};
    const mean = (a) => a.reduce((t, v) => t + v, 0) / a.length;
    for (const list of groupBy(entries, (e) => e.player + '|' + e.game).values()) {
      list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.puzzle < b.puzzle ? -1 : a.puzzle > b.puzzle ? 1 : 0));
      const g = GAME_BY_ID[list[0].game];
      const prev = [];
      let run = 0;
      for (const e of list) {
        const n = norm(e, g);
        if (prev.length >= CFG.minForUsual) {
          const recent = prev.slice(-30), m = mean(recent);
          const sd = Math.sqrt(mean(recent.map((v) => (v - m) ** 2)));
          e.vs = { diff: (n - m) * 100, usual: m * 100, z: (n - m) / Math.max(sd, 0.1) }; // sd floor: 10 points
        }
        prev.push(n);
        e.runBefore = run;
        if (!e.solo) run = e.won ? run + 1 : 0;
        e.runAfter = run;
        const key = e.player + '|' + e.game;
        if (run > 0 && (!winRunBest[key] || run > winRunBest[key].n)) winRunBest[key] = { n: run, date: e.date, player: e.player, game: e.game };
      }
      winRun[list[0].player + '|' + list[0].game] = { n: run, date: list[list.length - 1].date };
    }
    computeRatings();
    computeDifficulty();
  }

  // Elo rating (start 1000, K = 32). Every puzzle that 2+ friends did is a match: each pair in it is a
  // head-to-head game (win 1, tie ½, loss 0), averaged so a 5-player puzzle moves you as much as a 2-player one.
  // Beating someone rated higher earns more than beating someone rated lower.
  const ELO_START = 1000, ELO_K = 32;
  function computeRatings() {
    ratings = {};
    upsets = [];
    const R = (p) => (ratings[p] = ratings[p] || { r: ELO_START, n: 0, peak: ELO_START, peakDate: null, hist: [] });
    const lastTs = (l) => l.reduce((m, e) => (e.ts > m ? e.ts : m), '');
    const lastDate = (l) => l.reduce((m, e) => (e.date > m ? e.date : m), '');
    const matches = [...groupBy(entries, (e) => e.game + '|' + e.puzzle).values()]
      .filter((l) => l.length > 1)
      .map((l) => ({ l, date: lastDate(l), ts: lastTs(l) }))
      .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    for (const { l, date } of matches) {
      const g = GAME_BY_ID[l[0].game];
      const before = new Map(l.map((e) => [e.player, R(e.player).r]));
      const score = (a, b) => { const d = g.better === 'higher' ? a.value - b.value : b.value - a.value; return d > 0 ? 1 : d < 0 ? 0 : 0.5; };
      for (const e of l) {
        let S = 0, E = 0;
        for (const o of l) {
          if (o === e) continue;
          const sc = score(e, o);
          S += sc;
          E += 1 / (1 + 10 ** ((before.get(o.player) - before.get(e.player)) / 400));
          if (sc === 1 && before.get(o.player) > before.get(e.player)) upsets.push({ e, loser: o, gap: before.get(o.player) - before.get(e.player) });
        }
        e.eloBefore = before.get(e.player);
        e.eloDelta = (ELO_K * (S - E)) / (l.length - 1);
      }
      for (const e of l) {
        const x = R(e.player);
        x.r += e.eloDelta;
        x.n++;
        if (x.r > x.peak) { x.peak = x.r; x.peakDate = date; }
        const h = x.hist;
        if (h.length && h[h.length - 1].date === date) h[h.length - 1].r = x.r; else h.push({ date, r: x.r });
      }
    }
  }
  // A player's rating at the end of a given day (ELO_START before their first match).
  const ratingOn = (p, date) => {
    const h = (ratings[p] || {}).hist || [];
    let v = ELO_START;
    for (const x of h) { if (x.date > date) break; v = x.r; }
    return v;
  };

  // Puzzle difficulty: the group's average result on a puzzle compared with that game's other puzzles.
  // z > 0 = harder than usual. Needs 2+ players on the puzzle and 4+ such puzzles in the game to tag it.
  function computeDifficulty() {
    puzzleDiff = {};
    const shared = [...groupBy(entries, (e) => e.game + '|' + e.puzzle).entries()].filter(([, l]) => l.length > 1);
    for (const [gid, list] of groupBy(shared, ([k]) => k.split('|')[0])) {
      const g = GAME_BY_ID[gid];
      const avgs = list.map(([k, l]) => [k, l.reduce((t, e) => t + e.value, 0) / l.length, l.length]);
      const m = avgs.reduce((t, a) => t + a[1], 0) / avgs.length;
      const sd = Math.sqrt(avgs.reduce((t, a) => t + (a[1] - m) ** 2, 0) / avgs.length);
      for (const [k, avg, n] of avgs) {
        const z = avgs.length >= 4 && sd > 0 ? (g.better === 'higher' ? m - avg : avg - m) / sd : 0;
        puzzleDiff[k] = { avg, n, z, tag: z >= 1 ? 'hard' : z <= -1 ? 'easy' : null };
      }
    }
  }
  const fmtAvg = (g, v) => (g.failValue && v >= g.failValue ? 'X' : g.formatValue(v));

  // Current hot streak (consecutive wins in one game) if it's long enough and recent, else 0.
  function hotFor(p, gameId) {
    const w = winRun[p + '|' + gameId];
    if (!w || w.n < CFG.hotStreakWins) return 0;
    return w.date >= addDays(localDate(new Date()), -7) ? w.n : 0;
  }
  const hotGames = (p) => GAMES.map((g) => [g, hotFor(p, g.id)]).filter(([, n]) => n > 0);

  // "Form": how a player's last 10 results compare with their own usual, as -100..+100.
  function formOf(p) {
    const list = entries.filter((e) => e.player === p && e.vs).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 10);
    if (list.length < 3) return null;
    const z = list.reduce((t, e) => t + Math.max(-2, Math.min(2, e.vs.z)), 0) / list.length;
    return { score: Math.round(z * 50), n: list.length, diff: list.reduce((t, e) => t + e.vs.diff, 0) / list.length };
  }

  // 0..1 score of one result for the Average board and trend charts (1 = perfect).
  function norm(e, g) {
    const best = g.relative ? puzzleBest[e.game + '|' + e.puzzle] : undefined;
    let v;
    if (best === undefined) v = g.normalize(e.value, e);
    else if (g.better === 'higher') v = e.value / Math.max(best, g.relative.floor); // best of the day = 100
    else v = Math.min(Math.max(best, g.relative.floor), g.relative.cap ?? Infinity) / e.value; // lower is better: fastest of the day = 100, but never benchmarked slower than `cap`
    return Math.max(0, Math.min(1, v));
  }

  // Streaks of consecutive days played (any game with gameId = null).
  // The current streak stays alive until the end of today, so it counts from yesterday if today isn't played yet.
  function streakInfo(player, gameId) {
    const set = (dateIdx[player] || {})[gameId || '*'];
    if (!set) return { cur: 0, best: 0 };
    const today = localDate(new Date());
    let d = set.has(today) ? today : addDays(today, -1);
    let cur = 0;
    while (set.has(d)) { cur++; d = addDays(d, -1); }
    let best = 0, run = 0, prev = null;
    for (const x of [...set].sort()) {
      run = prev && addDays(prev, 1) === x ? run + 1 : 1;
      best = Math.max(best, run);
      prev = x;
    }
    return { cur, best };
  }

  async function submit(text) {
    text = String(text || '').trim();
    if (!text) return toast('Nothing to submit — copy your result first.', true);
    const name = getName();
    if (!name) { askName(); return toast('Pick your name first, then submit again.', true); }

    const { results, unreadable } = parseShareText(text);
    if (!results.length) {
      return toast(
        unreadable.length
          ? `Couldn't read the score for ${unreadable.join(', ')}. Try “Paste manually” and send Kenny the text.`
          : "That doesn't look like a game result I know.",
        true
      );
    }
    const p = normName(name);
    const today = localDate(new Date());
    const fresh = [], dupes = [];
    for (const r of results) {
      const g = GAME_BY_ID[r.game];
      const puzzle = r.puzzle != null ? r.puzzle : today;
      const exists = entries.some((e) => e.player === p && e.game === r.game && e.puzzle === puzzle);
      (exists ? dupes : fresh).push(`${g.name} ${r.display}`);
    }
    if (!fresh.length) return toast(`Already counted: ${dupes.join(', ')}`, true);

    const row = { ts: new Date().toISOString(), player: name, text: text.slice(0, 2000), tz: myTimeZone() };
    setBusy(true);
    try {
      if (DEMO) {
        const all = JSON.parse(store.get(DEMO_KEY) || '[]');
        all.push(row);
        store.set(DEMO_KEY, JSON.stringify(all));
      } else {
        const r = await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids a CORS preflight
          body: JSON.stringify({ player: name, text: row.text, tz: row.tz }),
        });
        const j = await r.json().catch(() => ({}));
        if (j.ok === false) throw new Error(j.error || 'rejected');
      }
      // Reload so "1st so far" also counts results friends sent since this page was opened.
      // If that fails (offline), fall back to adding the new row locally.
      let mineTs = row.ts;
      if (!DEMO) {
        try { await load(); } catch (err) { /* handled below */ }
        const t0 = Date.parse(row.ts) - 5 * 60 * 1000; // allow for clock differences with the server
        const latest = rows.filter((x) => normName(x.player) === p && Date.parse(x.ts) >= t0).sort((a, b) => (a.ts < b.ts ? 1 : -1))[0];
        if (latest) mineTs = latest.ts;
        else { rows.push(row); rebuild(); render(); }
      } else {
        rows.push(row);
        rebuild();
        render();
      }
      let msg = '✅ Saved: ' + fresh.join(', ');
      // Tied or outright 1st among friends who've played it so far.
      const won = entries.filter((e) => e.player === p && e.ts === mineTs && e.won);
      if (won.length) {
        msg = `🥇 You're 1st in ${won.map((e) => GAME_BY_ID[e.game].name).join(', ')} so far! ` + msg;
        celebrate();
      }
      if (dupes.length) msg += ` (already had ${dupes.join(', ')})`;
      if (unreadable.length) msg += ` — couldn't read ${unreadable.join(', ')}`;
      toast(msg);
      $('#paste').value = '';
    } catch (e) {
      toast('Saving failed (' + e.message + '). Check your connection and try again.', true);
    } finally {
      setBusy(false);
    }
  }


  // ---------- undo ----------
  // Index into rows of this player's latest submission within the undo window, or -1.
  function myRecentIdx() {
    const me = normName(getName());
    if (!me) return -1;
    const cutoff = Date.now() - UNDO_WINDOW_MS;
    let best = -1;
    rows.forEach((r, i) => {
      if (normName(r.player) !== me || Date.parse(r.ts) < cutoff) return;
      if (best < 0 || r.ts >= rows[best].ts) best = i;
    });
    return best;
  }

  async function undoLast() {
    const name = getName();
    if (!name) return askName();
    if (!confirm('Remove your most recent submission?')) return;
    setBusy(true);
    try {
      let removed;
      if (DEMO) {
        const all = JSON.parse(store.get(DEMO_KEY) || '[]');
        const me = normName(name);
        let i = -1;
        all.forEach((r, k) => { if (normName(r.player) === me && (i < 0 || r.ts >= all[i].ts)) i = k; });
        if (i < 0) throw new Error('nothing to undo');
        removed = all.splice(i, 1)[0];
        store.set(DEMO_KEY, JSON.stringify(all));
      } else {
        const r = await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'undo', player: name }),
        });
        const j = await r.json().catch(() => ({}));
        if (!j.ok) throw new Error(j.error || 'the backend needs the latest Code.gs deployed');
        removed = j.removed;
      }
      await load();
      const what = parseShareText(removed.text).results.map((x) => `${GAME_BY_ID[x.game].name} ${x.display}`).join(', ');
      toast('↩ Removed ' + (what || 'your last submission'));
    } catch (e) {
      toast("Couldn't undo (" + e.message + ').', true);
    } finally {
      setBusy(false);
    }
  }

  // ---------- scoring ----------
  function inRange(e) {
    if (state.range === 'all') return true;
    const today = localDate(new Date());
    if (state.range === 'today') return e.date === today;
    return e.date > addDays(today, -Number(state.range));
  }

  function groupBy(list, keyFn) {
    const m = new Map();
    for (const x of list) {
      const k = keyFn(x);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(x);
    }
    return m;
  }

  // Competition ranking ("1,1,3") within one puzzle.
  function rankPuzzle(list, g) {
    const sorted = [...list].sort((a, b) => (g.better === 'higher' ? b.value - a.value : a.value - b.value));
    let rank = 0;
    return sorted.map((e, i) => {
      if (i === 0 || e.value !== sorted[i - 1].value) rank = i + 1;
      return { ...e, rank };
    });
  }

  function ranked(list) {
    // list of {player, ...} already in order; ties share rank via `score`
    let rank = 0;
    return list.map((x, i) => {
      if (i === 0 || x.score !== list[i - 1].score) rank = i + 1;
      return { ...x, rank };
    });
  }

  function overall(es, mode = state.mode) {
    const stats = {};
    const S = (p) => (stats[p] = stats[p] || { player: p, points: 0, wins: 0, played: 0, normSum: 0 });
    for (const list of groupBy(es, (e) => e.game + '|' + e.puzzle).values()) {
      const g = GAME_BY_ID[list[0].game];
      for (const e of rankPuzzle(list, g)) {
        const s = S(e.player);
        s.played++;
        s.normSum += norm(e, g);
        s.points += CFG.placementPoints[e.rank - 1] || 0;
        if (e.rank === 1 && list.length > 1) s.wins++;
      }
    }
    let list = Object.values(stats).map((s) => ({ ...s, avg: (100 * s.normSum) / s.played }));
    if (mode === 'points') {
      list.forEach((s) => (s.score = s.points));
      list.sort((a, b) => b.points - a.points || b.wins - a.wins || b.avg - a.avg);
      return ranked(list);
    }
    const ok = list.filter((s) => s.played >= CFG.minPlaysForAverage);
    const few = list.filter((s) => s.played < CFG.minPlaysForAverage);
    ok.forEach((s) => (s.score = Math.round(s.avg * 10)));
    ok.sort((a, b) => b.avg - a.avg || b.played - a.played);
    few.sort((a, b) => b.played - a.played || b.avg - a.avg);
    return [...ranked(ok), ...few.map((s) => ({ ...s, rank: null }))];
  }

  function perGame(es, g) {
    const mine = es.filter((e) => e.game === g.id);
    const stats = {};
    for (const list of groupBy(mine, (e) => e.puzzle).values()) {
      for (const e of rankPuzzle(list, g)) {
        const s = (stats[e.player] = stats[e.player] || { player: e.player, played: 0, sum: 0, best: null, wins: 0, fails: 0 });
        s.played++;
        s.sum += e.value;
        if (s.best === null || (g.better === 'higher' ? e.value > s.best : e.value < s.best)) s.best = e.value;
        if (e.rank === 1 && list.length > 1) s.wins++;
        if (g.failValue && e.value >= g.failValue) s.fails++;
      }
    }
    const list = Object.values(stats).map((s) => ({ ...s, avg: s.sum / s.played }));
    list.forEach((s) => (s.score = Math.round(s.avg * 1000)));
    list.sort((a, b) => (g.better === 'higher' ? b.avg - a.avg : a.avg - b.avg) || b.played - a.played);
    return ranked(list);
  }


  // ---------- first-guess luck, badges, rivalries ----------
  const mean = (arr) => arr.reduce((t, v) => t + v, 0) / arr.length;

  // Luck of a player's opening guesses over their last 10 results that have one: -100..+100.
  function startLuck(p) {
    const list = entries.filter((e) => e.player === p && e.start).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 10);
    if (list.length < 3) return null;
    const pct = mean(list.map((e) => e.start.pct));
    return { score: Math.round((pct - 50) * 2), n: list.length, pct };
  }

  // 🎯-style gauge shared by "Form" and "Luck".
  function meterHtml({ score, emoji, label, note }) {
    return `<div class="form"><div class="form-head"><b>${emoji} ${label} ${info(note)}</b><span class="${score >= 0 ? 'up' : 'down'}">${score > 0 ? '+' : score < 0 ? '−' : ''}${Math.abs(score)}</span></div>
      <div class="gauge" role="img" aria-label="${esc(label)} ${score} on a scale of minus 100 to 100"><span class="mid"></span><span class="dot" style="left:${(score + 100) / 2}%"></span></div>
      <div class="gauge-scale"><span>worse</span><span>better</span></div></div>`;
  }

  const BADGES = [
    { id: 'perfect', times: true, emoji: '💯', name: 'Perfectionist', desc: 'Get a perfect result (for example Wordle in 1).' },
    { id: 'hole', times: true, emoji: '⛳', name: 'Hole in one', desc: 'Solve a guessing game in a single guess.' },
    { id: 'summit', times: true, emoji: '🏔️', name: 'Summit', desc: 'Top out a Peakle climb.' },
    { id: 'comeback', times: true, emoji: '🔄', name: 'Comeback', desc: 'Win a puzzle right after finishing last in the same game (3+ players).' },
    { id: 'hot', emoji: '⚡', name: 'Hot hand', desc: `Win ${CFG.hotStreakWins} puzzles in a row in one game.` },
    { id: 'special', emoji: '🎯', name: 'Specialist', desc: 'Win 5 puzzles in one game.' },
    { id: 'busy', emoji: '🗓️', name: 'Busy day', desc: 'Play 5 different games in one day.' },
    { id: 'week', emoji: '🔥', name: 'Week streak', desc: 'Play on 7 days in a row.' },
    { id: 'month', emoji: '🌋', name: 'Month streak', desc: 'Play on 30 days in a row.' },
    { id: 'regular', emoji: '📅', name: 'Regular', desc: 'Play 25 puzzles.' },
    { id: 'veteran', emoji: '🎖️', name: 'Veteran', desc: 'Play 100 puzzles.' },
    { id: 'lucky', times: true, emoji: '✨', name: 'Lucky start', desc: 'Open with a guess better than 95% of all openings.' },
    { id: 'crown', emoji: '👑', name: 'On top', desc: 'Currently #1 on the Overall board (Points, all time).' },
  ];

  function badgesOf(p) {
    const mine = entries.filter((e) => e.player === p);
    const n = Object.fromEntries(BADGES.map((b) => [b.id, 0]));
    const byGame = groupBy(mine, (e) => e.game);
    for (const e of mine) {
      const g = GAME_BY_ID[e.game];
      if (!g.relative && norm(e, g) >= 0.999) n.perfect++;
      if (g.unit === 'guesses' && g.id !== 'poople' && e.value === 1) n.hole++;
      if (e.detail && (e.detail.rows || []).some((r) => /topped out/i.test(String(r.value)))) n.summit++;
      if (e.start && e.start.pct >= 95) n.lucky++;
    }
    let bestRun = 0, bestWins = 0;
    for (const list of byGame.values()) {
      list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.puzzle < b.puzzle ? -1 : 1));
      let run = 0, wins = 0;
      list.forEach((e, i) => {
        if (!e.solo) run = e.won ? run + 1 : 0;
        bestRun = Math.max(bestRun, run);
        if (e.won) { wins++; if (i > 0 && list[i - 1].last) n.comeback++; }
      });
      bestWins = Math.max(bestWins, wins);
    }
    n.hot = bestRun >= CFG.hotStreakWins ? bestRun : 0;
    n.special = bestWins >= 5 ? bestWins : 0;
    n.busy = Math.max(0, ...[...groupBy(mine, (e) => e.date).values()].map((l) => new Set(l.map((e) => e.game)).size));
    n.busy = n.busy >= 5 ? n.busy : 0;
    const best = streakInfo(p, null).best;
    n.week = best >= 7 ? best : 0;
    n.month = best >= 30 ? best : 0;
    n.regular = mine.length >= 25 ? mine.length : 0;
    n.veteran = mine.length >= 100 ? mine.length : 0;
    const top = overall(entries, 'points')[0];
    n.crown = top && top.player === p && top.rank === 1 ? 1 : 0;
    return BADGES.map((b) => ({ ...b, count: n[b.id], got: n[b.id] > 0 }));
  }

  // Rivalries from head-to-head records over puzzles both players played.
  function rivalries(p) {
    const rows = Object.keys(displayName)
      .filter((o) => o !== p)
      .map((o) => { const r = headToHead(p, o).total; return { o, a: r.a, b: r.b, tie: r.tie, n: r.a + r.b + r.tie }; })
      .filter((x) => x.n >= CFG.minForRival);
    if (!rows.length) return null;
    const closest = [...rows].sort((x, y) => Math.abs(x.a - x.b) / x.n - Math.abs(y.a - y.b) / y.n || y.n - x.n)[0];
    const nemesis = [...rows].filter((x) => x.b > x.a).sort((x, y) => y.b / y.n - x.b / x.n || y.n - x.n)[0];
    const victim = [...rows].filter((x) => x.a > x.b).sort((x, y) => y.a / y.n - x.a / x.n || y.n - x.n)[0];
    return { closest, nemesis, victim };
  }

  // ---------- rendering ----------
  const medal = (r) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : r ? r : '–');
  const nameCell = (p, gameId) => {
    const me = normName(getName()) === p;
    const cur = streakInfo(p, gameId).cur;
    const flame = cur >= 2 ? `<span class="streak" title="${cur} days in a row">🔥${cur}</span>` : '';
    const hot = gameId
      ? [[GAME_BY_ID[gameId], hotFor(p, gameId)]].filter(([, n]) => n > 0)
      : hotGames(p);
    const bolt = hot.length
      ? `<span class="hotb" title="Hot streak: ${esc(hot.map(([g, n]) => `${g.name} ×${n}`).join(', '))}">⚡${Math.max(...hot.map(([, n]) => n))}</span>`
      : '';
    const marks = flame || bolt ? `<span class="marks">${flame}${bolt}</span>` : '';
    return `<td class="name${me ? ' is-me' : ''}"><div class="name-wrap"><button class="plink" data-player="${esc(p)}"${me ? ' title="You"' : ''}>${esc(displayName[p] || p)}</button>${marks}</div></td>`;
  };

  // Round profile button in the header: first letter of the name on a colour picked from the name.
  function renderAvatar() {
    const name = getName();
    const el = $('#avatar');
    el.textContent = name ? Array.from(name)[0].toUpperCase() : '?';
    let hash = 0;
    for (const ch of normName(name)) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    el.style.background = name ? `hsl(${hash} 55% 45%)` : '';
    $('#my-profile').classList.toggle('active', state.tab === 'profile' && state.profile === normName(name));
  }

  function renderTabs() {
    const btn = (t) => `<button data-tab="${t.id}" class="${t.id === state.tab ? 'on' : ''}">${esc(t.label)}</button>`;
    const gbtn = (g) => `<button data-tab="${g.id}" class="gtab${g.id === state.tab ? ' on' : ''}">${g.emoji} ${esc(g.name)}</button>`;
    const stats = [{ id: 'overall', label: '🏆 Overall' }, { id: 'daily', label: '📅 Daily' }, { id: 'recent', label: '🗓️ Recent' }, { id: 'weekly', label: '📰 Weekly' }, { id: 'charts', label: '📊 Charts' }, { id: 'records', label: '🏅 Records' }];
    const group = (label, inner, cls = '') => `<div class="tab-group"><span class="tab-label">${label}</span><div class="tab-row${cls}">${inner}</div></div>`;
    $('#tabs').innerHTML = group('Stats', stats.map(btn).join('')) + group('Games', GAMES.map(gbtn).join(''), ' games');
    $('#mode').style.display = state.tab === 'overall' ? '' : 'none';
    const plain = state.tab === 'daily' || state.tab === 'weekly' || state.tab === 'profile' || state.tab === 'records'; // these ignore the time range
    document.querySelector('.controls').hidden = plain;
  }

  function renderToday() {
    const p = normName(getName());
    const today = localDate(new Date());
    let played = 0;
    const chips = GAMES.map((g) => {
      const done = entries.some((e) => e.player === p && e.game === g.id && e.date === today);
      if (done) played++;
      return `<a class="tchip${done ? ' done' : ''}" href="${esc(g.url)}" target="_blank" rel="noopener" title="${done ? 'Played' : 'Play'} ${esc(g.name)}" aria-label="${done ? 'Played' : 'Play'} ${esc(g.name)}">${g.emoji}</a>`;
    }).join('');
    const cur = p ? streakInfo(p, null).cur : 0;
    const streak = cur >= 2 ? `<span class="streak">🔥 ${cur}-day streak</span>` : '';
    const undo = myRecentIdx() >= 0 ? '<button class="link" id="undo">↩ Undo last submission</button>' : '';
    $('#today').innerHTML = p
      ? `<div class="today-head"><span><b>Today</b> <span class="muted">${played} of ${GAMES.length} played</span></span>${streak}</div>
         <div class="today-chips icon-grid">${chips}</div>${undo ? `<div class="today-foot">${undo}</div>` : ''}`
      : '';
  }

  // Win ratio: wins / puzzles that at least one other friend also played (so a win was possible).
  // Ties for 1st count as wins, like the Wins column elsewhere. Optionally limited to one game.
  function winRates(es, gameId) {
    const stats = {};
    const pool = gameId === 'all' ? es : es.filter((e) => e.game === gameId);
    for (const list of groupBy(pool, (e) => e.game + '|' + e.puzzle).values()) {
      if (list.length < 2) continue; // nobody to beat
      for (const e of rankPuzzle(list, GAME_BY_ID[list[0].game])) {
        const s = (stats[e.player] = stats[e.player] || { player: e.player, wins: 0, contested: 0 });
        s.contested++;
        if (e.rank === 1) s.wins++;
      }
    }
    return Object.values(stats).map((s) => ({ ...s, ratio: s.wins / s.contested }));
  }

  function renderWinRate(es) {
    const sel = state.wrGame;
    const picker = `<label class="wr-pick"><span>Pick a game</span><select id="wr-game">
      <option value="all"${sel === 'all' ? ' selected' : ''}>All games</option>
      ${GAMES.map((g) => `<option value="${g.id}"${sel === g.id ? ' selected' : ''}>${g.emoji} ${esc(g.name)}</option>`).join('')}</select></label>`;
    const list = winRates(es, sel);
    if (!list.length) return picker + empty('No puzzles where two or more friends played the same one yet.');
    const ok = list.filter((s) => s.contested >= CFG.minPlaysForAverage);
    const few = list.filter((s) => s.contested < CFG.minPlaysForAverage);
    const order = (a, b) => b.ratio - a.ratio || b.wins - a.wins || b.contested - a.contested;
    ok.sort(order);
    few.sort(order);
    let rank = 0;
    const shown = [
      ...ok.map((s, i) => { if (i === 0 || s.ratio !== ok[i - 1].ratio) rank = i + 1; return { ...s, rank }; }),
      ...few.map((s) => ({ ...s, rank: null })),
    ];
    const body = shown
      .map(
        (s) => `<tr class="${s.rank === null ? 'dim' : ''}"><td class="rank">${medal(s.rank)}</td>${nameCell(s.player, sel === 'all' ? undefined : sel)}
          <td class="num strong wr"><span class="wbar" style="width:${Math.round(s.ratio * 100)}%"></span><span class="wval">${Math.round(s.ratio * 100)}%</span></td>
          <td class="num nowrap" title="${s.wins} wins out of ${s.contested} puzzles that a friend also played">${s.wins}/${s.contested}</td></tr>`
      )
      .join('');
    let table = `<table><tr><th></th><th>Player</th><th class="num">Win %</th><th class="num">Record</th></tr>${body}</table>`;

    // "All games": also a breakdown with one row per game and one column per player.
    let byGame = '';
    if (sel === 'all') {
      const players = shown.map((s) => s.player);
      const perGame = GAMES.map((g) => [g, new Map(winRates(es, g.id).map((s) => [s.player, s]))]).filter(([, m]) => m.size);
      if (perGame.length) {
        const cells = (m) => {
          const best = Math.max(...[...m.values()].map((s) => s.ratio));
          return players
            .map((p) => {
              const s = m.get(p);
              return s ? `<td class="num${s.ratio === best ? ' strong' : ''}" title="${s.wins} of ${s.contested}">${Math.round(s.ratio * 100)}%</td>` : '<td class="num muted">–</td>';
            })
            .join('');
        };
        byGame = `<h3 class="game-h">By game</h3><table class="wr-matrix"><tr><th></th>${players.map((p) => `<th class="num">${esc((displayName[p] || p).slice(0, 6))}</th>`).join('')}</tr>
          ${perGame.map(([g, m]) => `<tr><td class="wr-game-cell" title="${esc(g.name)}">${g.emoji}</td>${cells(m)}</tr>`).join('')}</table>`;
      }
    }
    const note = `Win % = wins ÷ puzzles that at least one other friend also played. Ties for 1st count as wins. Fewer than ${CFG.minPlaysForAverage} such puzzles are listed at the bottom. Record = wins / puzzles a friend also played. In the By game table, hover a game's emoji for its name.`;
    return `${picker}${withInfo(table, note)}${renderRollingWin(es, sel)}${byGame}`;
  }

  // Elo leaderboard. Ratings always use every result; the time range picks the window for "Change".
  function renderElo() {
    const players = Object.keys(ratings).filter((p) => ratings[p].n > 0);
    if (!players.length) return empty('Ratings start once two friends have done the same puzzle.');
    const today = localDate(new Date());
    const since = state.range === 'all' ? null : state.range === 'today' ? addDays(today, -1) : addDays(today, -Number(state.range));
    const MIN = 5;
    const all = players
      .map((p) => ({ p, ...ratings[p], ch: since ? ratings[p].r - ratingOn(p, since) : null }))
      .sort((a, b) => b.r - a.r);
    const ok = all.filter((x) => x.n >= MIN), few = all.filter((x) => x.n < MIN);
    const arrow = (v) => (v == null ? '' : Math.round(v) === 0 ? '<span class="muted">±0</span>' : `<span class="${v > 0 ? 'up' : 'down'}">${v > 0 ? '▲' : '▼'}${Math.abs(Math.round(v))}</span>`);
    const body = [...ok.map((x, i) => ({ ...x, rank: i + 1 })), ...few.map((x) => ({ ...x, rank: null }))]
      .map((x) => `<tr class="${x.rank === null ? 'dim' : ''}"><td class="rank">${medal(x.rank)}</td>${nameCell(x.p)}<td class="num strong">${Math.round(x.r)}</td>
        <td class="num nowrap elo-ch">${since ? arrow(x.ch) : `<span title="Highest rating, ${x.peakDate ? shortDate(x.peakDate) : ''}">${Math.round(x.peak)}</span>`}</td><td class="num">${x.n}</td></tr>`)
      .join('');
    const table = `<table><tr><th></th><th>Player</th><th class="num">Rating</th><th class="num">${since ? 'Change' : 'Peak'}</th><th class="num">Matches</th></tr>${body}</table>`;

    // Rating over time for the selected range.
    const first = players.reduce((m, p) => (ratings[p].hist[0].date < m ? ratings[p].hist[0].date : m), today);
    const xs = datesBetween(since && addDays(since, 1) > first ? addDays(since, 1) : first, today);
    const series = players.map((p) => {
      const start = ratings[p].hist[0].date;
      return { p, ys: xs.map((d) => (d < start ? null : ratingOn(p, d))) };
    }).filter((s) => s.ys.some((v) => v != null));
    const vals = series.flatMap((s) => s.ys.filter((v) => v != null));
    let chart = '';
    if (xs.length > 1 && vals.length) {
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const step = niceStep(Math.max(20, hi - lo) / 4);
      const yMin = Math.floor(lo / step) * step, yMax = Math.ceil(hi / step) * step + (Math.ceil(hi / step) * step === hi ? step : 0);
      const yTicks = [];
      for (let t = yMin; t <= yMax + 1e-9; t += step) yTicks.push(t);
      chart = `<h3 class="game-h">📈 Rating over time</h3>${legendHtml(series.map((s) => s.p))}<div class="chart-wrap">${lineChart({ xs, series, yMin, yMax, yTicks, id: 'elo', label: 'Rating per player over time' })}</div>`;
    }
    const note = `Elo rating: everyone starts at ${ELO_START}. Each puzzle two or more friends did counts as a match against everyone else on it; beating a higher-rated player earns more than beating a lower-rated one, and losing to a lower-rated player costs more. Ratings use every result ever; the time range only changes the Change column and the chart. Fewer than ${MIN} matches are listed at the bottom.`;
    return `${withInfo(table, note)}${chart}`;
  }

  function renderOverall(es) {
    if (state.mode === 'winrate') return renderWinRate(es);
    if (state.mode === 'elo') return renderElo();
    const list = overall(es);
    if (!list.length) return empty();
    const pts = state.mode === 'points';
    const head = pts
      ? '<tr><th></th><th>Player</th><th class="num">Points</th><th class="num">Wins</th><th class="num">Played</th></tr>'
      : '<tr><th></th><th>Player</th><th class="num">Avg</th><th class="num">Wins</th><th class="num">Played</th></tr>';
    const body = list
      .map(
        (s) => `<tr class="${s.rank === null ? 'dim' : ''}"><td class="rank">${medal(s.rank)}</td>${nameCell(s.player)}
          <td class="num strong">${pts ? s.points : s.avg.toFixed(1)}</td><td class="num">${s.wins}</td><td class="num">${s.played}</td></tr>`
      )
      .join('');
    const note = pts
      ? `Each puzzle: ${CFG.placementPoints.map((p, i) => `${ordinal(i + 1)} = ${p}`).join(', ')} pts among friends who played it. Wins = outright or tied 1st with 2+ players.`
      : `Average of each result scaled 0–100 (100 = perfect; Wordle, Flagle, Tradle or Nerdle 1/6, Krillion 700, MapTap 1000, Magnitudle 500, Draw the Border 100, Perceptle 100, Peakle vs the day's best (min. 8 steps), Tiled Words vs the day's fastest time (benchmark kept between 2:00 and 6:00), Globle vs the day's fewest guesses (benchmark kept between 4 and 10), Spotle likewise (4 to 8), Noillirk 8,849 m, Poople at par). Fewer than ${CFG.minPlaysForAverage} plays are listed at the bottom.`;
    return withInfo(`<table>${head}${body}</table>`, note);
  }

  function renderGame(es, g) {
    const title = `<div class="game-title"><h2>${g.emoji} ${esc(g.name)}</h2><a class="play" href="${esc(g.url)}" target="_blank" rel="noopener">Play ↗</a></div>`;
    const list = perGame(es, g);
    if (!list.length) return title + empty();
    const head = `<tr><th></th><th>Player</th><th class="num">Avg ${esc(g.unit)}</th><th class="num">Best</th><th class="num">Wins</th><th class="num">Played</th></tr>`;
    const body = list
      .map(
        (s) => `<tr><td class="rank">${medal(s.rank)}</td>${nameCell(s.player, g.id)}
        <td class="num strong">${g.formatValue(s.avg)}</td><td class="num">${g.failValue && s.best >= g.failValue ? 'X' : g.formatValue(s.best).replace(/\.00$/, '')}</td>
        <td class="num">${s.wins}</td><td class="num nowrap">${s.played}${s.fails ? ` <small class="muted">${s.fails}✗</small>` : ''}</td></tr>`
      )
      .join('');
    const note = g.better === 'higher' ? 'Higher is better.' : 'Lower is better.' + (g.failValue ? ` A failed puzzle counts as ${g.failValue}.` : '');
    return title + withInfo(`<table class="pg-table">${head}${body}</table>`, note);
  }

  function renderRecent(es) {
    const byDate = [...groupBy(es, (e) => e.date).entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 21);
    if (!byDate.length) return empty();
    return byDate
      .map(([date, list]) => {
        const games = GAMES.filter((g) => list.some((e) => e.game === g.id))
          .map((g) => {
            const groups = [...groupBy(list.filter((e) => e.game === g.id), (e) => e.puzzle).values()];
            return groups.map((grp, gi) => {
            const res = rankPuzzle(grp, g);
            const n = res.length;
            return `<div class="day-game"><span class="gname">${gi === 0 ? `${g.emoji} ${esc(g.name)}` : '↳'}${groups.length > 1 ? ` <small class="muted">#${esc(grp[0].puzzle)}</small>` : ''}</span>${res
              .map((e) => `<span class="res${e.rank === 1 && n > 1 ? ' win' : ''}">${esc(displayName[e.player] || e.player)} <b class="has-tip"${tipAttr(e)}>${esc(e.display)}</b>${vsMark(e)}${startMark(e)}</span>`)
              .join('')}</div>`;
            }).join('');
          })
          .join('');
        return `<div class="day"><h3>${prettyDate(date)}</h3>${games}</div>`;
      })
      .join('');
  }



  // ---------- weekly recap ----------
  let lastRecapText = '';

  function renderWeekly() {
    const today = localDate(new Date());
    const end = state.week || today;
    const start = addDays(end, -6);
    const pStart = addDays(end, -13), pEnd = addDays(end, -7);
    const short = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const nav = `<div class="daynav"><button data-week="${addDays(end, -7)}" aria-label="Previous week">‹</button>
      <strong>${end === today ? 'Last 7 days' : `${short(start)} – ${short(end)}`}</strong>
      <button data-week="${addDays(end, 7) > today ? today : addDays(end, 7)}" aria-label="Next week" ${end >= today ? 'disabled' : ''}>›</button></div>`;
    const w = entries.filter((e) => e.date >= start && e.date <= end);
    const prev = entries.filter((e) => e.date >= pStart && e.date <= pEnd);
    if (!w.length) return nav + empty('Nobody played in this week.');

    const nm = (p) => displayName[p] || p;
    const cards = [];
    const add = (emoji, title, players, sub) => players.length && cards.push({ emoji, title, players, sub });
    const topBy = (items, key, min = -Infinity) => {
      const ok = items.filter((x) => key(x) > min);
      if (!ok.length) return null;
      const best = Math.max(...ok.map(key));
      return { best, items: ok.filter((x) => key(x) === best) };
    };

    const ov = overall(w, 'points');
    const champ = topBy(ov, (s) => s.points, 0);
    if (champ) add('👑', 'Champion', champ.items.map((s) => s.player), `${champ.best} points · ${champ.items[0].wins} win${champ.items[0].wins === 1 ? '' : 's'} from ${champ.items[0].played} played`);
    const wins = topBy(ov, (s) => s.wins, 0);
    if (wins) add('🏆', 'Most wins', wins.items.map((s) => s.player), `${wins.best} outright or tied win${wins.best === 1 ? '' : 's'}`);

    const avgNorm = (list) => mean(list.map((e) => norm(e, GAME_BY_ID[e.game])));
    const per = (list) => groupBy(list, (e) => e.player);
    const thisW = per(w), lastW = per(prev);
    const climbers = [...thisW.entries()]
      .filter(([p, l]) => l.length >= 3 && (lastW.get(p) || []).length >= 3)
      .map(([p, l]) => ({ p, now: avgNorm(l) * 100, before: avgNorm(lastW.get(p)) * 100 }))
      .map((x) => ({ ...x, diff: x.now - x.before }));
    const climb = topBy(climbers, (x) => Math.round(x.diff), 0);
    if (climb) add('📈', 'Biggest climber', climb.items.map((x) => x.p), `+${climb.best} on the 0–100 scale vs the week before (${Math.round(climb.items[0].before)} → ${Math.round(climb.items[0].now)})`);

    const forms = [...thisW.entries()]
      .map(([p, l]) => ({ p, l: l.filter((e) => e.vs) }))
      .filter((x) => x.l.length >= 3)
      .map((x) => ({ p: x.p, score: Math.round(mean(x.l.map((e) => Math.max(-2, Math.min(2, e.vs.z)))) * 50), n: x.l.length }));
    const form = topBy(forms, (x) => x.score, 0);
    if (form) add('🍀', 'Best form', form.items.map((x) => x.p), `${form.best > 0 ? '+' : ''}${form.best} vs their usual over ${form.items[0].n} results`);

    const starts = [...thisW.entries()]
      .map(([p, l]) => ({ p, l: l.filter((e) => e.start) }))
      .filter((x) => x.l.length >= 3)
      .map((x) => ({ p: x.p, pct: Math.round(mean(x.l.map((e) => e.start.pct))), n: x.l.length }));
    const lucky = topBy(starts, (x) => x.pct, 55);
    if (lucky) add('✨', 'Luckiest starts', lucky.items.map((x) => x.p), `Opening guesses better than ${lucky.best}% of all openings, on average`);

    const bestOne = topBy(w.filter((e) => !GAME_BY_ID[e.game].relative), (e) => norm(e, GAME_BY_ID[e.game]), 0.5);
    if (bestOne) {
      const e = bestOne.items[0];
      add('⭐', 'Best single result', bestOne.items.slice(0, 3).map((x) => x.player), `${GAME_BY_ID[e.game].emoji} ${GAME_BY_ID[e.game].name} ${e.display}${bestOne.items.length > 1 ? ' (and others tied)' : ''}`);
    }

    let run = null;
    for (const l of groupBy(w, (e) => e.player + '|' + e.game).values()) {
      l.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.puzzle < y.puzzle ? -1 : 1));
      let r = 0;
      for (const e of l) {
        if (!e.solo) r = e.won ? r + 1 : 0;
        if (r >= 2 && (!run || r > run.n)) run = { n: r, player: e.player, game: GAME_BY_ID[e.game] };
      }
    }
    if (run) add('⚡', 'Longest win run', [run.player], `${run.n} wins in a row in ${run.game.emoji} ${run.game.name}`);

    const days = topBy([...thisW.entries()].map(([p, l]) => ({ p, d: new Set(l.map((e) => e.date)).size })), (x) => x.d, 2);
    if (days) add('🔥', 'Most days played', days.items.map((x) => x.p), `${days.best} of 7 days`);

    const cold = forms.filter((x) => x.score <= -15).sort((x, y) => x.score - y.score)[0];
    if (cold) add('☁️', 'Cold spell', [cold.p], `−${Math.abs(cold.score)} vs their usual. It happens.`);

    const range = `${short(start)} – ${short(end)}`;
    lastRecapText = `📰 ${CFG.title} — week of ${range}\n` + cards.map((c) => `${c.emoji} ${c.title}: ${c.players.map(nm).join(', ')} — ${c.sub}`).join('\n');
    const html = cards
      .map((c) => `<div class="wk-card"><div class="wk-emoji">${c.emoji}</div><div class="wk-body"><div class="wk-title">${esc(c.title)}</div>
        <div class="wk-who">${c.players.map((p) => `<button class="plink" data-player="${esc(p)}">${esc(nm(p))}</button>`).join(', ')}</div><div class="wk-sub">${esc(c.sub)}</div></div></div>`)
      .join('');
    return `${nav.replace('</strong>', ` ${info(`${w.length} results from ${thisW.size} player${thisW.size === 1 ? '' : 's'} between ${range}. Cards only appear when there's enough data.`)}</strong>`)}<div class="wk-grid">${html}</div>
      <button class="big wk-copy" data-copy-week="1">📋 Copy this recap</button>`;
  }

  function copyWeek() {
    navigator.clipboard.writeText(lastRecapText).then(() => toast('Recap copied. Paste it in your group chat.'), () => toast("Couldn't copy. Select the cards and copy by hand.", true));
  }

  // ---------- result details (hover / tap) ----------
  let tips = []; // rebuilt on every render; elements point at an index
  const tipAttr = (e) => {
    const d = e.detail;
    if (!e.vs && !e.start && !e.moved && e.eloDelta == null && (!d || !((d.grid && d.grid.length) || (d.rows && d.rows.length)))) return '';
    tips.push(e);
    return ` data-tip="${tips.length - 1}" tabindex="0"`;
  };

  // 🍀 / ☁️ next to a result that was clearly better / worse than that player's usual.
  const vsMark = (e) => (e.vs && Math.abs(e.vs.z) >= 1 ? ` <span class="luck" title="${e.vs.z > 0 ? 'Better' : 'Worse'} than their usual">${e.vs.z > 0 ? '🍀' : '☁️'}</span>` : '');

  // ✨ / 🌧️ for an opening guess that was among the best / worst ever shared for that game.
  const startMark = (e) => (e.start && (e.start.pct >= 85 || e.start.pct <= 15) ? ` <span class="luck" title="${e.start.pct >= 85 ? 'Lucky' : 'Unlucky'} opening guess">${e.start.pct >= 85 ? '✨' : '🌧️'}</span>` : '');

  function tipHtml(e) {
    const g = GAME_BY_ID[e.game];
    const d = e.detail || {};
    const vs = e.vs
      ? `<div class="tip-vs ${e.vs.diff >= 0 ? 'up' : 'down'}">${e.vs.diff >= 5 ? '🍀' : e.vs.diff <= -5 ? '☁️' : '😐'} ${e.vs.diff >= 0 ? '+' : '−'}${Math.abs(Math.round(e.vs.diff))} vs their usual (${Math.round(e.vs.usual)} on the 0–100 scale)</div>`
      : '';
    const moved = e.moved
      ? `<div class="tip-note">📍 Counted for ${dayWord(e.date)}: they played it in the evening in their own time zone. The puzzle itself is ${dayWord(e.puzzleDate)}'s.</div>`
      : '';
    const start = e.start
      ? `<div class="tip-vs ${e.start.pct >= 50 ? 'up' : 'down'}">${e.start.pct >= 85 ? '✨' : e.start.pct <= 15 ? '🌧️' : '🎲'} Opening guess better than ${e.start.pct}% of ${e.start.n} openings</div>`
      : '';
    const elo = e.eloDelta != null
      ? `<div class="tip-note">📈 Rating ${e.eloDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(e.eloDelta))} (${Math.round(e.eloBefore)} → ${Math.round(e.eloBefore + e.eloDelta)})</div>`
      : '';
    const rowsHtml = (d.rows || [])
      .map((r) => `<tr><td>${esc(r.label)}</td><td class="tip-mark">${esc(r.mark || '')}</td><td class="num"><b>${esc(r.value)}</b></td></tr>`)
      .join('');
    const grid = (d.grid || []).map((l) => `<div>${esc(l)}</div>`).join('');
    const legend = g.legend
      ? `<div class="tip-legend">${Object.entries(g.legend).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(' · ')}</div>`
      : '';
    return `<div class="tip-head">${g.emoji} ${esc(g.name)} · <b>${esc(e.display)}</b></div>${vs}${start}${moved}${elo}
      ${rowsHtml ? `<table>${rowsHtml}</table>` : ''}${grid ? `<div class="tip-grid">${grid}</div>` : ''}${d.note ? `<div class="tip-note">${esc(d.note)}</div>` : ''}${legend}`;
  }

  const tipEl = () => $('#tip');
  function showTip(el) {
    const e = tips[Number(el.dataset.tip)];
    if (!e) return;
    const t = tipEl();
    t.innerHTML = e.html != null ? e.html : tipHtml(e);
    t.hidden = false;
    const r = el.getBoundingClientRect(), tr = t.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - tr.width - 8, r.left + r.width / 2 - tr.width / 2));
    const below = r.bottom + 8 + tr.height <= window.innerHeight || r.top - 8 - tr.height < 0;
    t.style.left = left + 'px';
    t.style.top = (below ? r.bottom + 8 : r.top - 8 - tr.height) + 'px';
    t.dataset.for = el.dataset.tip;
  }
  const hideTip = () => { tipEl().hidden = true; tipEl().dataset.for = ''; };

  // ---------- daily recap ----------
  function renderDaily() {
    const today = localDate(new Date());
    const date = state.day || today;
    const nav = `<div class="daynav"><button data-day="${addDays(date, -1)}" aria-label="Previous day">‹</button>
      <strong>${prettyDate(date)}</strong>
      <button data-day="${addDays(date, 1)}" aria-label="Next day" ${date >= today ? 'disabled' : ''}>›</button></div>`;
    const es = entries.filter((e) => e.date === date);
    if (!es.length) return nav + empty('Nobody has played anything on this day.');

    const board = overall(es, 'points')
      .map((s) => `<tr><td class="rank">${medal(s.rank)}</td>${nameCell(s.player)}<td class="num strong">${s.points}</td><td class="num">${s.played}</td></tr>`)
      .join('');
    const top = `<h3>Day standings ${info("Points per puzzle: 3 for 1st, 2 for 2nd, 1 for 3rd. Hover (or tap) a result for the round-by-round details. 🔥 Hard / 🍰 Easy compares the group's average on that puzzle with the game's other puzzles.")}</h3><table><tr><th></th><th>Player</th><th class="num">Points</th><th class="num">Games</th></tr>${board}</table>`;
    const headline = dailyHeadline(es);

    const cards = GAMES.filter((g) => es.some((e) => e.game === g.id))
      .map((g) => {
        // Normally one puzzle per game per day. If a result was moved here (played the evening before),
        // rank each puzzle on its own and label them.
        const groups = [...groupBy(es.filter((e) => e.game === g.id), (e) => e.puzzle).values()];
        const rowsHtml = groups
          .map((grp) => (groups.length > 1 ? `<tr><td colspan="3" class="muted sub">Puzzle #${esc(grp[0].puzzle)}</td></tr>` : '') + rankPuzzle(grp, g)
          .map((e) => `<tr><td class="rank">${medal(e.rank)}</td>${nameCell(e.player)}<td class="num strong"><span class="has-tip"${tipAttr(e)}>${esc(e.display)}</span>${vsMark(e)}${startMark(e)}</td></tr>`)
          .join(''))
          .join('');
        return `<h3 class="game-h">${g.emoji} ${esc(g.name)}${diffTag(g, groups[0][0].puzzle)}</h3><table>${rowsHtml}</table>`;
      })
      .join('');
    return nav + headline + top + cards;
  }

  // "🔥 Hard" / "🍰 Easy" next to a game on the Daily tab, plus the group's average on that puzzle.
  function diffTag(g, puzzle) {
    const d = puzzleDiff[g.id + '|' + puzzle];
    if (!d) return '';
    const sd = Math.abs(d.z).toFixed(1);
    const tag = d.tag === 'hard'
      ? `<span class="dtag hard" title="The group did ${sd} standard deviations worse than on this game's usual puzzle">🔥 Hard</span>`
      : d.tag === 'easy' ? `<span class="dtag easy" title="The group did ${sd} standard deviations better than on this game's usual puzzle">🍰 Easy</span>` : '';
    return ` ${tag}<span class="dtag-avg">group avg ${esc(fmtAvg(g, d.avg))}</span>`;
  }

  // One auto-written line summing up a day: who topped it, plus up to two notable things that happened.
  function dailyHeadline(es) {
    if (!es.length) return '';
    const nm = (p) => `<b>${esc(displayName[p] || p)}</b>`;
    const gn = (e) => esc(GAME_BY_ID[e.game].name);
    const names = (ps) => (ps.length <= 2 ? ps.map(nm).join(' and ') : ps.slice(0, -1).map(nm).join(', ') + ' and ' + nm(ps[ps.length - 1]));
    const top = overall(es, 'points').filter((s) => s.rank === 1);
    let lead = '';
    if (top.length === 1) lead = `${nm(top[0].player)} tops the day with ${top[0].points} points${top[0].wins >= 2 ? ` and ${top[0].wins} wins` : ''}`;
    else if (top.length > 1) lead = `${names(top.map((s) => s.player))} share the top spot on ${top[0].points} points`;
    const size = {};
    for (const e of entries) size[e.game + '|' + e.puzzle] = (size[e.game + '|' + e.puzzle] || 0) + 1;
    const extras = [];
    const ace = es.find((e) => GAME_BY_ID[e.game].failValue && e.value === 1)
      || es.find((e) => { const g = GAME_BY_ID[e.game]; return !g.relative && !g.failValue && norm(e, g) >= 0.999; });
    if (ace) extras.push(GAME_BY_ID[ace.game].failValue ? `${nm(ace.player)} gets ${gn(ace)} in one` : `a perfect ${gn(ace)} from ${nm(ace.player)}`);
    const ended = es.filter((e) => e.runBefore >= CFG.hotStreakWins && !e.won && size[e.game + '|' + e.puzzle] > 1).sort((a, b) => b.runBefore - a.runBefore)[0];
    if (ended) extras.push(`${nm(ended.player)}'s ${ended.runBefore}-game ${gn(ended)} win streak ends`);
    const up = upsets.filter((u) => u.gap >= 40 && es.includes(u.e)).sort((a, b) => b.gap - a.gap)[0];
    if (up) extras.push(`upset at ${gn(up.e)}: ${nm(up.e.player)} beats ${nm(up.loser.player)}, rated ${Math.round(up.gap)} higher`);
    const ext = es.filter((e) => e.won && e.runAfter >= CFG.hotStreakWins).sort((a, b) => b.runAfter - a.runAfter)[0];
    if (ext) extras.push(`${nm(ext.player)} makes it ${ext.runAfter} ${gn(ext)} wins in a row`);
    const hard = [...new Set(es.map((e) => e.game + '|' + e.puzzle))].map((k) => [k, puzzleDiff[k]]).filter(([, d]) => d && d.tag === 'hard').sort((a, b) => b[1].z - a[1].z)[0];
    if (hard) { const g = GAME_BY_ID[hard[0].split('|')[0]]; extras.push(`a tough ${esc(g.name)} (group avg ${esc(fmtAvg(g, hard[1].avg))})`); }
    const parts = [lead, ...extras.slice(0, 2)].filter(Boolean);
    if (!parts.length) return '';
    let text = parts.join('; ') + '.';
    text = text.replace(/^([a-z])/, (c) => c.toUpperCase());
    return `<div class="headline"><span class="hl-icon">📰</span><span>${text}</span></div>`;
  }

  // ---------- records ----------
  function renderRecords() {
    if (!entries.length) return empty('No results yet.');
    const nm = (p) => esc(displayName[p] || p);
    const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ts < b.ts ? -1 : 1);

    // Best result ever in each game (ties: everyone who got it, earliest first).
    const bestRows = GAMES.map((g) => {
      const l = entries.filter((e) => e.game === g.id);
      if (!l.length) return '';
      const bv = g.better === 'higher' ? Math.max(...l.map((e) => e.value)) : Math.min(...l.map((e) => e.value));
      const holders = l.filter((e) => e.value === bv).sort(byDate);
      const who = [...new Set(holders.map((e) => e.player))];
      return `<tr><td>${g.emoji} ${esc(g.name)}</td><td class="num strong nowrap"><span class="has-tip"${tipAttr(holders[0])}>${esc(holders[0].display)}</span></td>
        <td>${who.map(nm).join(', ')}${holders.length > 1 ? ` <small class="muted">×${holders.length}</small>` : ''}<div class="muted rec-date">${holders.length > 1 ? 'first ' : ''}${shortDate(holders[0].date)}</div></td></tr>`;
    }).join('');

    // Player records: [emoji, title, value, sub, holders]
    const recs = [];
    const top = (items, key) => {
      const ok = items.filter((x) => key(x) > 0);
      if (!ok.length) return null;
      const best = Math.max(...ok.map(key));
      return { best, items: ok.filter((x) => key(x) === best) };
    };
    const players = Object.keys(displayName);
    // Dates for a record held on several days: each once, the first three, then "+N more".
    const dateList = (items) => {
      const ds = [...new Set(items.map((x) => x.date))].sort();
      return ds.slice(0, 3).map(shortDate).join(', ') + (ds.length > 3 ? ` +${ds.length - 3} more` : '');
    };
    const peak = top(players.filter((p) => ratings[p] && ratings[p].n), (p) => ratings[p].peak);
    if (peak) recs.push(['👑', 'Highest rating', String(Math.round(peak.best)), peak.items.map((p) => ratings[p].peakDate ? shortDate(ratings[p].peakDate) : '').join(', '), peak.items]);
    const streak = top(players, (p) => streakInfo(p, null).best);
    if (streak && streak.best > 1) recs.push(['🔥', 'Longest daily streak', `${streak.best} days`, 'days in a row with at least one game', streak.items]);
    // (Names can contain "|", so read the player and game from the values, not by splitting the keys.)
    const runs = Object.values(winRunBest).map((v) => ({ p: v.player, g: GAME_BY_ID[v.game], ...v }));
    const run = top(runs, (x) => x.n);
    if (run && run.best > 1) recs.push(['⚡', 'Longest win run', `${run.best} in a row`, run.items.map((x) => `${x.g.emoji} ${esc(x.g.name)}, ${shortDate(x.date)}`).join(' · '), run.items.map((x) => x.p)]);
    const days = [...groupBy(entries, (e) => e.player + '|' + e.date).values()].map((l) => ({ p: l[0].player, date: l[0].date, wins: l.filter((e) => e.won).length, games: l.length }));
    const wins = top(days, (x) => x.wins);
    if (wins) recs.push(['🏆', 'Most wins in a day', String(wins.best), dateList(wins.items), wins.items.map((x) => x.p)]);
    const games = top(days, (x) => x.games);
    if (games) recs.push(['🎮', 'Most games in a day', String(games.best), dateList(games.items), games.items.map((x) => x.p)]);
    const ptsDays = [...groupBy(entries, (e) => e.date).entries()].flatMap(([date, l]) => overall(l, 'points').map((s) => ({ p: s.player, date, pts: s.points })));
    const pts = top(ptsDays, (x) => x.pts);
    if (pts) recs.push(['💯', 'Most points in a day', String(pts.best), dateList(pts.items), pts.items.map((x) => x.p)]);
    const up = upsets.slice().sort((a, b) => b.gap - a.gap)[0];
    if (up) recs.push(['🎯', 'Biggest upset', `+${Math.round(up.gap)}`, `beat ${nm(up.loser.player)}, rated ${Math.round(up.gap)} higher, at ${GAME_BY_ID[up.e.game].emoji} ${esc(GAME_BY_ID[up.e.game].name)}, ${shortDate(up.e.date)}`, [up.e.player]]);
    const recHtml = recs
      .map(([emoji, title, value, sub, who]) => `<div class="rec"><span class="rec-e">${emoji}</span><div class="rec-body"><div class="rec-t">${title}</div>
        <div><b>${[...new Set(who)].map(nm).join(', ')}</b> <span class="muted">· ${sub}</span></div></div><div class="rec-v">${value}</div></div>`)
      .join('');

    // Hardest and easiest puzzles across all games (needs 4+ shared puzzles in a game to compare).
    const firstDate = {};
    for (const e of entries) { const k = e.game + '|' + e.puzzle; if (!firstDate[k] || e.date < firstDate[k]) firstDate[k] = e.date; }
    const ranked = Object.entries(puzzleDiff).filter(([, d]) => d.z !== 0);
    const pRow = ([k, d]) => {
      const [gid, puzzle] = k.split('|');
      const g = GAME_BY_ID[gid];
      const label = /^\d{4}-\d{2}-\d{2}$/.test(puzzle) ? '' : `#${esc(puzzle)}`;
      return `<tr><td>${g.emoji} ${esc(g.name)} <small class="muted">${label} · ${shortDate(firstDate[k])}</small></td><td class="num strong">${esc(fmtAvg(g, d.avg))}</td><td class="num">${d.n}</td></tr>`;
    };
    const pTable = (list, title) => list.length
      ? `<h3 class="game-h">${title}</h3><table class="pg-table"><tr><th>Puzzle</th><th class="num">Group avg</th><th class="num">Players</th></tr>${list.map(pRow).join('')}</table>`
      : '';
    const hardest = ranked.slice().sort((a, b) => b[1].z - a[1].z).filter(([, d]) => d.z > 0).slice(0, 5);
    const easiest = ranked.slice().sort((a, b) => a[1].z - b[1].z).filter(([, d]) => d.z < 0).slice(0, 5);
    const puzzles = hardest.length || easiest.length
      ? pTable(hardest, '🔥 Hardest puzzles ' + info("Compared with each game's other puzzles that two or more friends did (a game needs 4 of those first). Group avg is in the game's own units.")) + pTable(easiest, '🍰 Easiest puzzles')
      : '<h3 class="game-h">🔥 Hardest puzzles</h3><p class="muted empty">Needs 4 puzzles in a game that two or more friends did.</p>';

    return `<h3>🏅 Player records</h3><div class="recs">${recHtml}</div>
      <h3 class="game-h">⭐ Best ever, by game</h3><table class="pg-table"><tr><th>Game</th><th class="num">Record</th><th>Held by</th></tr>${bestRows}</table>
      ${puzzles}`;
  }

  // ---------- win celebration ----------
  function celebrate() {
    try { if (navigator.vibrate) navigator.vibrate([40, 60, 40]); } catch (e) { /* not supported */ }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = document.createElement('div');
    box.className = 'confetti';
    box.setAttribute('aria-hidden', 'true');
    const colors = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s7'];
    for (let i = 0; i < 90; i++) {
      const c = document.createElement('i');
      const st = c.style;
      st.left = Math.random() * 100 + '%';
      st.background = `var(${colors[i % colors.length]})`;
      st.width = 6 + Math.random() * 6 + 'px';
      st.height = 8 + Math.random() * 8 + 'px';
      st.setProperty('--dx', Math.random() * 160 - 80 + 'px');
      st.setProperty('--rot', Math.random() * 900 - 450 + 'deg');
      st.animationDelay = Math.random() * 0.5 + 's';
      st.animationDuration = 1.8 + Math.random() * 1.4 + 's';
      box.appendChild(c);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 4200);
  }

  // ---------- player profile ----------
  function headToHead(a, b) {
    const total = { a: 0, b: 0, tie: 0 };
    const byGame = {};
    const matches = [];
    const idx = new Map();
    for (const e of entries) {
      if (e.player !== a && e.player !== b) continue;
      const k = e.game + '|' + e.puzzle;
      if (!idx.has(k)) idx.set(k, {});
      idx.get(k)[e.player] = e;
    }
    for (const [k, v] of idx) {
      if (!v[a] || !v[b]) continue;
      const g = GAME_BY_ID[k.split('|')[0]];
      const diff = g.better === 'higher' ? v[a].value - v[b].value : v[b].value - v[a].value;
      const t = (byGame[g.id] = byGame[g.id] || { a: 0, b: 0, tie: 0 });
      const side = diff > 0 ? 'a' : diff < 0 ? 'b' : 'tie';
      t[side]++;
      total[side]++;
      const date = v[a].date > v[b].date ? v[a].date : v[b].date;
      matches.push({ g, puzzle: v[a].puzzle, date, ea: v[a], eb: v[b], side });
    }
    matches.sort((x, y) => (x.date !== y.date ? (x.date < y.date ? -1 : 1) : x.puzzle - y.puzzle));
    return { total, byGame, matches };
  }

  // Sparkline of a player's last 30 results in one game. Up is always better:
  // values are scaled with the game's own normalize(), so "lower is better" games read the same way.
  function trend(p, g) {
    const mine = entries
      .filter((e) => e.player === p && e.game === g.id)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .slice(-30);
    const pts = mine.map((e) => norm(e, g));
    if (pts.length < 2) return '';
    const W = 96, H = 22, pad = 3;
    const x = (i) => pad + (i * (W - 2 * pad)) / (pts.length - 1);
    const y = (v) => H - pad - v * (H - 2 * pad);
    const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const last = pts.length - 1;
    // Recent form: last 5 results vs the 5 before them.
    const avg = (a) => a.reduce((t, v) => t + v, 0) / a.length;
    const recent = pts.slice(-5), before = pts.slice(-10, -5);
    let arrow = '';
    if (before.length >= 2) {
      const d = avg(recent) - avg(before);
      if (d > 0.04) arrow = '<span class="up" title="Improving">▲</span>';
      else if (d < -0.04) arrow = '<span class="down" title="Slipping">▼</span>';
    }
    const label = `Last ${pts.length} results, up is better`;
    return `<div class="trend"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label}">
      <title>${label}</title><polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(last).toFixed(1)}" cy="${y(pts[last]).toFixed(1)}" r="2.4" fill="var(--accent)"/></svg>${arrow}</div>`;
  }

  // ---------- charts ----------
  // Player colors: fixed categorical slots (--s1…--s8 in style.css), handed out in the order players
  // first submitted, so someone's color never changes when a filter hides another player. Past 8: gray.
  const colorOf = (p) => {
    const i = Object.keys(displayName).indexOf(p);
    return i >= 0 && i < 8 ? `var(--s${i + 1})` : 'var(--muted)';
  };
  const pname = (p) => esc(displayName[p] || p);
  // Hover/tap details for chart marks reuse the result popover (#tip).
  const ctip = (html) => { tips.push({ html }); return ` data-tip="${tips.length - 1}"`; };
  // ⓘ next to a heading: hover (or tap) for the explanation that used to sit under the section.
  const info = (html) => `<button type="button" class="info" aria-label="How this works"${ctip(`<div class="info-body">${html}</div>`)}>i</button>`;
  // Same, for a table without a heading: the ⓘ goes in its empty top-left header cell.
  const withInfo = (tableHtml, note) => tableHtml.replace('<th></th>', `<th class="info-th">${info(note)}</th>`);
  const tipRow = (p, val) => `<div class="trow"><i class="key line" style="--c:${colorOf(p)}"></i><b>${val}</b> <span class="muted">${pname(p)}</span></div>`;
  const legendHtml = (players, kind = 'line', extra = '') =>
    `<div class="legend">${players.map((p) => `<span><i class="key ${kind}" style="--c:${colorOf(p)}"></i>${pname(p)}</span>`).join('')}${extra}</div>`;
  // Charts are drawn at the board's real pixel width so text stays readable on phones.
  const chartW = () => Math.max(280, Math.min(608, ($('#board') && $('#board').clientWidth) || 600));
  const shortDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const dowOf = (iso) => (new Date(iso + 'T12:00:00').getDay() + 6) % 7; // Monday = 0
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const niceStep = (v) => {
    const p = 10 ** Math.floor(Math.log10(Math.max(v, 1e-9)));
    for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  };
  const datesBetween = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };
  // Mix a color into the card background: pct 0 = card, 100 = full color. Keeps text readable on top.
  const tint = (c, pct) => `color-mix(in srgb, ${c} ${Math.round(Math.max(0, Math.min(100, pct)))}%, var(--card))`;

  // Multi-series line chart. xs = ISO dates; series = [{p, ys: [number | null for each x]}].
  // Hover anywhere in a date's column for every player's value on that date.
  function lineChart({ xs, series, yMin = 0, yMax, yTicks, yFmt = (v) => String(Math.round(v)), id, replay, label }) {
    const W = chartW(), H = 220;
    const padL = 36, padT = 12, padB = 24;
    const longest = Math.max(...series.map((s) => (displayName[s.p] || s.p).length));
    const padR = Math.min(92, 16 + longest * 6.6);
    const iw = W - padL - padR, ih = H - padT - padB, n = xs.length;
    const x = (i) => padL + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
    const y = (v) => padT + ih - ((v - yMin) / (yMax - yMin)) * ih;
    const f = (v) => v.toFixed(1);
    const grid = yTicks
      .map((t) => `<line x1="${padL}" x2="${padL + iw}" y1="${f(y(t))}" y2="${f(y(t))}" class="grid"/><text x="${padL - 6}" y="${f(y(t) + 4)}" class="ax" text-anchor="end">${yFmt(t)}</text>`)
      .join('');
    const xl = [...new Set([0, Math.floor((n - 1) / 2), n - 1])]
      .map((i) => `<text x="${f(x(i))}" y="${H - 6}" class="ax" text-anchor="${n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${shortDate(xs[i])}</text>`)
      .join('');
    const paths = series
      .map((s) => {
        let d = '', pen = false;
        s.ys.forEach((v, i) => {
          if (v == null) { pen = false; return; }
          d += `${pen ? 'L' : 'M'}${f(x(i))},${f(y(v))}`;
          pen = true;
        });
        return `<path d="${d}" class="ln" style="stroke:${colorOf(s.p)}"/>`;
      })
      .join('');
    const ends = series
      .map((s) => { let li = -1; s.ys.forEach((v, i) => { if (v != null) li = i; }); return { p: s.p, li, v: li >= 0 ? s.ys[li] : 0 }; })
      .filter((e) => e.li >= 0);
    const marks = ends.map((e) => `<circle cx="${f(x(e.li))}" cy="${f(y(e.v))}" r="4" class="mk" style="fill:${colorOf(e.p)}"/>`).join('');
    // Direct labels at the right edge, nudged apart so they never overlap.
    const labs = ends.map((e) => ({ ...e, ly: y(e.v) })).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < labs.length; i++) labs[i].ly = Math.max(labs[i].ly, labs[i - 1].ly + 13);
    const over = labs.length ? labs[labs.length - 1].ly - (padT + ih) : 0;
    if (over > 0) labs.forEach((l) => (l.ly -= over));
    const labels = labs.map((l) => `<text x="${padL + iw + 8}" y="${f(l.ly + 4)}" class="lab">${pname(l.p)}</text>`).join('');
    const colW = n === 1 ? iw : iw / (n - 1);
    const cols = xs
      .map((d, i) => {
        const rowsH = series
          .map((s) => ({ p: s.p, v: s.ys[i] }))
          .filter((r) => r.v != null)
          .sort((a, b) => b.v - a.v)
          .map((r) => tipRow(r.p, yFmt(r.v)))
          .join('');
        const x0 = Math.max(padL, x(i) - colW / 2), x1 = Math.min(padL + iw, x(i) + colW / 2);
        return `<rect class="xcol" x="${f(x0)}" y="${padT}" width="${f(Math.max(1, x1 - x0))}" height="${ih}"${ctip(`<div class="tip-head"><b>${shortDate(d)}</b></div>${rowsH || '<span class="muted">No data yet</span>'}`)}/>`;
      })
      .join('');
    const clip = replay
      ? `<defs><clipPath id="${id}-clip"><rect x="0" y="0" width="${W}" height="${H}"><animate attributeName="width" from="${padL}" to="${W}" dur="5s" begin="indefinite" fill="freeze"/></rect></clipPath></defs>`
      : '';
    return `<svg class="chart" id="${id}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${clip}${grid}${xl}
      <g${replay ? ` clip-path="url(#${id}-clip)"` : ''}>${paths}${marks}${labels}</g>${cols}</svg>`;
  }

  // Points race: cumulative points (same scoring as Points mode) per player over the selected range.
  function renderRace(es) {
    if (!es.length) return '';
    const dates = [...new Set(es.map((e) => e.date))].sort();
    const xs = datesBetween(dates[0], dates[dates.length - 1]);
    const daily = {};
    for (const list of groupBy(es, (e) => e.game + '|' + e.puzzle).values()) {
      for (const e of rankPuzzle(list, GAME_BY_ID[list[0].game])) {
        const m = (daily[e.player] = daily[e.player] || {});
        m[e.date] = (m[e.date] || 0) + (CFG.placementPoints[e.rank - 1] || 0);
      }
    }
    const players = Object.keys(displayName).filter((p) => daily[p]);
    const series = players.map((p) => { let c = 0; return { p, ys: xs.map((d) => (c += daily[p][d] || 0)) }; });
    const max = Math.max(1, ...series.map((s) => s.ys[s.ys.length - 1]));
    const step = niceStep(max / 4);
    const yMax = step * Math.ceil(max / step);
    const yTicks = [];
    for (let t = 0; t <= yMax; t += step) yTicks.push(t);
    const chart = lineChart({ xs, series, yMax, yTicks, id: 'race', replay: true, label: 'Cumulative points per player over time' });
    return `<div class="chart-head"><h3>🏁 Points race ${info(`Running total of points (${CFG.placementPoints.join('/')} for 1st/2nd/3rd on each puzzle) over the selected time range. Hover or tap a day for the standings then.`)}</h3>${xs.length > 1 ? '<button class="link" data-replay="race">▶ Replay</button>' : ''}</div>
      ${legendHtml(players)}<div class="chart-wrap">${chart}</div>`;
  }

  // Rolling win %: each player's win rate over their last 10 puzzles that a friend also played.
  function renderRollingWin(es, gameId) {
    const pool = gameId === 'all' ? es : es.filter((e) => e.game === gameId);
    const per = {};
    for (const list of groupBy(pool, (e) => e.game + '|' + e.puzzle).values()) {
      if (list.length < 2) continue;
      for (const e of rankPuzzle(list, GAME_BY_ID[list[0].game])) (per[e.player] = per[e.player] || []).push({ date: e.date, win: e.rank === 1 });
    }
    const dates = [...new Set(Object.values(per).flat().map((r) => r.date))].sort();
    if (dates.length < 2) return '';
    const WIN = 10, MIN = 3;
    const players = Object.keys(displayName).filter((p) => per[p]);
    const series = players.map((p) => {
      const list = per[p].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      return {
        p,
        ys: dates.map((d) => {
          const upto = list.filter((r) => r.date <= d).slice(-WIN);
          return upto.length >= MIN ? (100 * upto.filter((r) => r.win).length) / upto.length : null;
        }),
      };
    }).filter((s) => s.ys.some((v) => v != null));
    if (!series.length) return '';
    const chart = lineChart({ xs: dates, series, yMax: 100, yTicks: [0, 25, 50, 75, 100], yFmt: (v) => Math.round(v) + '%', id: 'wr-roll', label: 'Rolling win percentage per player' });
    return `<h3 class="game-h">📈 Win % over time ${info(`Each player's win % over their last ${WIN} puzzles that a friend also played, as of each day. A line starts once they have ${MIN}. Rising = heating up.`)}</h3>${legendHtml(series.map((s) => s.p))}<div class="chart-wrap">${chart}</div>`;
  }

  // Game popularity: plays per day for each game (small multiples on one shared scale), last 30 days of the range.
  function renderPopularity(es) {
    if (!es.length) return '';
    const today = localDate(new Date());
    const first = es.reduce((m, e) => (e.date < m ? e.date : m), today);
    const last = es.reduce((m, e) => (e.date > m ? e.date : m), first);
    const end = last > today ? last : today;
    const start = first > addDays(end, -29) ? first : addDays(end, -29);
    const days = datesBetween(start, end);
    const byGame = groupBy(es, (e) => e.game);
    const count = (list, d) => list.filter((e) => e.date === d);
    const maxDay = Math.max(1, ...[...byGame.values()].flatMap((list) => days.map((d) => count(list, d).length)));
    const W = Math.max(120, chartW() - 168), H = 28;
    const bw = W / days.length;
    const rows = GAMES.filter((g) => byGame.has(g.id))
      .map((g) => ({ g, list: byGame.get(g.id) }))
      .sort((a, b) => b.list.length - a.list.length)
      .map(({ g, list }) => {
        const bars = days
          .map((d, i) => {
            const day = count(list, d);
            const h = day.length ? Math.max(3, (day.length / maxDay) * (H - 2)) : 0;
            const who = day.map((e) => displayName[e.player] || e.player).join(', ');
            const tip = ctip(`<div class="tip-head">${g.emoji} ${esc(g.name)} · ${shortDate(d)}</div><b>${day.length}</b> play${day.length === 1 ? '' : 's'}${who ? `<div class="muted">${esc(who)}</div>` : ''}`);
            return `<g class="bar-hit"${tip}><rect x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}" class="hit"/>${
              h ? `<rect x="${(i * bw + 1).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" class="bar"/>` : `<rect x="${(i * bw + 1).toFixed(1)}" y="${H - 1}" width="${Math.max(1, bw - 2).toFixed(1)}" height="1" class="zero"/>`
            }</g>`;
          })
          .join('');
        const recent = list.filter((e) => e.date > addDays(end, -7)).length;
        const before = list.filter((e) => e.date > addDays(end, -14) && e.date <= addDays(end, -7)).length;
        const trendTxt = before >= 3 && recent <= before / 2 ? '<span class="pop-trend down" title="Played less than half as much this week as last week">↘ fading</span>'
          : recent >= 3 && recent >= before * 1.5 && before > 0 ? '<span class="pop-trend up" title="Played 50% more this week than last week">↗ rising</span>' : '';
        return `<div class="pop-row"><span class="pop-name">${g.emoji} ${esc(g.name)}${trendTxt}</span>
          <svg viewBox="0 0 ${W.toFixed(0)} ${H}" width="${W.toFixed(0)}" height="${H}" role="img" aria-label="${esc(g.name)} plays per day">${bars}</svg>
          <span class="pop-n" title="Plays in the selected range">${list.length}</span></div>`;
      })
      .join('');
    return `<h3>🎮 Game popularity ${info(`Plays per day, ${shortDate(start)} – ${shortDate(end)}, every game on the same scale (tallest bar = ${maxDay}). The number is total plays in the selected range. ↘ fading / ↗ rising compares the last 7 days with the 7 before.`)}</h3><div class="pop">${rows}</div>`;
  }

  // Who beats whom: every pair of players over the puzzles they both did.
  function renderMatrix(es) {
    const players = Object.keys(displayName).filter((p) => es.some((e) => e.player === p));
    if (players.length < 2) return '';
    const rec = {};
    const R = (a, b) => ((rec[a] = rec[a] || {})[b] = rec[a][b] || { w: 0, l: 0, t: 0 });
    for (const list of groupBy(es, (e) => e.game + '|' + e.puzzle).values()) {
      if (list.length < 2) continue;
      const g = GAME_BY_ID[list[0].game];
      for (const a of list) for (const b of list) {
        if (a.player === b.player) continue;
        const diff = g.better === 'higher' ? a.value - b.value : b.value - a.value;
        const r = R(a.player, b.player);
        if (diff > 0) r.w++; else if (diff < 0) r.l++; else r.t++;
      }
    }
    const short = (p) => esc((displayName[p] || p).slice(0, 7));
    const head = `<tr><th></th>${players.map((p) => `<th class="num" title="${pname(p)}">${short(p)}</th>`).join('')}</tr>`;
    const body = players
      .map((a) => `<tr><th class="mx-row">${pname(a)}</th>${players
        .map((b) => {
          if (a === b) return '<td class="mx-self"></td>';
          const r = rec[a] && rec[a][b];
          const n = r ? r.w + r.l + r.t : 0;
          if (!n) return '<td class="num muted">–</td>';
          const share = (r.w + r.t / 2) / n;
          const bg = tint(share >= 0.5 ? 'var(--div-pos)' : 'var(--div-neg)', Math.abs(share - 0.5) * 2 * 75);
          const tip = ctip(`<div class="tip-head"><b>${pname(a)}</b> vs ${pname(b)}</div><b>${r.w}–${r.l}</b>${r.t ? `, ${r.t} tied` : ''} over ${n} shared puzzle${n === 1 ? '' : 's'}<div class="muted">Tap to compare them</div>`);
          return `<td class="num mx-cell" style="background:${bg}" data-mx-a="${esc(a)}" data-mx-b="${esc(b)}"${tip}>${Math.round(share * 100)}%</td>`;
        })
        .join('')}</tr>`)
      .join('');
    return `<h3>⚔️ Who beats whom ${info(`Each row is that player's share of meetings won against the column player, on puzzles they both did (ties count half). Tap a cell to open their head to head.`)}</h3><div class="scroll-x"><table class="mx">${head}${body}</table></div>
      <div class="div-legend"><span>Loses more</span><i></i><span>Wins more</span></div>`;
  }

  // Day of week: average score (0–100) per weekday, colored by how it compares with that player's own average.
  function renderWeekday(es) {
    if (!es.length) return '';
    const players = Object.keys(displayName).filter((p) => es.some((e) => e.player === p));
    const sc = (e) => 100 * norm(e, GAME_BY_ID[e.game]);
    const row = (label, list, who) => {
      if (!list.length) return '';
      const base = mean(list.map(sc));
      const cells = DOW.map((d, i) => {
        const day = list.filter((e) => dowOf(e.date) === i);
        if (!day.length) return '<td class="num muted">–</td>';
        const avg = mean(day.map(sc));
        const diff = avg - base;
        const few = day.length < 3;
        const bg = tint(diff >= 0 ? 'var(--div-pos)' : 'var(--div-neg)', few ? 0 : Math.min(1, Math.abs(diff) / 15) * 75);
        const tip = ctip(`<div class="tip-head">${who} on ${d}s</div><b>${Math.round(avg)}</b> average over ${day.length} result${day.length === 1 ? '' : 's'}<div class="muted">${diff >= 0 ? '+' : '−'}${Math.abs(Math.round(diff))} vs their overall ${Math.round(base)}${few ? ' · too few results to color' : ''}</div>`);
        return `<td class="num hm-cell${few ? ' few' : ''}" style="background:${bg}"${tip}>${Math.round(avg)}</td>`;
      }).join('');
      return `<tr><th class="mx-row">${label}</th>${cells}</tr>`;
    };
    const body = row('<b>Everyone</b>', es, 'Everyone') + players.map((p) => row(pname(p), es.filter((e) => e.player === p), pname(p))).join('');
    return `<h3>📆 Day of the week ${info(`Average score on the 0–100 scale (as in Average mode) by the day the puzzle was for. Colors compare it with that row's own average; days with fewer than 3 results stay uncolored.`)}</h3><div class="scroll-x"><table class="mx hm"><tr><th></th>${DOW.map((d) => `<th class="num">${d}</th>`).join('')}</tr>${body}</table></div>
      <div class="div-legend"><span>Worse than usual</span><i></i><span>Better than usual</span></div>`;
  }

  // Time of day: when each player submits, in their own time zone.
  const hourFormats = {};
  function hourIn(ts, tz) {
    try {
      const k = tz || '';
      const fmt = hourFormats[k] || (hourFormats[k] = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', ...(tz ? { timeZone: tz } : {}) }));
      return Number(fmt.format(new Date(ts))) % 24;
    } catch (e) { return new Date(ts).getHours(); }
  }
  const fmtHour = (h) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
  function renderTimeOfDay(es) {
    const subs = new Map(); // one per submission, even if it held several games
    for (const e of es) if (e.ts) subs.set(e.player + '|' + e.ts, e);
    if (!subs.size) return '';
    const counts = {};
    for (const e of subs.values()) {
      const c = (counts[e.player] = counts[e.player] || new Array(24).fill(0));
      c[hourIn(e.ts, e.tz)]++;
    }
    const players = Object.keys(displayName).filter((p) => counts[p]);
    const rows = players
      .map((p) => {
        const c = counts[p];
        const max = Math.max(...c);
        const total = c.reduce((a, b) => a + b, 0);
        const peak = c.indexOf(max);
        const cells = c
          .map((v, h) => `<i class="tod-cell" style="background:${v ? tint(colorOf(p), 20 + 80 * (v / max)) : 'var(--line)'}"${ctip(`<div class="tip-head">${pname(p)} · ${fmtHour(h)}–${fmtHour((h + 1) % 24)}</div><b>${v}</b> of ${total} submission${total === 1 ? '' : 's'}`)}></i>`)
          .join('');
        return `<div class="tod-row"><span class="tod-name">${pname(p)}<small class="muted">usually ${fmtHour(peak)}</small></span><div class="tod-strip">${cells}</div></div>`;
      })
      .join('');
    const axis = `<div class="tod-row tod-axis"><span class="tod-name"></span><div class="tod-strip">${[0, 6, 12, 18].map((h) => `<span style="grid-column:${h + 1} / span 6">${fmtHour(h)}</span>`).join('')}</div></div>`;
    return `<h3>🕘 Time of day ${info(`When each person submits, by hour in their own time zone (older submissions without a saved time zone use this device's). Each row is shaded against that person's busiest hour.`)}</h3><div class="tod">${rows}${axis}</div>`;
  }

  function renderCharts(es) {
    if (!es.length) return empty();
    return [renderRace(es), renderPopularity(es), renderMatrix(es), renderWeekday(es), renderTimeOfDay(es)].filter(Boolean).join('');
  }

  // ---------- profile charts ----------
  // Calendar heatmap: one square per day, GitHub style.
  function renderCalendar(p) {
    const mine = entries.filter((e) => e.player === p);
    if (!mine.length) return '';
    const byDay = groupBy(mine, (e) => e.date);
    const today = localDate(new Date());
    const W = chartW();
    // From their first play (at least 8 weeks, so a new player still sees a calendar), up to what fits.
    const first = mine.reduce((m, e) => (e.date < m ? e.date : m), today);
    const since = Math.floor((new Date(today + 'T12:00:00') - new Date(first + 'T12:00:00')) / 864e5 / 7) + 2;
    const weeks = Math.max(8, Math.min(since, 26, Math.floor((W - 34) / 16)));
    const c = Math.min(15, Math.floor((W - 34) / weeks) - 3), gap = 3, top = 16, left = 30;
    const start = addDays(today, -dowOf(today) - 7 * (weeks - 1));
    const mode = state.calMode;
    const sc = (e) => norm(e, GAME_BY_ID[e.game]);
    const maxCount = Math.max(1, ...[...byDay.values()].map((l) => l.length));
    let cells = '', months = '', lastMonth = '', lastLabelW = -9;
    for (let w = 0; w < weeks; w++) {
      const wkStart = addDays(start, w * 7);
      const mo = new Date(wkStart + 'T12:00:00').toLocaleDateString(undefined, { month: 'short' });
      if (mo !== lastMonth) {
        // Label a month at its first week, as long as it doesn't crowd the previous label or the right edge.
        if (w - lastLabelW >= 3 && w <= weeks - 2) { months += `<text x="${left + w * (c + gap)}" y="11" class="ax">${mo}</text>`; lastLabelW = w; }
        lastMonth = mo;
      }
      for (let d = 0; d < 7; d++) {
        const date = addDays(start, w * 7 + d);
        if (date > today) continue;
        const list = byDay.get(date) || [];
        const avg = list.length ? 100 * mean(list.map(sc)) : 0;
        const v = mode === 'score' ? avg / 100 : list.length / maxCount;
        const fill = list.length ? tint('var(--s1)', 25 + 75 * v) : 'var(--line)';
        const games = list.map((e) => GAME_BY_ID[e.game].emoji).join(' ');
        const tip = ctip(`<div class="tip-head">${prettyDate(date)}</div>${list.length ? `<b>${list.length}</b> game${list.length === 1 ? '' : 's'} · average <b>${Math.round(avg)}</b><div>${games}</div>` : '<span class="muted">Nothing played</span>'}`);
        cells += `<rect x="${left + w * (c + gap)}" y="${top + d * (c + gap)}" width="${c}" height="${c}" rx="3" class="cal${date === today ? ' today' : ''}" style="fill:${fill}"${tip}/>`;
      }
    }
    const dl = [0, 2, 4].map((d) => `<text x="0" y="${top + d * (c + gap) + c - 3}" class="ax">${DOW[d]}</text>`).join('');
    const SW = left + weeks * (c + gap), SH = top + 7 * (c + gap);
    const seg = `<div class="seg small" role="group" aria-label="Color days by"><button data-cal="count" class="${mode !== 'score' ? 'on' : ''}">Games played</button><button data-cal="score" class="${mode === 'score' ? 'on' : ''}">Avg score</button></div>`;
    const scale = [0, 0.25, 0.5, 0.75, 1].map((v, i) => `<i style="background:${i ? tint('var(--s1)', 25 + 75 * v) : 'var(--line)'}"></i>`).join('');
    return `<div class="chart-head"><h3>🗓️ Activity</h3>${seg}</div>
      <div class="scroll-x"><svg class="chart" viewBox="0 0 ${SW} ${SH}" width="${SW}" height="${SH}" role="img" aria-label="Days played over the last ${weeks} weeks">${months}${dl}${cells}</svg></div>
      <div class="cal-legend"><span>${mode === 'score' ? 'Low' : 'Fewer'}</span>${scale}<span>${mode === 'score' ? 'High' : 'More'}</span></div>`;
  }

  // This player's Elo rating over time.
  function renderRatingChart(p) {
    const x = ratings[p];
    if (!x || x.hist.length < 2) return '';
    const today = localDate(new Date());
    const xs = datesBetween(addDays(x.hist[0].date, -1), today);
    const ys = xs.map((d) => ratingOn(p, d));
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const step = niceStep(Math.max(20, hi - lo) / 4);
    const yMin = Math.floor(lo / step) * step, yMax = Math.ceil(hi / step) * step + (Math.ceil(hi / step) * step === hi ? step : 0);
    const yTicks = [];
    for (let t = yMin; t <= yMax + 1e-9; t += step) yTicks.push(t);
    return `<h3>📈 Rating ${info(`Elo rating from every puzzle a friend also did (everyone starts at ${ELO_START}). Peak ${Math.round(x.peak)}${x.peakDate ? ` on ${shortDate(x.peakDate)}` : ''}, over ${x.n} matches. See Overall → Rating for how it works.`)}</h3><div class="chart-wrap">${lineChart({ xs, series: [{ p, ys }], yMin, yMax, yTicks, id: 'p-elo', label: 'Rating over time' })}</div>`;
  }

  // Radar: average score (0–100) in each game they play, against a friend (head to head pick) or the group.
  function renderRadar(p) {
    const avgOf = (pl, g) => {
      const l = entries.filter((e) => e.player === pl && e.game === g.id);
      return l.length ? { v: 100 * mean(l.map((e) => norm(e, g))), n: l.length } : null;
    };
    const games = GAMES.filter((g) => entries.some((e) => e.player === p && e.game === g.id));
    if (games.length < 3) return `<h3>🕸️ Strengths</h3><p class="muted empty">Needs results in at least 3 different games.</p>`;
    const friend = state.h2h && state.h2h !== p && entries.some((e) => e.player === state.h2h) ? state.h2h : null;
    const mineV = games.map((g) => avgOf(p, g));
    const otherV = games.map((g) => {
      if (friend) return avgOf(friend, g);
      const l = entries.filter((e) => e.game === g.id);
      return { v: 100 * mean(l.map((e) => norm(e, g))), n: l.length };
    });
    const W = Math.min(chartW(), 380), H = W, cx = W / 2, cy = H / 2, R = W / 2 - 30;
    const ang = (i) => -Math.PI / 2 + (2 * Math.PI * i) / games.length;
    const pt = (i, v) => [cx + Math.cos(ang(i)) * R * (v / 100), cy + Math.sin(ang(i)) * R * (v / 100)];
    const poly = (vals) => vals.map((o, i) => pt(i, o ? o.v : 0).map((n) => n.toFixed(1)).join(',')).join(' ');
    const rings = [25, 50, 75, 100].map((r) => `<polygon points="${games.map((_, i) => pt(i, r).map((n) => n.toFixed(1)).join(',')).join(' ')}" class="ring"/>`).join('');
    const ringLabels = [50, 100].map((r) => { const [x, y] = pt(0, r); return `<text x="${(x + 4).toFixed(1)}" y="${(y + 10).toFixed(1)}" class="ax">${r}</text>`; }).join('');
    const spokes = games.map((_, i) => { const [x, y] = pt(i, 100); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="ring"/>`; }).join('');
    const otherName = friend ? pname(friend) : 'Group average';
    const otherStyle = friend ? `stroke:${colorOf(friend)};fill:${tint(colorOf(friend), 12)}` : 'stroke:var(--muted);fill:none;stroke-dasharray:4 4';
    const fmtV = (o) => (o ? `<b>${Math.round(o.v)}</b> <span class="muted">(${o.n} result${o.n === 1 ? '' : 's'})</span>` : '<span class="muted">not played</span>');
    const axes = games
      .map((g, i) => {
        const [x, y] = pt(i, 118);
        const tip = ctip(`<div class="tip-head">${g.emoji} ${esc(g.name)}</div><div class="trow"><i class="key line" style="--c:${colorOf(p)}"></i>${fmtV(mineV[i])} ${pname(p)}</div><div class="trow"><i class="key line" style="--c:${friend ? colorOf(friend) : 'var(--muted)'}"></i>${fmtV(otherV[i])} ${otherName}</div>`);
        return `<g class="ax-hit"${tip}><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="16" class="hit"/><text x="${x.toFixed(1)}" y="${(y + 6).toFixed(1)}" text-anchor="middle" class="ax-emoji">${g.emoji}</text></g>`;
      })
      .join('');
    const dots = mineV.map((o, i) => { const [x, y] = pt(i, o ? o.v : 0); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" class="mk" style="fill:${colorOf(p)}"/>`; }).join('');
    const legend = `<div class="legend"><span><i class="key line" style="--c:${colorOf(p)}"></i>${pname(p)}</span><span><i class="key line${friend ? '' : ' dash'}" style="--c:${friend ? colorOf(friend) : 'var(--muted)'}"></i>${otherName}</span></div>`;
    return `<h3>🕸️ Strengths ${info(`Average score on the 0–100 scale in each game (further out = better). ${friend ? 'Compared with the friend picked under Head to head.' : 'Pick a friend under Head to head to compare with them instead of the group.'} Hover or tap an emoji for the numbers.`)}</h3>${legend}<div class="chart-wrap center"><svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Average score per game">
      ${rings}${spokes}${ringLabels}<polygon points="${poly(otherV)}" class="area" style="${otherStyle}"/><polygon points="${poly(mineV)}" class="area" style="stroke:${colorOf(p)};fill:${tint(colorOf(p), 22)}"/>${dots}${axes}</svg></div>`;
  }

  // Score distribution: how often they get each result, per game (small multiples).
  function renderDistributions(p) {
    const cards = GAMES.map((g) => {
      const mine = entries.filter((e) => e.player === p && e.game === g.id);
      if (mine.length < 3) return '';
      const everyone = entries.filter((e) => e.game === g.id).map((e) => e.value);
      const distinct = [...new Set(everyone)].sort((a, b) => a - b);
      let bins;
      if (g.failValue) {
        bins = [];
        for (let v = 1; v < g.failValue; v++) bins.push({ label: String(v), test: (x) => x === v });
        bins.push({ label: 'X', test: (x) => x >= g.failValue });
      } else if (distinct.every(Number.isInteger) && distinct[distinct.length - 1] - distinct[0] <= 12) { // small counts, e.g. steps or guesses
        bins = distinct.map((v) => ({ label: String(v), test: (x) => x === v }));
      } else {
        const lo = Math.min(...everyone), hi = Math.max(...everyone), k = 6, w = (hi - lo) / k || 1;
        bins = Array.from({ length: k }, (_, i) => {
          const a = lo + i * w, b = i === k - 1 ? Infinity : lo + (i + 1) * w;
          return { label: i === 0 ? g.formatValue(lo).replace(/\.0+$/, '') : i === k - 1 ? g.formatValue(hi).replace(/\.0+$/, '') : '', range: `${g.formatValue(a).replace(/\.0+$/, '')}–${g.formatValue(Math.min(hi, lo + (i + 1) * w)).replace(/\.0+$/, '')}`, test: (x) => x >= a && x < b };
        });
      }
      const counts = bins.map((b) => mine.filter((e) => b.test(e.value)).length);
      const max = Math.max(1, ...counts);
      const W = 160, H = 72, top = 6, base = H - 16, bw = W / bins.length;
      const bars = bins
        .map((b, i) => {
          const h = counts[i] ? Math.max(3, (counts[i] / max) * (base - top)) : 0;
          const tip = ctip(`<div class="tip-head">${g.emoji} ${esc(g.name)} · ${esc(b.range || b.label)}</div><b>${counts[i]}</b> of ${mine.length} (${Math.round((100 * counts[i]) / mine.length)}%)`);
          const showLab = !!b.label;
          const anchor = b.range ? (i === 0 ? 'start' : 'end') : 'middle';
          const lx = b.range ? (i === 0 ? i * bw + 2 : (i + 1) * bw - 2) : i * bw + bw / 2;
          return `<g class="bar-hit"${tip}><rect x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}" class="hit"/>${
            h ? `<rect x="${(i * bw + 2).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="bar"/>` : `<rect x="${(i * bw + 2).toFixed(1)}" y="${base - 1}" width="${(bw - 4).toFixed(1)}" height="1" class="zero"/>`
          }${showLab ? `<text x="${lx.toFixed(1)}" y="${H - 3}" text-anchor="${anchor}" class="ax">${esc(b.label)}</text>` : ''}</g>`;
        })
        .join('');
      const dir = g.better === 'higher' ? 'better →' : '← better';
      return `<div class="dist"><div class="dist-h">${g.emoji} ${esc(g.name)}<small class="muted">${mine.length} plays · ${dir}</small></div>
        <svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(g.name)} score distribution">${bars}</svg></div>`;
    }).filter(Boolean);
    if (!cards.length) return '';
    return `<h3>📊 Score spread ${info(`How often they got each result, for games with 3 or more plays. Hover or tap a bar for the count.`)}</h3><div class="dist-grid">${cards.join('')}</div>`;
  }

  // One day of this player's results at a time (arrows step between days they played), with placement, time and details.
  function renderHistory(p) {
    const mine = entries.filter((e) => e.player === p);
    if (!mine.length) return '';
    const days = [...new Set(mine.map((e) => e.date))].sort(); // oldest → newest
    const date = days.includes(state.histDay) ? state.histDay : days[days.length - 1];
    const i = days.indexOf(date);
    const nav = `<div class="daynav"><button data-hist-day="${i > 0 ? days[i - 1] : ''}" aria-label="Earlier day" ${i === 0 ? 'disabled' : ''}>‹</button>
      <strong>${prettyDate(date)}</strong>
      <button data-hist-day="${i < days.length - 1 ? days[i + 1] : ''}" aria-label="Later day" ${i === days.length - 1 ? 'disabled' : ''}>›</button></div>`;
    const list = mine.filter((e) => e.date === date).sort((a, b) => (a.ts < b.ts ? -1 : 1));
    const placeOf = (e) => {
      const l = rankPuzzle(entries.filter((x) => x.game === e.game && x.puzzle === e.puzzle), GAME_BY_ID[e.game]);
      const me = l.find((x) => x.player === p);
      return { rank: me ? me.rank : 0, n: l.length };
    };
    const items = list
      .map((e) => {
        const g = GAME_BY_ID[e.game];
        const d = e.detail || {};
        const pl = placeOf(e);
        const place = pl.n < 2 ? '<span class="muted">solo</span>' : `${medal(pl.rank)} <span class="muted">of ${pl.n}</span>`;
        const time = e.ts ? new Date(e.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
        const rows = (d.rows || []).map((r) => `<span class="hchip">${esc(r.label)} ${esc(r.mark || '')} <b>${esc(r.value)}</b></span>`).join('');
        const grid = (d.grid || []).length ? `<div class="hgrid">${d.grid.map((l) => `<div>${esc(l)}</div>`).join('')}</div>` : '';
        const note = d.note ? `<div class="muted hnote">${esc(d.note)}</div>` : '';
        return `<div class="hist-item"><div class="hist-top"><span>${g.emoji} ${esc(g.name)} <small class="muted">#${esc(e.puzzle)}</small></span>
          <span><b class="has-tip"${tipAttr(e)}>${esc(e.display)}</b>${vsMark(e)}${startMark(e)}</span><span class="hplace">${place}</span></div>
          ${time ? `<div class="muted htime">⏱ Submitted ${esc(time)}${e.moved ? ` · puzzle is ${esc(dayWord(e.puzzleDate))}'s` : ''}</div>` : ''}
          ${rows ? `<div class="hchips">${rows}</div>` : ''}${grid}${note}</div>`;
      })
      .join('');
    return `<h3>History <span class="muted">${mine.length} result${mine.length === 1 ? '' : 's'} · ${days.length} day${days.length === 1 ? '' : 's'}</span></h3>${nav}<div class="hist-card">${items}</div>`;
  }

  function renderProfile() {
    const p = state.profile;
    const back = '<button class="link back" data-back="1">‹ Back</button>';
    if (!p || !entries.some((e) => e.player === p)) return back + empty('No results for this player yet.');
    const name = esc(displayName[p] || p);
    const all = overall(entries, 'points');
    const ov = all.find((s) => s.player === p);
    const st = streakInfo(p, null);
    const stats = [
      ['Overall rank', ov.rank ? '#' + ov.rank : '–'],
      ['Points', ov.points],
      ['Wins', ov.wins],
      ['Played', ov.played],
      ['Streak', `${st.cur ? `🔥 ${st.cur}` : '0'}<small> best ${st.best}</small>`],
      ['Rating', ratings[p] && ratings[p].n ? `${Math.round(ratings[p].r)}<small> peak ${Math.round(ratings[p].peak)}</small>` : '–'],
    ]
      .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`)
      .join('');

    const form = formOf(p);
    const label = !form ? '' : form.score >= 40 ? 'Way above usual' : form.score >= 15 ? 'Above usual' : form.score > -15 ? 'Right at usual' : form.score > -40 ? 'Below usual' : 'Way below usual';
    const formHtml = form
      ? meterHtml({
          score: form.score,
          emoji: form.score >= 15 ? '🍀' : form.score <= -15 ? '☁️' : '😐',
          label: `Form: ${label}`,
          note: `Their last ${form.n} results compared with their own earlier results in each game (${form.diff >= 0 ? '+' : '−'}${Math.abs(Math.round(form.diff))} points on average).`,
        })
      : `<div class="form"><p class="note">Form needs a few more plays: a game has to have ${CFG.minForUsual} earlier results before a new one can be compared with their usual.</p></div>`;
    const luck = startLuck(p);
    const luckHtml = luck
      ? meterHtml({
          score: luck.score,
          emoji: luck.score >= 15 ? '✨' : luck.score <= -15 ? '🌧️' : '🎲',
          label: `Luck: ${luck.score >= 40 ? 'Very lucky starts' : luck.score >= 15 ? 'Lucky starts' : luck.score > -15 ? 'Average starts' : luck.score > -40 ? 'Unlucky starts' : 'Very unlucky starts'}`,
          note: `Over their last ${luck.n} results, their opening guess was better than ${Math.round(luck.pct)}% of all openings on average. Based on the first guess in Wordle, Nerdle, Tradle, Spotle, Globle and Poople.`,
        })
      : `<div class="form"><p class="note">Luck needs 3 results from games with a visible first guess (Wordle, Nerdle, Tradle, Spotle, Globle, Poople), and ${CFG.minForStartRank} openings in a game from everyone to compare against.</p></div>`;
    const badges = badgesOf(p);
    const earned = badges.filter((b) => b.got).length;
    const badgeOne = (b) => `<span class="badge${b.got ? ' got' : ''}" title="${esc(b.desc)}${b.got && b.count > 1 ? (b.times ? ` Earned ${b.count} times.` : ` Best: ${b.count}.`) : ''}"><span class="be">${b.got ? b.emoji : '🔒'}</span> ${esc(b.name)}${b.got && b.times && b.count > 1 ? ` <small>×${b.count}</small>` : ''}</span>`;
    const locked = badges.filter((b) => !b.got);
    const badgeHtml = `<h3>Badges <span class="muted">${earned} of ${badges.length}</span></h3>
      ${earned ? `<div class="badges">${badges.filter((b) => b.got).map(badgeOne).join('')}</div>` : '<p class="muted">None yet.</p>'}
      ${locked.length ? `<details class="more"><summary>${locked.length} still to unlock</summary><div class="badges">${locked.map(badgeOne).join('')}</div></details>` : ''}`;
    const rv = rivalries(p);
    const nameOf = (o) => esc(displayName[o] || o);
    let rivalBody = `<p class="muted empty">Needs ${CFG.minForRival} shared puzzles with someone.</p>`;
    if (rv) {
      // One row per opponent, even if they're both the closest rival and the nemesis.
      const byOpp = new Map();
      for (const [emoji, label, x] of [['⚔️', 'Closest rival', rv.closest], ['😤', 'Nemesis', rv.nemesis], ['😎', 'Favourite opponent', rv.victim]]) {
        if (!x) continue;
        if (!byOpp.has(x.o)) byOpp.set(x.o, { x, emojis: [], labels: [] });
        byOpp.get(x.o).emojis.push(emoji);
        byOpp.get(x.o).labels.push(label);
      }
      rivalBody = [...byOpp.values()]
        .map(({ x, emojis, labels }) => `<div class="rival"><span class="re">${emojis.join('')}</span><div><span class="muted">${labels.join(' · ')}</span>
          <button class="plink" data-rival="${esc(x.o)}"><b>${nameOf(x.o)}</b></button>
          <div class="muted">${name} ${x.a} – ${x.b} ${nameOf(x.o)}${x.tie ? ` (${x.tie} tied)` : ''} over ${x.n} shared puzzles</div></div></div>`)
        .join('');
    }
    const rivalHtml = rv ? `<h3>Rivalries ${info('Based on puzzles you both did. Tap a name to compare head to head.')}</h3><div class="rivals">${rivalBody}</div>` : `<h3>Rivalries</h3>${rivalBody}`;
    const hot = hotGames(p);
    const hotHtml = hot.length
      ? `<div class="hot-row">⚡ <b>Hot streak:</b> ${hot.map(([g, n]) => `${g.emoji} ${esc(g.name)} ×${n}`).join(' · ')}</div>`
      : '';

    const gameRows = GAMES.map((g) => {
      const list = perGame(entries, g);
      const s = list.find((x) => x.player === p);
      if (!s) return '';
      const gs = streakInfo(p, g.id).cur;
      const hn = hotFor(p, g.id);
      const best = g.failValue && s.best >= g.failValue ? 'X' : g.formatValue(s.best).replace(/\.00$/, '');
      return `<tr><td>${g.emoji} ${esc(g.name)}${trend(p, g)}</td><td class="num">${medal(s.rank)}</td><td class="num strong">${g.formatValue(s.avg)}</td>
        <td class="num">${best}</td><td class="num">${s.wins}</td><td class="num">${s.played}${gs >= 2 || hn ? `<div class="badge-line">${gs >= 2 ? `<span class="streak">🔥${gs}</span>` : ''}${hn ? ` <span class="hotb" title="${hn} wins in a row">⚡${hn}</span>` : ''}</div>` : ''}</td></tr>`;
    }).join('');
    const perGameTable = `<h3>By game (all time)</h3><table class="pg-table"><tr><th>Game</th><th class="num">Rank</th><th class="num">Avg</th><th class="num">Best</th><th class="num">Wins</th><th class="num">Played</th></tr>${gameRows}</table>`;

    const others = Object.keys(displayName).filter((x) => x !== p).sort((x, y) => displayName[x].localeCompare(displayName[y]));
    const opts = ['<option value="">Pick a friend…</option>']
      .concat(others.map((o) => `<option value="${esc(o)}"${o === state.h2h ? ' selected' : ''}>${esc(displayName[o])}</option>`))
      .join('');
    let h2h = '';
    if (state.h2h && state.h2h !== p) {
      const r = headToHead(p, state.h2h);
      const other = esc(displayName[state.h2h] || state.h2h);
      const line = (label, t) => `<tr><td>${label}</td><td class="num strong">${t.a}</td><td class="num strong">${t.b}</td><td class="num">${t.tie}</td></tr>`;
      const games = GAMES.filter((g) => r.byGame[g.id]).map((g) => line(`${g.emoji} ${esc(g.name)}`, r.byGame[g.id])).join('');
      const n = r.total.a + r.total.b + r.total.tie;
      const pct = (v) => ((100 * v) / n).toFixed(1);
      const bar = n
        ? `<div class="h2h-bar" role="img" aria-label="${name} won ${r.total.a}, ${other} won ${r.total.b}, ${r.total.tie} ties">
            <span class="a" style="width:${pct(r.total.a)}%"></span><span class="t" style="width:${pct(r.total.tie)}%"></span><span class="b" style="width:${pct(r.total.b)}%"></span></div>
           <div class="h2h-legend"><span>${name} ${pct(r.total.a)}%</span><span>${other} ${pct(r.total.b)}%</span></div>`
        : '';
      let hist = '';
      if (n) {
        const ms = r.matches;
        const side = (m) => (m.side === 'a' ? 'a' : m.side === 'b' ? 'b' : 't');
        const dot = (m) => `<span class="hd ${side(m)}" title="${esc(m.g.name)} #${esc(m.puzzle)} · ${prettyDate(m.date)}: ${esc(m.ea.display)} vs ${esc(m.eb.display)} (${m.side === 'a' ? `${esc(displayName[p] || p)} won` : m.side === 'b' ? `${esc(displayName[state.h2h] || state.h2h)} won` : 'tie'})"></span>`;
        // current run and longest runs of outright wins
        let cur = 0, curSide = '', bestA = 0, bestB = 0, runA = 0, runB = 0;
        for (const m of ms) {
          runA = m.side === 'a' ? runA + 1 : 0;
          runB = m.side === 'b' ? runB + 1 : 0;
          bestA = Math.max(bestA, runA);
          bestB = Math.max(bestB, runB);
        }
        for (let i = ms.length - 1; i >= 0; i--) {
          if (ms[i].side === 't') { if (!cur) continue; else break; }
          if (!cur) { curSide = ms[i].side; }
          if (ms[i].side !== curSide) break;
          cur++;
        }
        const runLine = cur >= 2 ? `${curSide === 'a' ? name : other} has won the last ${cur} meetings. ` : '';
        const strip = ms.slice(-40).map(dot).join('');
        const recent = ms.slice(-10).reverse().map((m) => {
          const mark = m.side === 'a' ? '🟢' : m.side === 'b' ? '🟣' : '⚪';
          return `<tr><td>${mark}</td><td>${m.g.emoji} ${esc(m.g.name)} <small class="muted">#${esc(m.puzzle)} · ${prettyDate(m.date)}</small></td>
            <td class="num"><span class="has-tip"${tipAttr(m.ea)}>${esc(m.ea.display)}</span></td><td class="num"><span class="has-tip"${tipAttr(m.eb)}>${esc(m.eb.display)}</span></td></tr>`;
        }).join('');
        hist = `<h4 class="h2h-sub">Meeting history</h4>
          <div class="h2h-strip" aria-label="Each shared puzzle, oldest to newest">${strip}</div>
          <p class="note">${ms.length > 40 ? 'Last 40 meetings, oldest → newest. ' : 'Oldest → newest. '}<span class="k a"></span> ${name} <span class="k b"></span> ${other} <span class="k t"></span> tie. ${runLine}Longest win runs: ${name} ${bestA}, ${other} ${bestB}.</p>
          <table class="pg-table"><tr><th></th><th>Latest meetings</th><th class="num">${name}</th><th class="num">${other}</th></tr>${recent}</table>`;
      }
      h2h = n
        ? `${bar}<table><tr><th>Same puzzle</th><th class="num">${name}</th><th class="num">${other}</th><th class="num">Tie</th></tr>${games}${line('<b>Total</b>', r.total)}</table>${hist}`
        : `<p class="muted empty">You haven't played any of the same puzzles yet.</p>`;
    }
    const sections = [['overview', 'Overview'], ['charts', 'Charts'], ['h2h', 'Head to head'], ['history', 'History']];
    const pt = sections.some(([k]) => k === state.ptab) ? state.ptab : 'overview';
    const nav = `<div class="seg pseg" role="tablist" aria-label="Profile sections">${sections
      .map(([k, label]) => `<button data-ptab="${k}" role="tab" aria-selected="${k === pt}" class="${k === pt ? 'on' : ''}">${label}</button>`)
      .join('')}</div>`;
    let body;
    if (pt === 'charts') body = renderCalendar(p) + renderRatingChart(p) + renderRadar(p) + renderDistributions(p);
    else if (pt === 'h2h') body = `<h3>Head to head</h3><select id="h2h" aria-label="Compare with">${opts}</select>${h2h}`;
    else if (pt === 'history') body = renderHistory(p) || empty('No results yet.');
    else body = formHtml + luckHtml + badgeHtml + rivalHtml + perGameTable;
    return `${back}<h2 class="ptitle">${name}</h2><div class="stats">${stats}</div>${hotHtml}${nav}<div class="psec">${body}</div>`;
  }

  function render() {
    tips = [];
    // Emoji grids: one row on wide screens, two even rows on phones.
    document.documentElement.style.setProperty('--icons', GAMES.length);
    document.documentElement.style.setProperty('--icons-half', Math.ceil(GAMES.length / 2));
    hideTip();
    document.title = CFG.title + ' Leaderboard';
    $('#title').textContent = CFG.title;
    $('#me-name').textContent = getName() || '—';
    renderAvatar();
    renderTabs();
    renderToday();
    if (!loaded) { $('#board').innerHTML = skeletonHtml(); return; }
    const es = entries.filter(inRange);
    let html;
    if (state.tab === 'overall') html = renderOverall(es);
    else if (state.tab === 'recent') html = renderRecent(es);
    else if (state.tab === 'daily') html = renderDaily();
    else if (state.tab === 'weekly') html = renderWeekly();
    else if (state.tab === 'charts') html = renderCharts(es);
    else if (state.tab === 'records') html = renderRecords();
    else if (state.tab === 'profile') html = renderProfile();
    else html = renderGame(es, GAME_BY_ID[state.tab]);
    $('#board').innerHTML = html;
    // Your own row stands out in every table.
    for (const td of $('#board').querySelectorAll('td.name.is-me')) td.parentElement.classList.add('me-row');
    animateView();
  }

  // ---------- transitions ----------
  // When the view changes (tab, mode, range, player…), fade the board in and count the headline numbers up.
  // Re-renders of the same view (resizing, toggling a chart option) don't animate.
  let lastView = '';
  function animateView() {
    const key = [state.tab, state.mode, state.range, state.profile, state.ptab, state.wrGame, state.day, state.week, state.h2h, state.histDay].join('|');
    if (key === lastView) return;
    lastView = key;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const b = $('#board');
    b.classList.remove('enter');
    void b.offsetWidth; // restart the animation
    b.classList.add('enter');
    countUp(b);
  }
  function countUp(root) {
    const els = [...root.querySelectorAll('td.num.strong, .stat > b, .rec-v')].slice(0, 60);
    const jobs = [];
    for (const el of els) {
      const node = el.firstChild;
      if (!node || node.nodeType !== 3) continue; // only plain numbers, not cells holding a popover
      const m = node.textContent.trim().match(/^(#|\+)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(%)?$/);
      if (!m) continue;
      const target = Number((m[2] + (m[3] || '')).replace(/,/g, ''));
      if (!(target > 0)) continue;
      const dec = m[3] ? m[3].length - 1 : 0;
      const comma = m[2].includes(',');
      jobs.push({ node, target, dec, comma, pre: m[1] || '', post: m[4] || '' });
    }
    if (!jobs.length) return;
    const t0 = performance.now(), dur = 450;
    const fmt = (j, v) => j.pre + (j.comma ? Math.round(v).toLocaleString('en-US') : v.toFixed(j.dec)) + j.post;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur), ease = 1 - (1 - k) ** 3;
      for (const j of jobs) j.node.textContent = fmt(j, j.target * ease);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const empty = (msg) => `<p class="muted empty">${msg || 'No results in this range yet.'}</p>`;
  const ordinal = (n) => n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n] || 'th');
  // "yesterday" / "today" / "Thu, Nov 12", for use inside a sentence.
  const dayWord = (iso) => { const w = prettyDate(iso); return w === 'Today' || w === 'Yesterday' ? w.toLowerCase() : w; };
  function prettyDate(iso) {
    const today = localDate(new Date());
    if (iso === today) return 'Today';
    if (iso === addDays(today, -1)) return 'Yesterday';
    return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  let toastTimer;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), isErr ? 7000 : 4500);
  }
  function setBusy(b) {
    $('#submit-clip').disabled = b;
    $('#submit-paste').disabled = b;
    $('#submit-clip').textContent = b ? 'Saving…' : '📋 Submit from clipboard';
  }

  // ---------- events ----------
  $('#submit-clip').addEventListener('click', async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t || !t.trim()) throw new Error('empty');
      await submit(t);
    } catch (e) {
      $('#manual').open = true;
      $('#paste').focus();
      toast("Couldn't read the clipboard. Paste your result in the box below.", true);
    }
  });
  $('#submit-paste').addEventListener('click', () => submit($('#paste').value));
  $('#change-name').addEventListener('click', askName);
  $('#my-profile').addEventListener('click', () => {
    const me = normName(getName());
    if (!me) return askName();
    state.profile = me;
    state.h2h = '';
    state.ptab = 'overview';
    state.tab = 'profile';
    render();
    window.scrollTo(0, 0);
  });
  $('#name-form').addEventListener('submit', () => { setName($('#name-input').value); render(); });
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    state.tab = b.dataset.tab;
    if (state.tab === 'daily') state.day = null; // jump back to today
    if (state.tab === 'weekly') state.week = null;
    render();
  });
  const canHover = window.matchMedia('(hover: hover)').matches;
  document.addEventListener('mouseover', (e) => {
    if (!canHover) return;
    const el = e.target.closest('[data-tip]');
    if (el) showTip(el); else if (!e.target.closest('#tip')) hideTip();
  });
  document.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); else hideTip(); });
  document.addEventListener('click', (e) => {
    if (canHover) return;
    const el = e.target.closest('[data-tip]');
    if (el && tipEl().dataset.for !== el.dataset.tip) showTip(el); else hideTip(); // tap to open, tap again or elsewhere to close
  });
  window.addEventListener('scroll', hideTip, { passive: true });
  // Charts are drawn at the board's pixel width, so redraw when it changes (rotating a phone, resizing).
  let resizeTimer, lastBoardW = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const w = $('#board').clientWidth;
      if (w !== lastBoardW) { lastBoardW = w; render(); }
    }, 200);
  });
  $('#today').addEventListener('click', (e) => { if (e.target.closest('#undo')) undoLast(); });
  $('#board').addEventListener('click', (e) => {
    const pl = e.target.closest('button[data-player]');
    const day = e.target.closest('button[data-day]');
    const riv = e.target.closest('button[data-rival]');
    const wk = e.target.closest('button[data-week]');
    if (e.target.closest('[data-copy-week]')) return copyWeek();
    const rp = e.target.closest('[data-replay]');
    if (rp) { const a = document.querySelector(`#${rp.dataset.replay} animate`); if (a && a.beginElement) a.beginElement(); return; }
    const ptab = e.target.closest('button[data-ptab]');
    if (ptab) { state.ptab = ptab.dataset.ptab; render(); return; }
    const cal = e.target.closest('button[data-cal]');
    if (cal) { state.calMode = cal.dataset.cal; render(); return; }
    const mx = e.target.closest('[data-mx-a]');
    if (mx) {
      const a = mx.dataset.mxA, b = mx.dataset.mxB;
      state.profile = a; state.h2h = b; state.histDay = null; state.tab = 'profile'; state.ptab = 'h2h';
      render();
      const h = document.querySelector('#h2h');
      if (h) h.scrollIntoView({ block: 'center' });
      return;
    }
    const hd = e.target.closest('button[data-hist-day]');
    if (hd) { if (hd.dataset.histDay) { state.histDay = hd.dataset.histDay; render(); } return; }
    if (riv) {
      state.h2h = riv.dataset.rival;
      state.ptab = 'h2h';
      render();
      const h = document.querySelector('#h2h');
      if (h) h.scrollIntoView({ block: 'center' });
      return;
    } else if (wk && !wk.disabled) {
      state.week = wk.dataset.week;
    } else if (pl) {
      state.profile = pl.dataset.player;
      state.h2h = '';
      state.ptab = 'overview';
      state.histDay = null;
      state.tab = 'profile';
    } else if (day && !day.disabled) {
      state.day = day.dataset.day;
    } else if (e.target.closest('[data-back]')) {
      state.tab = 'overall';
    } else return;
    render();
    window.scrollTo(0, 0);
  });
  $('#board').addEventListener('change', (e) => {
    if (e.target.id === 'h2h') { state.h2h = e.target.value; render(); }
    if (e.target.id === 'wr-game') { state.wrGame = e.target.value; render(); }
  });
  $('#range').addEventListener('change', (e) => { state.range = e.target.value; render(); });
  $('#mode').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    state.mode = b.dataset.mode;
    document.querySelectorAll('#mode button').forEach((x) => x.classList.toggle('on', x === b));
    render();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load().catch(() => {});
  });

  // ---------- start ----------
  // A personal link like .../games/?me=Alex sets the name automatically.
  const qs = new URLSearchParams(location.search);
  const qName = qs.get('me');
  if (qName) setName(qName);
  // Web Share Target: the OS share sheet opens this page with ?title=&text=&url=
  const shared = ['title', 'text', 'url'].map((k) => qs.get(k)).filter(Boolean).join('\n');
  if (qName || shared) history.replaceState(null, '', location.pathname);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  $('#demo-banner').hidden = !DEMO;
  render();
  load()
    .catch((e) => {
      loaded = true; // stop showing the skeleton
      $('#board').innerHTML = `<p class="muted empty">Couldn't load results (${esc(e.message)}).</p>`;
    })
    .finally(() => {
      if (!getName()) askName();
      else if (shared) submit(shared);
    });
})();
