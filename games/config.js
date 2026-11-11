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
};
