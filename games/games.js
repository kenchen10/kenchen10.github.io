// Game definitions: how to recognise each game's share text and how to score it.
//
// To add a new game, add an object to GAMES with:
//   id, name, emoji, url (where to play it; linked from the "Today" pills)
//   header   – regex that marks where this game's share text starts
//   parse(s) – given the text from the header up to the next game's header,
//              return { puzzle, value, display } or null if it can't be read
//   better   – 'higher' or 'lower' (is a bigger value better?)
//   firstGuess – optional (detail) -> 0..1, how good the opening guess was (feeds the first-guess luck meter)
//   failValue – optional: the value a failed puzzle is stored as (shown as an X, counted in the ✗ column)
//   normalize(v, entry) – map value to 0..1 (1 = perfect) for the overall board
//   relative – optional { floor, cap }: instead of normalize(), score a result against the best that day
//                (higher-better: value / max(best, floor); lower-better: clamp(best, floor, cap) / value)
//   date(puzzle) – optional; puzzle number -> 'YYYY-MM-DD'. Without it, the
//                  submission date is used.

(function () {
  const DAY = 86400000;
  // Date of puzzle number `n`, given the date of puzzle 0.
  const fromEpoch = (zeroDate) => (n) =>
    new Date(Date.parse(zeroDate + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

  const fmtTime = (secs) => {
    const t = Math.round(secs), m = Math.floor(t / 60), r = t % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  };

  // Puzzle id for games without a puzzle number: the date as YYYYMMDD.
  const fromYmd = (n) => {
    const y = Math.floor(n / 10000), m = Math.floor(n / 100) % 100, d = n % 100;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  // Detail shown when hovering/tapping a result. parse() may return `detail`:
  //   { grid: ['🟩🟨⬜…', …],                      emoji lines, shown as-is
  //     rows: [{ label, value, mark }, …] }      e.g. one row per round
  // A game may also define `legend: { '🫧': 'meaning', … }` to explain its emojis.
  const gridLines = (s) =>
    s.split('\n').map((l) => l.trim())
      .filter((l) => l && !/[0-9A-Za-z]/.test(l) && /^[\p{Extended_Pictographic}️‍ ]+$/u.test(l));

  // Krillion tiers: points per answer, and total-score bands ("The Bearing").
  // 🫧10 + 🫧10 + 🦑60 + 🐟30 + 🏮85 + 🦑60 + 🐟30 = 285, which matches a real 285-point share.
  const KRILLION_TIER = {
    '🫧': { name: 'Plankton', pts: 10 },
    '🐟': { name: 'Schooler', pts: 30 },
    '🦑': { name: 'Rare', pts: 60 },
    '🏮': { name: 'Deep cut', pts: 85 },
    '🦐': { name: 'One in a krillion', pts: 100 },
  };
  const KRILLION_BEARING = [
    { max: 150, name: 'Plankton', line: 'Plenty of ocean left down there.' },
    { max: 250, name: 'Schooler', line: 'Swimming with the school.' },
    { max: 350, name: 'Rare', line: 'Below the thermocline. Nice.' },
    { max: 449, name: 'Deep cut', line: 'Seriously deep dive.' },
    { max: Infinity, name: 'One in a krillion', line: 'Trench dweller. Absurd.' },
  ];

  // How good an opening guess was, 0..1 (1 = best), from a row of share-grid emoji. `points` maps an
  // emoji to its value; anything else counts 0. Returns null when there's no row to read.
  const openingScore = (row, points) => {
    const cells = Array.from(row || '').filter((c) => c !== '\uFE0F' && c !== ' ');
    return cells.length ? cells.reduce((t, c) => t + (points[c] || 0), 0) / cells.length : null;
  };

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  const GAMES = [
    {
      id: 'wordle',
      failValue: 7, // a failed puzzle (X/6) counts as 7
      name: 'Wordle',
      emoji: '🟩',
      url: 'https://www.nytimes.com/games/wordle/index.html',
      header: /Wordle\s+\d/g,
      // "Wordle 1,234 3/6*"   (X/6 = failed, * = hard mode)
      parse(s) {
        const m = s.match(/^Wordle\s+(\d{1,3}(?:[,.\s]\d{3})*)\s+([1-6Xx])\s*\/\s*6(\*?)/);
        if (!m) return null;
        const failed = /x/i.test(m[2]);
        const guesses = failed ? 7 : Number(m[2]);
        return {
          puzzle: Number(m[1].replace(/\D/g, '')),
          value: guesses,
          display: (failed ? 'X' : guesses) + '/6' + (m[3] ? '*' : ''),
          detail: { grid: gridLines(s) },
        };
      },
      // Opening guess quality from the first grid row: 🟩 = 1, 🟨 = 0.5, else 0 (averaged over the row).
      firstGuess: (d) => openingScore(d.grid && d.grid[0], { '🟩': 1, '🟨': 0.5 }),
      better: 'lower',
      unit: 'guesses',
      formatValue: (v) => (v >= 7 ? 'X' : v.toFixed(2)),
      normalize: (v) => (7 - v) / 6, // 1/6 -> 1.0, 6/6 -> 0.17, X -> 0
      date: fromEpoch('2021-06-19'),
    },
    {
      id: 'krillion',
      name: 'Krillion',
      emoji: '🦐',
      url: 'https://krillion.io/',
      header: /Krillion\s*#\s*\d/g,
      // "Krillion #119 🦐\n285\n\n🫧🫧🦑🐟🏮🦑🐟"
      parse(s) {
        const m = s.match(/^Krillion\s*#\s*(\d+)[^\n]*\n\s*(\d{1,3})(?!\d)/);
        if (!m) return null;
        const pts = Number(m[2]);
        if (pts > 700) return null;
        const answers = Array.from(gridLines(s)[0] || '')
          .filter((ch) => ch !== '\uFE0F' && ch !== ' ')
          .map((ch, i) => ({ label: 'Answer ' + (i + 1), mark: ch, value: KRILLION_TIER[ch] ? `${KRILLION_TIER[ch].name} · ${KRILLION_TIER[ch].pts}` : '' }));
        const bearing = KRILLION_BEARING.find((b) => pts <= b.max);
        return {
          puzzle: Number(m[1]), value: pts, display: pts + ' pts',
          detail: { rows: answers, note: bearing ? `Bearing: ${bearing.name}. ${bearing.line}` : '' },
        };
      },
      better: 'higher',
      unit: 'points',
      formatValue: (v) => Math.round(v).toString(),
      normalize: (v) => v / 700, // max possible is 700
      date: fromEpoch('2026-07-15'), // #1 = 2026-07-16, #119 = 2026-11-11
    },
    {
      id: 'poople',
      name: 'Poople',
      emoji: '💩',
      url: 'https://poople.io/',
      header: /Poople\s*#\s*\d/gi,
      // "Poople #454 5/5\n🟫⬜⬜⬜\n…\n🟫🟫🟫🟫\n\nhttps://poople.io/"
      //   guesses / best possible (par); 🟫 = letter already matches P-O-O-P.
      parse(s) {
        const m = s.match(/^Poople\s*#\s*(\d+)\s+(\d+)\s*\/\s*(\d+)/i);
        if (!m) return null;
        const steps = Number(m[2]), par = Number(m[3]);
        return {
          puzzle: Number(m[1]),
          value: steps,
          par,
          display: `${steps}/${par}`,
          detail: { grid: gridLines(s), note: steps === par ? 'Perfect: matched the best solution.' : `${steps - par} over the best solution (${par}).` },
        };
      },
      // grid[0] is the given starting word, so the first real guess is row 1: how many letters already match P-O-O-P.
      firstGuess: (d) => openingScore(d.grid && d.grid[1], { '🟫': 1 }),
      better: 'lower',
      unit: 'guesses',
      formatValue: (v) => v.toFixed(2),
      normalize: (v, e) => Math.min(1, (e && e.par ? e.par : 4) / v), // 1.0 = matched the best solution
      date: fromEpoch('2025-08-14'), // #1 = 2025-08-15; #454 = 2026-11-11 (matches the submissions)
    },
    {
      id: 'flagle',
      failValue: 7, // a failed puzzle (X/6) counts as 7
      name: 'Flagle',
      emoji: '🚩',
      url: 'https://www.flagle.io/',
      header: /Flagle\s*#\s*\d/gi,
      // "#Flagle #1724 (11.11.2026) 5/6"   (X/6 = failed). Date is ambiguous
      // (DD.MM vs MM.DD), so the puzzle number is used instead.
      parse(s) {
        const m = s.match(/^#?Flagle\s*#\s*(\d+)[^\n]*?\b([1-6Xx])\s*\/\s*6/i);
        if (!m) return null;
        const failed = /x/i.test(m[2]);
        const guesses = failed ? 7 : Number(m[2]);
        return { puzzle: Number(m[1]), value: guesses, display: (failed ? 'X' : guesses) + '/6', detail: { grid: gridLines(s) } };
      },
      better: 'lower',
      unit: 'guesses',
      formatValue: (v) => (v >= 7 ? 'X' : v.toFixed(2)),
      normalize: (v) => (7 - v) / 6,
      date: fromEpoch('2022-02-21'), // #1724 = 2026-11-11
    },
    {
      id: 'tradle',
      failValue: 7, // a failed puzzle (X/6) counts as 7
      name: 'Tradle',
      emoji: '🚢',
      url: 'https://oec.world/en/games/tradle',
      header: /Tradle\s*#\s*\d/gi,
      // "#Tradle #1711 X/6"   (X/6 = failed)
      parse(s) {
        const m = s.match(/^#?Tradle\s*#\s*(\d+)\s+([1-6Xx])\s*\/\s*6/i);
        if (!m) return null;
        const failed = /x/i.test(m[2]);
        const guesses = failed ? 7 : Number(m[2]);
        return { puzzle: Number(m[1]), value: guesses, display: (failed ? 'X' : guesses) + '/6', detail: { grid: gridLines(s) } };
      },
      firstGuess: (d) => openingScore(d.grid && d.grid[0], { '🟩': 1, '🟨': 0.5 }),
      better: 'lower',
      unit: 'guesses',
      formatValue: (v) => (v >= 7 ? 'X' : v.toFixed(2)),
      normalize: (v) => (7 - v) / 6,
      date: fromEpoch('2022-03-06'), // assumes #1711 = 2026-11-11 (the day it was shared)
    },
    {
      id: 'magnitudle',
      name: 'Magnitudle',
      emoji: '📏',
      url: 'https://magnitudle.com/size-it-up',
      header: /Magnitudle(?![.\w])/gi,
      // "Magnitudle — Size It Up\n2026-11-11\n\nScore: 384/500"
      // No puzzle number, so the puzzle id is the date as YYYYMMDD.
      parse(s) {
        const sc = s.match(/Score\s*:?\s*(\d{1,3})\s*\/\s*500/i);
        const d = s.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (!sc || !d) return null;
        const value = Number(sc[1]);
        const rows = [...s.matchAll(/^\s*([\p{Extended_Pictographic}\uFE0F]+)\s+(\d{1,3})\s*$/gmu)]
          .map((r, i) => ({ label: 'Round ' + (i + 1), value: Number(r[2]), mark: r[1] }));
        return { puzzle: Number(d[1] + d[2] + d[3]), value, display: value + '/500', detail: { rows } };
      },
      better: 'higher',
      unit: 'points',
      formatValue: (v) => Math.round(v).toString(),
      normalize: (v) => v / 500,
      date: fromYmd,
    },
    {
      id: 'noillirk',
      name: 'Noillirk',
      emoji: '🧗',
      url: 'https://playdaily.org/noillirk',
      header: /Noillirk\b(?=[^\n]*No\.)/gi,
      // "Noillirk: The Daily Climb | No. 46 - 8,759m"  or  "Noillirk 🎈 The Daily Climb · No. 47 · 2,863m"
      // (the game changed its separators between versions; score = metres climbed)
      parse(s) {
        const m = s.match(/No\.\s*(\d+)\D{1,6}?(\d[\d,]*)\s*m\b/i); // any separator: "- ", "· ", "| "
        if (!m) return null;
        const value = Number(m[2].replace(/,/g, ''));
        return { puzzle: Number(m[1]), value, display: value.toLocaleString('en-US') + ' m', detail: { grid: gridLines(s) } };
      },
      better: 'higher',
      unit: 'metres',
      formatValue: (v) => Math.round(v).toLocaleString('en-US'),
      normalize: (v) => Math.min(1, v / 8849), // assumes the cap is Everest's height; adjust if scores go higher
      date: fromEpoch('2026-09-26'), // assumes No. 46 = 2026-11-11 (the day it was shared)
    },
    {
      id: 'drawtheborder',
      name: 'Draw the Border',
      emoji: '✏️',
      url: 'https://drawtheborder.com/',
      header: /Draw the Border\s*#\s*\d/gi,
      // "Draw the Border #50 ✏️ 27/100\n🟩🟩🟨⬜⬜⬜⬜⬜⬜⬜\nBorder 18% · Overlap 55% · Size 32% · Shape 22%"
      parse(s) {
        const m = s.match(/^Draw the Border\s*#\s*(\d+)[^\n]*?(\d{1,3})\s*\/\s*100/i);
        if (!m) return null;
        const value = Number(m[2]);
        const rows = [...s.matchAll(/([A-Za-z]+)\s+(\d{1,3})%/g)].map((r) => ({ label: r[1], value: r[2] + '%' }));
        return { puzzle: Number(m[1]), value, display: value + '/100', detail: { rows, grid: gridLines(s) } };
      },
      better: 'higher',
      unit: 'points',
      formatValue: (v) => Math.round(v).toString(),
      normalize: (v) => v / 100,
      date: fromEpoch('2026-09-22'), // #51 = 2026-11-12, from submission times (#50 was submitted the evening before)
    },
    {
      id: 'peakle',
      name: 'Peakle',
      emoji: '⛰️',
      url: 'https://peakle.net/',
      header: /Peakle\s*#\s*\d/gi,
      // "Peakle #33 ⛰️ 4 steps (1,200 m)\n🟩🟩🟩🟩🟥\npeakle.net"
      // Name answers each higher than the last; a lower or tied answer ends the climb (🟥).
      // So MORE steps is better. Each step is 300 m. Naming the very highest answer shows
      // "🏔️ Topped out!" instead of ⛰️. There is no fixed ceiling.
      parse(s) {
        const m = s.match(/^Peakle\s*#\s*(\d+)[^\n]*?(\d+)\s*steps?\b/i);
        if (!m) return null;
        const steps = Number(m[2]);
        const topped = /🏔|topped/i.test(s.split('\n')[0]);
        const rows = [{ label: 'Height', value: (steps * 300).toLocaleString('en-US') + ' m' }];
        if (topped) rows.push({ label: 'Result', value: '🏔️ Topped out!' });
        return { puzzle: Number(m[1]), value: steps, display: steps + (steps === 1 ? ' step' : ' steps') + (topped ? ' 🏔️' : ''), detail: { rows, grid: gridLines(s) } };
      },
      better: 'higher',
      unit: 'steps',
      formatValue: (v) => v.toFixed(1),
      // No fixed ceiling, so Average mode scores each result against the best result on the same
      // puzzle: steps / max(best of the day, floor). The floor stops a lone low result scoring 100.
      relative: { floor: 8 },
      normalize: (v) => Math.min(1, v / 10), // fallback only, when the puzzle's best isn't known
      date: fromEpoch('2026-10-08'), // #1 = 2026-10-09 (the launch date); #34 = 2026-11-11, confirmed from peakle.net
    },
    {
      id: 'perceptle',
      name: 'Perceptle',
      emoji: '👁️',
      url: 'https://perceptle.com/',
      header: /Perceptle\s*#\s*\d/gi,
      // "Perceptle #116 - A (87)\n🔢 99  🎯 99  📐 99  🥁 70  ✂️ 66\nhttps://perceptle.com"
      // Grade letter and an overall score out of 100 (the average of the five tests).
      parse(s) {
        const m = s.match(/^Perceptle\s*#\s*(\d+)\s*[-–—]\s*([A-Za-z][+-]?)\s*\(\s*(\d{1,3})\s*\)/);
        if (!m) return null;
        const value = Number(m[3]);
        const rows = [{ label: 'Grade', value: m[2] }];
        for (const r of s.split('\n').slice(1).join('\n').matchAll(/(\p{Extended_Pictographic}\uFE0F?)\s*(\d{1,3})(?!\d)/gu)) rows.push({ label: '', mark: r[1], value: Number(r[2]) });
        return { puzzle: Number(m[1]), value, display: `${value} (${m[2]})`, detail: { rows } };
      },
      better: 'higher',
      unit: 'points',
      formatValue: (v) => v.toFixed(1),
      normalize: (v) => v / 100,
      date: fromEpoch('2026-07-17'), // #118 = 2026-11-12, from submission times (#117 was submitted the evening before)
    },
    {
      id: 'tiledwords',
      name: 'Tiled Words',
      emoji: '🧩',
      url: 'https://tiledwords.com/puzzles/daily',
      header: /#TiledWords/gi,
      // "I solved today's #TiledWords puzzle!\n\n0️⃣ “Zero”\n🕒 5 minutes, 41 seconds\n💡 0/3 reveals used\n\nhttps://tiledwords.com/puzzles/2026-11-10"
      //   0️⃣ “Zero” = the puzzle's theme (not a score). Score = time to solve, lower is better.
      //   Up to 3 words can be revealed per puzzle. The share can also include
      //   "↗️ N moves used" and "🔄 N shuffles used". The puzzle is identified by the date in the link.
      parse(s) {
        const u = s.match(/tiledwords\.com\/puzzles\/(\d{4})-(\d{2})-(\d{2})/i);
        const t = s.match(/🕒\s*(?:(\d+)\s*minutes?)?\s*,?\s*(?:(\d+)\s*seconds?)?/i);
        if (!u || !t || (!t[1] && !t[2])) return null;
        const seconds = Number(t[1] || 0) * 60 + Number(t[2] || 0);
        const rows = [];
        const theme = s.match(/^\s*(\S+)\s+“([^”]+)”/m);
        if (theme) rows.push({ label: 'Theme', value: `${theme[1]} ${theme[2]}` });
        const rev = s.match(/💡\s*(\d+)\s*\/\s*3/);
        if (rev) rows.push({ label: 'Reveals', value: `${rev[1]}/3` });
        const mv = s.match(/↗️?\s*(\d+)\s*moves?/);
        if (mv) rows.push({ label: 'Moves', value: mv[1] });
        const sh = s.match(/🔄\s*(\d+)\s*shuffles?/);
        if (sh) rows.push({ label: 'Shuffles', value: sh[1] });
        return { puzzle: Number(u[1] + u[2] + u[3]), value: seconds, display: fmtTime(seconds), detail: { rows } };
      },
      better: 'lower',
      unit: 'time',
      formatValue: (v) => fmtTime(v),
      // No fixed best time, so Average mode scores benchmark / your time, where the benchmark is the
      // fastest time that day kept between 2:00 and 6:00: a very fast solve can't push everyone else
      // to ~0, and a slow day (or a lone slow solver) can't give the fastest 100.
      relative: { floor: 120, cap: 360 },
      normalize: (v) => Math.min(1, 120 / v), // fallback only
      date: fromYmd,
    },
    {
      id: 'globle',
      name: 'Globle',
      emoji: '🌎',
      url: 'https://globle-game.com/',
      header: /🌎(?=\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},)/gi, // 🌎 followed by the date (Spotle's header also ends in 🌎)
      // "🌎 Nov 12, 2026 🌍\n🔥 1 | Avg. Guesses: 11\n🟥⬜🟥🟥🟥🟥🟥🟥\n🟥🟥🟩 = 11\n\nhttps://globle-game.com\n#globle"
      //   Date = puzzle day. 🔥 = their Globle streak; "Avg. Guesses" = their all-time average (not today's).
      //   Squares = every guess in order, 8 per row, ending 🟩 (the mystery country). Colour = how close
      //   the guess was: 🟥 under 1,500 km, 🟧 under 3,750 km, 🟨 under 7,500 km, ⬜ farther.
      //   "= 11" = guesses used today: the score (lower is better).
      parse(s) {
        const val = s.match(/=\s*(\d+)/);
        const d = s.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i);
        if (!val || !d) return null;
        const value = Number(val[1]);
        const month = MONTHS.indexOf(d[1].toLowerCase()) + 1;
        const squares = s.match(/[🟩🟥🟧🟨⬜]/gu) || [];
        const grid = [];
        for (let i = 0; i < squares.length; i += 8) grid.push(squares.slice(i, i + 8).join(''));
        const rows = [];
        const streak = s.match(/🔥\s*(\d+)/);
        if (streak) rows.push({ label: 'Their streak', value: streak[1] });
        const avg = s.match(/Avg\.?\s*Guesses:\s*([\d.]+)/i);
        if (avg) rows.push({ label: 'All-time avg', value: avg[1] });
        return {
          puzzle: Number(d[3]) * 10000 + month * 100 + Number(d[2]),
          value,
          display: value + (value === 1 ? ' guess' : ' guesses'),
          detail: { rows, grid },
        };
      },
      legend: { '🟩': 'correct', '🟥': '<1,500 km', '🟧': '<3,750 km', '🟨': '<7,500 km', '⬜': 'farther' },
      // First guess only: 🟩 hit it, 🟥 under 1,500 km, 🟧 under 3,750 km, 🟨 under 7,500 km, ⬜ farther.
      firstGuess: (d) => openingScore(d.grid && Array.from(d.grid[0] || '')[0], { '🟩': 1, '🟥': 0.75, '🟧': 0.5, '🟨': 0.25 }),
      better: 'lower',
      unit: 'guesses',
      formatValue: (v) => v.toFixed(1),
      // No fixed best, so Average mode scores benchmark / your guesses, where the benchmark is the fewest
      // guesses that day kept between 4 and 10: a lucky 1-guess day can't flatten everyone else, and a
      // hard day (or a lone slow solver) can't give the winner 100.
      relative: { floor: 4, cap: 10 },
      normalize: (v) => Math.min(1, 6 / v), // fallback only
      date: fromYmd,
    },
    {
      id: 'spotle',
      name: 'Spotle',
      emoji: '🎵',
      url: 'https://www.spotle.io/',
      failValue: 11,
      header: /Spotle\.io\s*#\s*\d/gi,
      // "Spotle.io #1658  📅👥📈🚻💽🌎\n🟨🟩⬜⬜⬜🟩\n…\n🟩🟩🟩🟩🟩🟩"  (guess the artist; 10 guesses)
      //   Header columns: 📅 debut album year, 👥 members, 📈 popularity (listener rank), 🚻 gender,
      //   💽 genre, 🌎 country. Each row is one guess: 🟩 correct, 🟨 close, ⬜ miss.
      //   Close = debut within 5 years, popularity rank within 50, or same continent.
      //   The score is the number of rows (guesses); a last row that isn't all 🟩 means they failed.
      //   (A Halloween edition swaps the header to 📅🦇📈👻💽🎃; "Spotle.io Challenge" has no number and is ignored.)
      parse(s) {
        const m = s.match(/^Spotle\.io\s*#\s*(\d+)/i);
        if (!m) return null;
        const squares = s.match(/[🟩🟨⬜]/gu) || [];
        const guesses = [];
        for (let i = 0; i + 6 <= squares.length; i += 6) guesses.push(squares.slice(i, i + 6).join(''));
        if (!guesses.length) return null;
        const solved = guesses[guesses.length - 1] === '🟩🟩🟩🟩🟩🟩';
        const cols = [['📅', 'Debut year'], ['👥', 'Members'], ['📈', 'Popularity'], ['🚻', 'Gender'], ['💽', 'Genre'], ['🌎', 'Country']];
        const rows = cols.map(([emoji, label], c) => {
          const first = guesses.findIndex((row) => Array.from(row)[c] === '🟩');
          return { label, mark: emoji, value: first < 0 ? '–' : 'guess ' + (first + 1) };
        });
        return {
          puzzle: Number(m[1]),
          value: solved ? guesses.length : 11,
          display: solved ? guesses.length + (guesses.length === 1 ? ' guess' : ' guesses') : 'X (' + guesses.length + ')',
          detail: { rows, grid: guesses, note: 'First guess each column went 🟩, then every guess below.' },
        };
      },
      legend: { '🟩': 'correct', '🟨': 'close', '⬜': 'miss' },
      firstGuess: (d) => openingScore(d.grid && d.grid[0], { '🟩': 1, '🟨': 0.5 }),
      better: 'lower',
      unit: 'guesses',
      formatValue: (v) => (v >= 11 ? 'X' : v.toFixed(1)),
      // No fixed best, so Average mode scores benchmark / your guesses, where the benchmark is the fewest
      // guesses that day kept between 4 and 8.
      relative: { floor: 4, cap: 8 },
      normalize: (v) => Math.max(0, Math.min(1, 6 / v)), // fallback only
      date: fromEpoch('2022-04-29'), // #1 = 2022-04-30 (the game's start date); #1658 = 2026-11-12
    },
    {
      id: 'maptap',
      name: 'MapTap',
      emoji: '📍',
      url: 'https://www.maptap.gg/',
      header: /maptap\.gg(?![)\w\/])/gi,
      // "www.maptap.gg November 11\n93🏆 93🏆 97🔥 91👑 18😵\nFinal score: 707"
      // No puzzle number, so the puzzle id is the date as YYYYMMDD (the share
      // text has no year; assume the most recent occurrence of that month/day).
      parse(s) {
        const sc = s.match(/Final\s+score\s*:?\s*(\d{1,4})/i);
        const d = s.match(/maptap\.gg\)?\s*\]?\(?[^\n]*?\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b/i);
        if (!sc || !d) return null;
        const month = MONTHS.indexOf(d[1].toLowerCase()), day = Number(d[2]);
        const now = new Date();
        let year = now.getFullYear();
        if (Date.UTC(year, month, day) - now.getTime() > 60 * DAY) year--;
        const value = Number(sc[1]);
        const rounds = [...s.split(/Final/i)[0].matchAll(/(\d{1,3})\s*(\p{Extended_Pictographic}\uFE0F?)/gu)]
          .map((r, i) => ({ label: 'Round ' + (i + 1), value: Number(r[1]), mark: r[2] }));
        return { puzzle: year * 10000 + (month + 1) * 100 + day, value, display: value + ' pts', detail: { rows: rounds } };
      },
      better: 'higher',
      unit: 'points',
      formatValue: (v) => Math.round(v).toString(),
      normalize: (v) => Math.min(1, v / 1000), // assumes a 1000 max; adjust if scores go higher
      date: fromYmd,
    },
  ];

  // Split pasted text into per-game chunks and parse each.
  // Returns { results: [{game, puzzle, value, display, ...}], unreadable: [gameName] }
  function parseShareText(text) {
    text = String(text || '').replace(/\r\n?/g, '\n');
    const marks = [];
    for (const g of GAMES) {
      g.header.lastIndex = 0;
      let m;
      while ((m = g.header.exec(text))) marks.push({ game: g, index: m.index });
    }
    marks.sort((a, b) => a.index - b.index);
    const results = [], unreadable = [];
    marks.forEach((mk, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
      const chunk = text.slice(mk.index, end).trim();
      const r = mk.game.parse(chunk);
      if (r) results.push({ game: mk.game.id, ...r });
      else unreadable.push(mk.game.name);
    });
    return { results, unreadable };
  }

  window.GAMES = GAMES;
  window.GAME_BY_ID = Object.fromEntries(GAMES.map((g) => [g.id, g]));
  window.parseShareText = parseShareText;
})();
