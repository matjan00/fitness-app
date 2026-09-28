# Where we are (2026-09-28)

## Done
- Foundation, Gym, Food, Running — built, QA'd twice (87 tests pass), committed locally.
- Supabase: `records` + `strava_tokens` tables (RLS on), sign-ups off, user login created.
- Edge functions deployed: `fetch-recipe` (checks the user's login itself; strangers get 401) and `strava` (--no-verify-jwt, checks login itself).
  Deploy command (bundled npx; the global npx/npm 6 on this PC is broken):
  "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js" --yes supabase@2.118.0 functions deploy <name> --project-ref txhcnqwrdazgaxjwabln --use-api
  SQL: same prefix + `db query --linked --project-ref txhcnqwrdazgaxjwabln -f file.sql`
- docs/config.js filled in (app now shows the login screen).

## Waiting for the user
1. Approve the summary → user pushes to GitHub (one PowerShell command).
2. Strava API app (strava.com/settings/api, callback domain matjan00.github.io) → put Client ID + Secret into Supabase dashboard → Edge Functions → Secrets as STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET.
3. Garmin Connect → Connected apps → Strava.
4. Install on the phone (Chrome → ⋮ → Add to Home screen / Install app) and log in.

## Later ideas (from QA)
- Allow moving food-search / quick-add diary entries between meals (only recipe entries can move now).
- Recipes whose caption has no line breaks at all still parse only partially (edit screen fixes it).

## Next (decided 2026-09-28 with the user)
A. Recipes → manual-first: user types everything; pasted link is saved + app auto-grabs title + cover photo (saved as its own compressed copy; own photo from camera/gallery also possible); ingredients typed with food-DB autocomplete + auto macros; tags auto-suggested but editable. Link auto-import of ingredients/subtitles no longer the main path (user found TikTok fetching unreliable).
B. "Learn to cook" section in Food: ~16 short lessons for a HOME COOK, focus: fit/high-protein meals + flavour & seasoning. Each: why it works, key steps, common mistakes, doneness cues/temps, practice task, video-search link; progress (learned, practice log with rating/notes); recipes tagged with a technique link to its lesson and vice versa.
