> **Superseded 2026-10-05:** everything below was built and released on 2 Oct; all holiday routines are off.
> Work now follows `fit-cut-plan.md`. Where they overlap, the cut plan replaces it (gym progression hint → cut
> progression engine; Stats tab → cut-plan charts). Nothing else from this file is planned.

# Work plan for 2026-10-02 → 2026-10-11 (user on holiday Sat 3 – Sun 11)

Rules: free only, cheap model (Sonnet) per task with a tight brief, stop safely before the weekly limit,
never commit directly to main while the user is away → each task on its own branch / pull request,
user reviews and merges when back. Run `node --test` and `node scripts/release.cjs` in every task.

## 0. Big recipe import (Friday, before he leaves — no Claude tokens needed for the run itself)
- Scale scripts/library/sources.json using LIBRARY-PLAN.md: TheMealDB categories (no Seafood; fish excluded),
  BBC Good Food high-protein collections, Skinnytaste high-protein/chicken/beef/pork/vegetarian, Pinch of Yum.
  Target ~600–900 recipes. exclude = ['seafood','fish'].
- Importer: also soft-delete library records whose source is no longer listed (pruning).
- Dry run locally → push → user clicks Actions › Recipe library import › Run workflow.

## 1. Diary: copy meals and days
- Copy a meal (all its entries) to another meal and/or another day; copy a whole day to another day.
- Also: move food-search / quick-add entries between meals (old QA idea).

## 2. Daily steps and calories burned — POSTPONED (owner wears the Garmin only for runs; phone steps need a native app or a paid bridge such as Health Sync; decide later: manual field or skip)
- A PWA can't read Android Health Connect / Google Fit directly. Use Garmin instead (the watch already counts
  steps and calories): extend scripts/garmin_sync.py to fetch daily summaries (steps, active + total kcal,
  resting HR, maybe sleep) → records kind 'daily' {day, steps, kcal_active, kcal_total, rhr}.
- Food diary: show "burned today" next to eaten; optional setting to add part of active kcal to the target.

## 3. Stats tab (graphs)
- New tab with the most important data over time (7 d / 30 d / 90 d / 1 y): kcal eaten vs target, protein/carbs/fat
  per day, body weight + trend, steps per day, running km per week, gym sessions/volume per week.
- Bottom bar would get 6 items → decide layout (e.g. Stats as a tab, icons with short labels).

## 4. Gym: exercise progress, best records, suggested progression
- "Progress" list of all exercises done: best e1RM, heaviest weight, recent trend (up/flat/down), last done.
- Exercise screen already has Records + charts — make them easy to reach from this list.
- Progression suggestions (double progression): when all working sets hit the top of the rep range → suggest
  +2.5 kg (upper body) / +5 kg (lower body) next time; otherwise suggest +1 rep. Show it as the placeholder /
  hint in the live workout ("Try 62.5 × 8") and on the progress list. Stalled 3+ sessions → suggest a deload.

## Order (by value): 0 → 4 → 1 → 3 → 2
