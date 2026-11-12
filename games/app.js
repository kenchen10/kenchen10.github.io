(function () {
  const CFG = Object.assign(
    { apiUrl: '', title: 'Daily Games', minPlaysForAverage: 3, placementPoints: [3, 2, 1] },
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
  const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  let rows = []; // raw submissions: {ts, player, text}
  let entries = []; // parsed + de-duplicated results
  let displayName = {}; // normalized name -> name as first written
  const state = { tab: 'overall', range: 'all', mode: 'points', day: null, profile: null, h2h: '' };
  let puzzleBest = {}; // game|puzzle -> best value (for games scored relative to the day's best)
  let dateIdx = {}; // player -> (gameId | '*') -> Set of dates played, for streaks

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
    rebuild();
    render();
  }

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
        const date = r.puzzle != null && g.date ? g.date(r.puzzle) : localDate(row.ts);
        const puzzle = r.puzzle != null ? r.puzzle : date;
        const key = `${p}|${g.id}|${puzzle}`;
        if (seen.has(key)) continue; // first submission for a puzzle counts
        seen.set(key, { player: p, game: g.id, puzzle, date, value: r.value, par: r.par, display: r.display, detail: r.detail, ts: row.ts });
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

    const row = { ts: new Date().toISOString(), player: name, text: text.slice(0, 2000) };
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
          body: JSON.stringify({ player: name, text: row.text }),
        });
        const j = await r.json().catch(() => ({}));
        if (j.ok === false) throw new Error(j.error || 'rejected');
      }
      rows.push(row);
      rebuild();
      render();
      let msg = '✅ Saved: ' + fresh.join(', ');
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

  // ---------- rendering ----------
  const medal = (r) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : r ? r : '–');
  const nameCell = (p, gameId) => {
    const me = normName(getName()) === p;
    const cur = streakInfo(p, gameId).cur;
    const flame = cur >= 2 ? ` <span class="streak" title="${cur} days in a row">🔥${cur}</span>` : '';
    return `<td class="name${me ? ' is-me' : ''}"><button class="plink" data-player="${esc(p)}">${esc(displayName[p] || p)}</button>${flame}</td>`;
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
    const stats = [{ id: 'overall', label: '🏆 Overall' }, { id: 'daily', label: '📅 Daily' }, { id: 'recent', label: '🗓️ Recent' }];
    const games = GAMES.map((g) => ({ id: g.id, label: `${g.emoji} ${g.name}` }));
    const group = (label, list) => `<div class="tab-group"><span class="tab-label">${label}</span><div class="tab-row">${list.map(btn).join('')}</div></div>`;
    $('#tabs').innerHTML = group('Stats', stats) + group('Games', games);
    $('#mode').style.display = state.tab === 'overall' ? '' : 'none';
    const plain = state.tab === 'daily' || state.tab === 'profile'; // these ignore the time range
    document.querySelector('.controls').hidden = plain;
  }

  function renderToday() {
    const p = normName(getName());
    const today = localDate(new Date());
    const chips = GAMES.map((g) => {
      const done = entries.some((e) => e.player === p && e.game === g.id && e.date === today);
      return `<a class="chip${done ? ' done' : ''}" href="${esc(g.url)}" target="_blank" rel="noopener" title="Play ${esc(g.name)}">${done ? '✓' : '·'} ${esc(g.name)}</a>`;
    }).join('');
    const cur = p ? streakInfo(p, null).cur : 0;
    const streak = cur >= 2 ? `<span class="streak">🔥 ${cur}-day streak</span>` : '';
    const undo = myRecentIdx() >= 0 ? '<button class="link" id="undo">↩ Undo last submission</button>' : '';
    $('#today').innerHTML = p ? `<span class="muted">Today:</span> ${chips} ${streak} ${undo}` : '';
  }

  function renderOverall(es) {
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
      : `Average of each result scaled 0–100 (100 = perfect; Wordle, Flagle or Tradle 1/6, Krillion 700, MapTap 1000, Magnitudle 500, Draw the Border 100, Perceptle 100, Peakle vs the day's best (min. 8 steps), Tiled Words vs the day's fastest time (benchmark kept between 2:00 and 6:00), Globle vs the day's fewest guesses (benchmark kept between 4 and 10), Spotle likewise (4 to 8), Noillirk 8,849 m, Poople at par). Fewer than ${CFG.minPlaysForAverage} plays are listed at the bottom.`;
    return `<table>${head}${body}</table><p class="note">${note}</p>`;
  }

  function renderGame(es, g) {
    const list = perGame(es, g);
    if (!list.length) return empty();
    const head = `<tr><th></th><th>Player</th><th class="num">Avg ${esc(g.unit)}</th><th class="num">Best</th><th class="num">Wins</th><th class="num">Played</th></tr>`;
    const body = list
      .map(
        (s) => `<tr><td class="rank">${medal(s.rank)}</td>${nameCell(s.player, g.id)}
        <td class="num strong">${g.formatValue(s.avg)}</td><td class="num">${g.failValue && s.best >= g.failValue ? 'X' : g.formatValue(s.best).replace(/\.00$/, '')}</td>
        <td class="num">${s.wins}</td><td class="num nowrap">${s.played}${s.fails ? ` <small class="muted">${s.fails}✗</small>` : ''}</td></tr>`
      )
      .join('');
    const note = g.better === 'higher' ? 'Higher is better.' : 'Lower is better.' + (g.failValue ? ` A failed puzzle counts as ${g.failValue}.` : '');
    return `<table>${head}${body}</table><p class="note">${note}</p>`;
  }

  function renderRecent(es) {
    const byDate = [...groupBy(es, (e) => e.date).entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 21);
    if (!byDate.length) return empty();
    return byDate
      .map(([date, list]) => {
        const games = GAMES.filter((g) => list.some((e) => e.game === g.id))
          .map((g) => {
            const res = rankPuzzle(list.filter((e) => e.game === g.id), g);
            const n = res.length;
            return `<div class="day-game"><span class="gname">${g.emoji} ${esc(g.name)}</span>${res
              .map((e) => `<span class="res${e.rank === 1 && n > 1 ? ' win' : ''}">${esc(displayName[e.player] || e.player)} <b class="has-tip"${tipAttr(e)}>${esc(e.display)}</b></span>`)
              .join('')}</div>`;
          })
          .join('');
        return `<div class="day"><h3>${prettyDate(date)}</h3>${games}</div>`;
      })
      .join('');
  }


  // ---------- result details (hover / tap) ----------
  let tips = []; // rebuilt on every render; elements point at an index
  const tipAttr = (e) => {
    const d = e.detail;
    if (!d || !((d.grid && d.grid.length) || (d.rows && d.rows.length))) return '';
    tips.push(e);
    return ` data-tip="${tips.length - 1}" tabindex="0"`;
  };

  function tipHtml(e) {
    const g = GAME_BY_ID[e.game];
    const d = e.detail;
    const rowsHtml = (d.rows || [])
      .map((r) => `<tr><td>${esc(r.label)}</td><td class="tip-mark">${esc(r.mark || '')}</td><td class="num"><b>${esc(r.value)}</b></td></tr>`)
      .join('');
    const grid = (d.grid || []).map((l) => `<div>${esc(l)}</div>`).join('');
    const legend = g.legend
      ? `<div class="tip-legend">${Object.entries(g.legend).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(' · ')}</div>`
      : '';
    return `<div class="tip-head">${g.emoji} ${esc(g.name)} · <b>${esc(e.display)}</b></div>
      ${rowsHtml ? `<table>${rowsHtml}</table>` : ''}${grid ? `<div class="tip-grid">${grid}</div>` : ''}${d.note ? `<div class="tip-note">${esc(d.note)}</div>` : ''}${legend}`;
  }

  const tipEl = () => $('#tip');
  function showTip(el) {
    const e = tips[Number(el.dataset.tip)];
    if (!e) return;
    const t = tipEl();
    t.innerHTML = tipHtml(e);
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
    const top = `<h3>Day standings</h3><table><tr><th></th><th>Player</th><th class="num">Points</th><th class="num">Games</th></tr>${board}</table>`;

    const cards = GAMES.filter((g) => es.some((e) => e.game === g.id))
      .map((g) => {
        const res = rankPuzzle(es.filter((e) => e.game === g.id), g);
        const rowsHtml = res
          .map((e) => `<tr><td class="rank">${medal(e.rank)}</td>${nameCell(e.player)}<td class="num strong"><span class="has-tip"${tipAttr(e)}>${esc(e.display)}</span></td></tr>`)
          .join('');
        return `<h3 class="game-h">${g.emoji} ${esc(g.name)}</h3><table>${rowsHtml}</table>`;
      })
      .join('');
    return nav + top + cards + '<p class="note">Hover (or tap) a result to see the round-by-round details.</p>';
  }

  // ---------- player profile ----------
  function headToHead(a, b) {
    const total = { a: 0, b: 0, tie: 0 };
    const byGame = {};
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
    }
    return { total, byGame };
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
      ['Streak', st.cur ? `🔥 ${st.cur}` : '0'],
      ['Best streak', st.best],
    ]
      .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`)
      .join('');

    const gameRows = GAMES.map((g) => {
      const list = perGame(entries, g);
      const s = list.find((x) => x.player === p);
      if (!s) return '';
      const gs = streakInfo(p, g.id).cur;
      const best = g.failValue && s.best >= g.failValue ? 'X' : g.formatValue(s.best).replace(/\.00$/, '');
      return `<tr><td>${g.emoji} ${esc(g.name)}${trend(p, g)}</td><td class="num">${medal(s.rank)}</td><td class="num strong">${g.formatValue(s.avg)}</td>
        <td class="num">${best}</td><td class="num">${s.wins}</td><td class="num">${s.played}${gs >= 2 ? ` <span class="streak">🔥${gs}</span>` : ''}</td></tr>`;
    }).join('');
    const perGameTable = `<h3>By game (all time)</h3><table><tr><th>Game</th><th class="num">Rank</th><th class="num">Avg</th><th class="num">Best</th><th class="num">Wins</th><th class="num">Played</th></tr>${gameRows}</table>`;

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
      h2h = n
        ? `${bar}<table><tr><th>Same puzzle</th><th class="num">${name}</th><th class="num">${other}</th><th class="num">Tie</th></tr>${games}${line('<b>Total</b>', r.total)}</table>`
        : `<p class="muted empty">You haven't played any of the same puzzles yet.</p>`;
    }
    return `${back}<h2 class="ptitle">${name}</h2><div class="stats">${stats}</div>${perGameTable}
      <h3>Head to head</h3><select id="h2h" aria-label="Compare with">${opts}</select>${h2h}`;
  }

  function render() {
    tips = [];
    hideTip();
    document.title = CFG.title + ' Leaderboard';
    $('#title').textContent = CFG.title;
    $('#me-name').textContent = getName() || '—';
    renderAvatar();
    renderTabs();
    renderToday();
    const es = entries.filter(inRange);
    let html;
    if (state.tab === 'overall') html = renderOverall(es);
    else if (state.tab === 'recent') html = renderRecent(es);
    else if (state.tab === 'daily') html = renderDaily();
    else if (state.tab === 'profile') html = renderProfile();
    else html = renderGame(es, GAME_BY_ID[state.tab]);
    $('#board').innerHTML = html;
  }

  const empty = (msg) => `<p class="muted empty">${msg || 'No results in this range yet.'}</p>`;
  const ordinal = (n) => n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n] || 'th');
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
  $('#today').addEventListener('click', (e) => { if (e.target.closest('#undo')) undoLast(); });
  $('#board').addEventListener('click', (e) => {
    const pl = e.target.closest('button[data-player]');
    const day = e.target.closest('button[data-day]');
    if (pl) {
      state.profile = pl.dataset.player;
      state.h2h = '';
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
      $('#board').innerHTML = `<p class="muted empty">Couldn't load results (${esc(e.message)}).</p>`;
    })
    .finally(() => {
      if (!getName()) askName();
      else if (shared) submit(shared);
    });
})();
