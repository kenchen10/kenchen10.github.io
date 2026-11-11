(function () {
  const CFG = Object.assign(
    { apiUrl: '', title: 'Daily Games', minPlaysForAverage: 3, placementPoints: [3, 2, 1] },
    window.LEADERBOARD_CONFIG || {}
  );
  const API = (CFG.apiUrl || '').trim();
  const DEMO = !API;
  const DEMO_KEY = 'lb_demo_rows';
  const NAME_KEY = 'lb_name';

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
  const state = { tab: 'overall', range: 'all', mode: 'points' };

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
      const r = await fetch(API + (API.includes('?') ? '&' : '?') + 't=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      rows = j.rows || [];
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
        seen.set(key, { player: p, game: g.id, puzzle, date, value: r.value, par: r.par, display: r.display, ts: row.ts });
      }
    }
    entries = [...seen.values()];
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

  function overall(es) {
    const stats = {};
    const S = (p) => (stats[p] = stats[p] || { player: p, points: 0, wins: 0, played: 0, normSum: 0 });
    for (const list of groupBy(es, (e) => e.game + '|' + e.puzzle).values()) {
      const g = GAME_BY_ID[list[0].game];
      for (const e of rankPuzzle(list, g)) {
        const s = S(e.player);
        s.played++;
        s.normSum += Math.max(0, Math.min(1, g.normalize(e.value, e)));
        s.points += CFG.placementPoints[e.rank - 1] || 0;
        if (e.rank === 1 && list.length > 1) s.wins++;
      }
    }
    let list = Object.values(stats).map((s) => ({ ...s, avg: (100 * s.normSum) / s.played }));
    if (state.mode === 'points') {
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
        if (g.id === 'wordle' && e.value >= 7) s.fails++;
      }
    }
    const list = Object.values(stats).map((s) => ({ ...s, avg: s.sum / s.played }));
    list.forEach((s) => (s.score = Math.round(s.avg * 1000)));
    list.sort((a, b) => (g.better === 'higher' ? b.avg - a.avg : a.avg - b.avg) || b.played - a.played);
    return ranked(list);
  }

  // ---------- rendering ----------
  const medal = (r) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : r ? r : '–');
  const nameCell = (p) => {
    const me = normName(getName()) === p;
    return `<td class="name${me ? ' is-me' : ''}">${esc(displayName[p] || p)}</td>`;
  };

  function renderTabs() {
    const tabs = [{ id: 'overall', label: '🏆 Overall' }, ...GAMES.map((g) => ({ id: g.id, label: `${g.emoji} ${g.name}` })), { id: 'recent', label: '🗓️ Recent' }];
    $('#tabs').innerHTML = tabs
      .map((t) => `<button data-tab="${t.id}" class="${t.id === state.tab ? 'on' : ''}">${esc(t.label)}</button>`)
      .join('');
    $('#mode').style.display = state.tab === 'overall' ? '' : 'none';
  }

  function renderToday() {
    const p = normName(getName());
    const today = localDate(new Date());
    const chips = GAMES.map((g) => {
      const done = entries.some((e) => e.player === p && e.game === g.id && e.date === today);
      return `<span class="chip${done ? ' done' : ''}">${done ? '✓' : '·'} ${esc(g.name)}</span>`;
    }).join('');
    $('#today').innerHTML = p ? `<span class="muted">Today:</span> ${chips}` : '';
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
      : `Average of each result scaled 0–100 (100 = perfect; Wordle 1/6, Krillion 700, Poople at par). Fewer than ${CFG.minPlaysForAverage} plays are listed at the bottom.`;
    return `<table>${head}${body}</table><p class="note">${note}</p>`;
  }

  function renderGame(es, g) {
    const list = perGame(es, g);
    if (!list.length) return empty();
    const head = `<tr><th></th><th>Player</th><th class="num">Avg ${esc(g.unit)}</th><th class="num">Best</th><th class="num">Wins</th><th class="num">Played</th></tr>`;
    const body = list
      .map(
        (s) => `<tr><td class="rank">${medal(s.rank)}</td>${nameCell(s.player)}
        <td class="num strong">${g.formatValue(s.avg)}</td><td class="num">${g.id === 'wordle' && s.best >= 7 ? 'X' : g.formatValue(s.best).replace(/\.00$/, '')}</td>
        <td class="num">${s.wins}</td><td class="num nowrap">${s.played}${s.fails ? ` <small class="muted">${s.fails}✗</small>` : ''}</td></tr>`
      )
      .join('');
    const note = g.better === 'higher' ? 'Higher is better.' : 'Lower is better.' + (g.id === 'wordle' ? ' A failed puzzle (X/6) counts as 7.' : '');
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
              .map((e) => `<span class="res${e.rank === 1 && n > 1 ? ' win' : ''}">${esc(displayName[e.player] || e.player)} <b>${esc(e.display)}</b></span>`)
              .join('')}</div>`;
          })
          .join('');
        return `<div class="day"><h3>${prettyDate(date)}</h3>${games}</div>`;
      })
      .join('');
  }

  function render() {
    document.title = CFG.title + ' Leaderboard';
    $('#title').textContent = CFG.title;
    $('#me-name').textContent = getName() || '—';
    renderTabs();
    renderToday();
    const es = entries.filter(inRange);
    let html;
    if (state.tab === 'overall') html = renderOverall(es);
    else if (state.tab === 'recent') html = renderRecent(es);
    else html = renderGame(es, GAME_BY_ID[state.tab]);
    $('#board').innerHTML = html;
  }

  const empty = () => '<p class="muted empty">No results in this range yet.</p>';
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
  $('#name-form').addEventListener('submit', () => { setName($('#name-input').value); render(); });
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    state.tab = b.dataset.tab;
    render();
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
  const qName = new URLSearchParams(location.search).get('me');
  if (qName) {
    setName(qName);
    history.replaceState(null, '', location.pathname);
  }
  $('#demo-banner').hidden = !DEMO;
  render();
  load()
    .catch((e) => {
      $('#board').innerHTML = `<p class="muted empty">Couldn't load results (${esc(e.message)}).</p>`;
    })
    .finally(() => {
      if (!getName()) askName();
    });
})();
