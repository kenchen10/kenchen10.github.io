/**
 * Daily Games Leaderboard — Google Apps Script backend.
 *
 * Paste this into Extensions → Apps Script of a Google Sheet, then
 * Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * Copy the web-app URL into games/config.js.
 *
 * The sheet just stores raw submissions (time, player, pasted text).
 * All parsing and scoring happens on the website, so adding a game or
 * fixing a parser never requires touching this script or the data.
 */

const SHEET_NAME = 'Results';
const MAX_TEXT = 2000;

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['timestamp', 'player', 'text']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Players may only undo submissions made within this window.
const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

function norm_(s) {
  return String(s).replace(/^'/, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Delete the most recent row written by `player`. Rows are appended in time order.
function undo_(player) {
  const sh = sheet_();
  const values = sh.getDataRange().getValues();
  const want = norm_(player);
  for (let i = values.length - 1; i >= 1; i--) {
    if (norm_(values[i][1]) !== want) continue;
    const when = new Date(values[i][0]);
    if (Date.now() - when.getTime() > UNDO_WINDOW_MS) return { ok: false, error: 'nothing recent to undo' };
    const removed = { ts: when.toISOString(), text: String(values[i][2]) };
    sh.deleteRow(i + 1); // values[0] is sheet row 1
    return { ok: true, removed: removed };
  }
  return { ok: false, error: 'nothing to undo' };
}

// GET → every submission as JSON.
function doGet() {
  const values = sheet_().getDataRange().getValues().slice(1);
  const rows = values
    .filter(function (r) { return r[1] && r[2]; })
    .map(function (r) {
      return { ts: new Date(r[0]).toISOString(), player: String(r[1]), text: String(r[2]) };
    });
  return json_({ rows: rows });
}

// POST {player, text} → append one row.
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad request' });
  }
  const player = String(body.player || '').trim().replace(/\s+/g, ' ').slice(0, 30);

  // POST {action:'undo', player} → delete that player's most recent row (if recent).
  if (body.action === 'undo') {
    if (!player) return json_({ ok: false, error: 'missing player' });
    const ulock = LockService.getScriptLock();
    ulock.waitLock(10000);
    try {
      return json_(undo_(player));
    } finally {
      ulock.releaseLock();
    }
  }

  const text = String(body.text || '').slice(0, MAX_TEXT);
  if (!player || !text.trim()) return json_({ ok: false, error: 'missing player or text' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Leading apostrophe stops Sheets from treating text as a formula.
    sheet_().appendRow([new Date(), "'" + player, "'" + text]);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}
