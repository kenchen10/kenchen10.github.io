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
