# QA pass — progress notes (2026-09-27)

Stopped at ~74% of the 5-hour usage limit (safety threshold 78%). No code was changed —
no confirmed bugs were found that needed a fix. Tests still pass (86/86, `node --test`).
Repo is clean (only the pre-existing untracked NEXT-STEPS.md).

## What was tested (worked correctly)
- App shell: Home tab loads with cards from all three modules, no console errors, no
  horizontal overflow at 375px width (`document.documentElement.scrollWidth === clientWidth`).
- Gym: starter programs (Add starter programs → Push/Pull/Legs), start workout from a
  routine, log a set (kg/reps inputs, Complete set, banner volume/set count update),
  rest timer (counts down correctly, matches the exercise's configured rest), reload
  mid-workout → "Resume workout" banner on Gym tab → resume screen has the same
  kg/reps values still filled in, Finish → confirm-drop-unticked-sets sheet → workout
  summary (duration/volume/sets, "Update routine?" prompt) → History list → workout
  detail (duration/volume/PRs/per-set est. 1RM) → Progress tab (streak, volume,
  sets-per-muscle chart) → Exercise library search ("squat" filtered correctly) →
  exercise detail (About/History/Records tabs, muscles, equipment).
  PRs correctly do NOT fire on an exercise's very first-ever log (by design — see
  `gym-calc.js` computePRs comment: "the very first session of an exercise only sets
  the baseline"). Confirmed intentional, not a bug.
- Food: paste-text import of a realistic Polish recipe (ingredients + numbered steps)
  parsed correctly — title, servings, per-ingredient food matching with Polish→English
  names and confidence badges ("Good match"/"Check"), macros computed, categories
  auto-suggested (Breakfast/Eggs). Save → recipe appears in the book. "Log to diary"
  from the recipe detail screen and "Add to Breakfast → From my recipes" both open an
  amount/meal-picker sheet that requires an explicit "Add" tap to confirm before saving
  — this is intentional (not a bug); a quick automated check without tapping "Add"
  looked like a failure at first but wasn't.
- store.js sync logic (code review): outbox/push/pull, soft-delete via `deleted` flag,
  `configId()` deterministic per-key id for config rows, `exportAll`/`importAll` backup
  round trip. Looks solid. `configured` is false with the empty config.js, so all sync
  code is correctly inert and the app runs fully local-first.

## False alarms (investigated, turned out to be test-harness artifacts, not app bugs)
- A "screen stuck half off-canvas" (Save button unreachable on the recipe review
  screen) reproduced once, but a clean repro on a fresh page load worked fine. Root
  cause: I had stress-tested the exercise-library screen by dispatching several
  synthetic `click` events and then closing them with a tight synchronous
  `for (let i=0;i<4;i++) history.back()` loop, which likely desynced nav.js's in-memory
  `stack` from the browser's real history depth for the rest of that page's life. Did
  not reproduce cleanly afterwards; no code changes made. If this class of bug is a
  real concern, it would be worth a manual on-device check of the recipe import →
  review flow, and of rapid repeated screen navigation in general.
- `document.body.innerText` via `javascript_tool` unreliably shows a *lower* screen in
  the stack instead of the top one once more than one `.screen`/sheet element exists in
  the DOM — this is a quirk of how that tool reads text, not an app bug. `read_page`
  (accessibility tree) was reliable throughout; prefer it over raw `innerText` when
  multiple screens are stacked.
- `indexedDB.deleteDatabase()` hung indefinitely mid-session — caused by stray leftover
  browser tabs (tab-2/6/7, at localhost:5190, presumably left open by the earlier
  Gym/Food build agents) holding open IndexedDB connections that blocked the
  versionchange request. Closing those tabs and clearing the object stores directly
  (instead of deleting the whole DB) resolved it. Worth remembering for future QA
  passes in this same browser profile: check `tabs_context` for stray same-origin tabs
  before touching IndexedDB.

## Not yet tested (ran out of budget)
- Gym: add/replace/reorder/remove exercise mid-workout, set types (drop set/warm-up/
  failure etc.), custom exercise creation, delete/edit a past workout.
- Food: link import (would need `scripts/food-dev-proxy.js`), recipe book filters,
  diary "Search food" and "Quick add calories" paths, date switching in the diary,
  targets calculator, body weight log.
- Run: demo mode across the Run tab/detail/weekly plan/Home card, and confirming demo
  mode writes nothing to IndexedDB.
- Cross-cutting: dark mode visual check, Android back across multiple stacked
  screens/sheets, performance with ~100 workouts / ~200 diary entries, run-coach
  reading gym workout data.
- Me tab: backup export/import.

## Leftover state note
Before I started, the shared IndexedDB already had a lot of soft-deleted (`deleted:
true`) leftover records (bodyweight, meal, food, foodmatch, recipe) from presumably
earlier build/test sessions — none of that was mine. Everything (mine and that
leftover data) was cleared: I deleted the `fitness-app` IndexedDB object stores and
`localStorage`/`sessionStorage` in the browser tab used for testing, and confirmed a
fresh reload shows a fully empty app (0 workouts, 0 kcal, no recipes). `node --test`
passes 86/86 and `git status` is clean (only the pre-existing untracked
NEXT-STEPS.md).

## For the lead to decide
None — no bugs needed a decision this pass. The next QA agent should pick up from
"Not yet tested" above, ideally resuming rather than restarting.
