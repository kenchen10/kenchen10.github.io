# Daily Games Leaderboard

Lives at `https://kenchen10.github.io/games/`. Friends tap **Share** in a game, open the page and tap **Submit from clipboard**. Results go into a Google Sheet, and the page computes per-game and overall leaderboards from it.

The page works right away in **demo mode**, where results are saved only in your own browser. Do the one-time setup below to make it shared.

## One-time setup (about 10 minutes)

1. **Create the sheet.** Make a new Google Sheet (e.g. "Daily Games Leaderboard").
2. **Add the script.** In the sheet, open *Extensions → Apps Script*. Delete what's there, paste the contents of [`backend/Code.gs`](backend/Code.gs) and save.
3. **Deploy it.** Click *Deploy → New deployment*. Pick type *Web app* and set:
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click *Deploy*, authorize when asked (on the "unverified app" screen choose *Advanced → Go to … (unsafe)*; it's your own script), then copy the **Web app URL** (ends in `/exec`).
4. **Connect the site.** Paste that URL into `apiUrl` in [`config.js`](config.js), then commit and push.
5. **Send links to friends.** Give each friend a personal link so they never have to type their name:
   - `https://kenchen10.github.io/games/?me=Alex`
   - `https://kenchen10.github.io/games/?me=Sam`

   Tell them to open it on their phone and choose **Add to Home Screen** (Safari: Share button → Add to Home Screen; Chrome: ⋮ menu → Add to Home screen).

If you later change `Code.gs`, use *Deploy → Manage deployments → Edit → New version*. This keeps the same URL.

## How scoring works

- **Duplicates:** only the first submission per player, game and puzzle counts, so re-pasting does nothing.
- **Per-game boards:** average result (Wordle guesses with X = 7, Krillion points, Poople steps), best result, wins (outright or tied 1st with 2+ players) and games played.
- **Overall, Points mode** (default): on every puzzle, 1st/2nd/3rd among friends who played it get 3/2/1 points (configurable in `config.js`). This rewards both playing and doing well.
- **Overall, Average mode:** every result is scaled to 0–100 (Wordle 1/6 = 100 and X = 0; Krillion = points/7; Poople = par/steps) and averaged. Players under `minPlaysForAverage` plays are listed at the bottom.
- **Time ranges:** all time, last 30 days, last 7 days or today. Dates come from the puzzle number (Wordle, Krillion), otherwise from the submission date.

## Adding a game

Add an entry to `GAMES` in [`games.js`](games.js). It needs a `header` regex that finds the game's share text and a `parse` function that pulls out the puzzle number and score. It also needs `better` (`'higher'`/`'lower'`) and a `normalize` function to 0–1. Old submissions are re-parsed automatically, so if someone pasted a game before you added it, their results show up once the parser exists.

## Removing a bad entry

Delete the row in the Google Sheet.
