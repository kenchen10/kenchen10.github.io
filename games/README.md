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

## Form, luck marks and hot streaks

- **vs usual:** each result is compared with that player's own earlier results in the same game (scaled 0–100 like Average mode, last 30 results). A game needs `minForUsual` earlier results (default 4) before a new one can be compared. A result at least one "typical swing" (their own standard deviation, never less than 10 points) above or below usual gets a 🍀 or ☁️ on the Daily and Recent tabs, and the hover shows the exact gap.
- **Form:** on a profile, the average of their last 10 results' gaps, shown as −100…+100.
- **Hot streak ⚡:** `hotStreakWins` (default 3) wins in a row in one game, among the puzzles that player played, with the latest result in the past 7 days. A win means 1st place (outright or tied) with at least 2 players on that puzzle.

## First-guess luck, weekly recap, badges and rivalries

- **First-guess luck (✨ / 🌧️):** for games whose share grid shows the first guess (Wordle, Tradle, Spotle, Globle, Poople), the opening guess is scored 0–1 and ranked against every opening ever shared for that game (needs `minForStartRank` openings, default 8). An opening in the top 15% gets ✨ on the Daily and Recent tabs, the bottom 15% gets 🌧️, and the hover says "better than N% of openings". A profile's **Luck** gauge averages their last 10 openings. To add a game, give its entry a `firstGuess(detail)` that returns 0–1 (see `games.js`).
- **Weekly recap (📰):** the last 7 days (‹ › to go back), as cards: champion, most wins, biggest climber, best form, luckiest starts, best single result, longest win run, most days played and cold spell. A card only appears when there's enough data. **Copy this recap** puts the cards in your clipboard as text.
- **Badges:** 13 badges on each profile (earned ones are lit, the rest are locked with a tooltip explaining how). They are computed from the results, so there is nothing to store.
- **Rivalries:** each profile shows the closest rival, nemesis and favourite opponent, from head-to-head records over at least `minForRival` shared puzzles (default 5). Tap a name to open the comparison.

## Time zones: which day a result counts for

A puzzle belongs to the same day for everyone, but some games switch puzzles at midnight UTC (7pm US East, 4pm US West), so a US friend can get "tomorrow's" puzzle in their evening. To keep streaks, the "Today" pills and the Daily and Recent tabs honest, every new submission records the sender's browser time zone (a `tz` column in the sheet), and a result counts for the **earlier** of the puzzle's day and the day it was submitted in the sender's own zone. Ranking is still by puzzle number, and late backfills still count for the puzzle's day. Hover a result that was moved to see why.

- **Turn it on:** after updating `backend/Code.gs`, use *Deploy → Manage deployments → Edit → New version*. Until then everything still works; results just don't carry a time zone.
- **Older results** have no recorded zone. Give a friend's zone in `playerTimezones` in `config.js` (player in lower case, an IANA name such as `America/Los_Angeles`) and their older results are treated the same way. Any US zone gives the same answer for results submitted in the evening there.

