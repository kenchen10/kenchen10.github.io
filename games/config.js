// Leaderboard settings — edit these.
window.LEADERBOARD_CONFIG = {
  // Paste your Google Apps Script web-app URL here (see games/README.md).
  // Leave empty to run in demo mode: results are saved only in this browser.
  apiUrl: 'https://script.google.com/macros/s/AKfycbz8IL_meoZDyCDYwhdE8Jspf8aTDHNbNcMA2m4KQIeHgiLkmNaSLVLcStkn6C0Z-KF6Pw/exec',

  // Title shown at the top of the page.
  title: 'Daily Games',

  // Overall board, "Average" mode: players with fewer plays than this in the
  // selected time range are listed below everyone else.
  minPlaysForAverage: 3,

  // Overall board, "Points" mode: points for 1st, 2nd, 3rd ... on each puzzle.
  placementPoints: [3, 2, 1],

  // Profile "form" and the 🍀/☁️ marks compare a result with that player's own earlier results in the
  // same game. A game needs this many earlier results before a new one can be compared.
  minForUsual: 4,

  // Show the ⚡ hot-streak badge after this many wins in a row in one game.
  hotStreakWins: 3,

  // First-guess luck needs this many openings in a game (from everyone) to rank a new one against.
  minForStartRank: 8,

  // Rivalries need this many puzzles two players both played.
  minForRival: 5,
};
