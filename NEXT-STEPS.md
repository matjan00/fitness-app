# Where we are (2026-09-27, evening)

## Done
- Foundation (store/sync, navigation, shell, styles, offline cache, exercise library) — committed.
- Gym tracker — built, tested, committed (commit 40a5c03).
- Supabase project `fitness-app` (ref txhcnqwrdazgaxjwabln): `records` table created, sign-ups off, user login created.
- GitHub repo matjan00/fitness-app (public) + Pages → https://matjan00.github.io/fitness-app/ (only the foundation is pushed so far).

## In progress
- Food — DONE, committed (106cdf6). Deploy: supabase functions deploy fetch-recipe (JWT verification on). Files: docs/food*.js, docs/data/foods.json, supabase/functions/fetch-recipe/, scripts/food-*.
- Running — DONE, committed (c7fc9e3). 86/86 tests pass. Deploy: run supabase/strava.sql; Strava app callback domain matjan00.github.io; secrets STRAVA_CLIENT_ID/STRAVA_CLIENT_SECRET (user sets); supabase functions deploy strava --no-verify-jwt; Garmin Connect → Connected Apps → Strava.
- QA pass 1 (Sonnet) — stopped at 74% usage. No bugs found in what it covered (shell, gym core loop, food paste-import + diary-from-recipe). Details + untested list in QA-PROGRESS.md. Possible issue to check: after rapid navigation + fast back presses a screen once stayed half off-screen (nav.js stack vs history) — not reproduced.

## Still to do
1. Continue QA from the "Not yet tested" list in QA-PROGRESS.md (Sonnet; resume the same agent if possible). Check the nav.js rapid-back issue.
2. (merged into 1)
3. Put Supabase URL + publishable key into docs/config.js (values in lead's memory notes).
4. Deploy edge functions (fetch-recipe, strava) + run supabase/strava.sql; user creates the Strava API app and sets secrets himself.
5. Show the user a summary, then push to GitHub (user runs the push command; PowerShell needs `$env:Path += ";C:\Program Files\Git\cmd"`).
