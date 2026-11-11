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
        return { puzzle: Number(m[1]), value: pts, display: pts + ' pts' };
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
