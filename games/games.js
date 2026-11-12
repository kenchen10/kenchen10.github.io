// Game definitions: how to recognise each game's share text and how to score it.
//
// To add a new game, add an object to GAMES with:
//   id, name, emoji
//   header   – regex that marks where this game's share text starts
//   parse(s) – given the text from the header up to the next game's header,
//              return { puzzle, value, display } or null if it can't be read
//   better   – 'higher' or 'lower' (is a bigger value better?)
//   normalize(v, entry) – map value to 0..1 (1 = perfect) for the overall board
//   date(puzzle) – optional; puzzle number -> 'YYYY-MM-DD'. Without it, the
//                  submission date is used.

(function () {
  const DAY = 86400000;
  // Date of puzzle number `n`, given the date of puzzle 0.
  const fromEpoch = (zeroDate) => (n) =>
    new Date(Date.parse(zeroDate + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

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

  // Krillion's "The Bearing": tier names for the answer emojis, and bands for the total score.
  // (Emoji ↔ tier pairing read off the game's rules screen; the per-answer point cut-offs aren't published.)
  const KRILLION_TIER_NAME = { '🫧': 'Plankton', '🐟': 'Schooler', '🏮': 'Rare', '🦑': 'Deep cut', '🦐': 'One in a krillion' };
  const KRILLION_BEARING = [
    { max: 150, name: 'Plankton', line: 'Plenty of ocean left down there.' },
    { max: 250, name: 'Schooler', line: 'Swimming with the school.' },
    { max: 350, name: 'Rare', line: 'Below the thermocline. Nice.' },
    { max: 449, name: 'Deep cut', line: 'Seriously deep dive.' },
    { max: Infinity, name: 'One in a krillion', line: 'Trench dweller. Absurd.' },
  ];

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  const GAMES = [
    {
      id: 'wordle',
      name: 'Wordle',
      emoji: '🟩',
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
      header: /Krillion\s*#\s*\d/g,
      // "Krillion #119 🦐\n285\n\n🫧🫧🦑🐟🏮🦑🐟"
      parse(s) {
        const m = s.match(/^Krillion\s*#\s*(\d+)[^\n]*\n\s*(\d{1,3})(?!\d)/);
        if (!m) return null;
        const pts = Number(m[2]);
        if (pts > 700) return null;
        const answers = Array.from(gridLines(s)[0] || '')
          .filter((ch) => ch !== '\uFE0F' && ch !== ' ')
          .map((ch, i) => ({ label: 'Answer ' + (i + 1), mark: ch, value: KRILLION_TIER_NAME[ch] || '' }));
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
      header: /Poople/gi,
      // TODO: confirm against a real Poople share text. This parser is a guess:
      // it looks for a puzzle number (#123) and a step count ("5 steps",
      // "5 moves", or "5/4" meaning steps/par), plus an optional "par 4".
      parse(s) {
        const num = s.match(/#\s*(\d+)/);
        let steps = null, par = null, m;
        if ((m = s.match(/(\d+)\s*(?:steps?|moves?)/i))) steps = Number(m[1]);
        else if ((m = s.match(/(\d+)\s*\/\s*(\d+)/))) { steps = Number(m[1]); par = Number(m[2]); }
        if ((m = s.match(/par\s*:?\s*(\d+)/i))) par = Number(m[1]);
        if (!steps) return null;
        return {
          puzzle: num ? Number(num[1]) : null,
          value: steps,
          par,
          display: steps + ' steps' + (par ? ` (par ${par})` : ''),
        };
      },
      better: 'lower',
      unit: 'steps',
      formatValue: (v) => v.toFixed(2),
      normalize: (v, e) => Math.min(1, (e && e.par ? e.par : 4) / v),
    },
    {
      id: 'flagle',
      name: 'Flagle',
      emoji: '🚩',
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
      name: 'Tradle',
      emoji: '🚢',
      header: /Tradle\s*#\s*\d/gi,
      // "#Tradle #1711 X/6"   (X/6 = failed)
      parse(s) {
        const m = s.match(/^#?Tradle\s*#\s*(\d+)\s+([1-6Xx])\s*\/\s*6/i);
        if (!m) return null;
        const failed = /x/i.test(m[2]);
        const guesses = failed ? 7 : Number(m[2]);
        return { puzzle: Number(m[1]), value: guesses, display: (failed ? 'X' : guesses) + '/6', detail: { grid: gridLines(s) } };
      },
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
      header: /Noillirk\b(?=[^\n]*No\.)/gi,
      // "Noillirk: The Daily Climb | No. 46 - 8,759m" (score = metres climbed)
      parse(s) {
        const m = s.match(/No\.\s*(\d+)\s*[-–—]\s*(\d{1,3}(?:,\d{3})*|\d+)\s*m\b/i);
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
      id: 'maptap',
      name: 'MapTap',
      emoji: '📍',
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
