# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
One person: the owner and developer (Polish, reads the UI in English). He lifts in the gym, runs (Garmin watch, synced via Strava/Garmin), and tracks food. Since 8 Nov 2026 the goal is to hold 70 kg and get stronger in the gym: 3 gym sessions a week, no running, no calorie or macro counting, 7.5 h sleep, and 15 km a day (km on the bike at home, typed in, plus 1 km per 1,000 phone steps). He uses the app on an Android phone as an installed PWA: one-handed between sets, on runs, in the kitchen, and each morning for the weigh-in.

## Product Purpose
"Fit" puts gym, runs, food and the cut plan in one place so the daily routine is logged quickly and judged honestly. Success: every day is logged in seconds, the app tells the truth about whether the cut is on track, and the gym session can be run entirely from the phone.

## Positioning
A personal, rule-based coach built for exactly one training life: an 11-week cut with 3 upper-body lifts + 2 runs a week, adaptive maintenance from real weigh-ins, food totals from Fitatu, and a logger that never silently drops sets. It does not try to be a general fitness platform.

## Operating Context
- Gym: live workout logger with set rows, rest timer, carried weights, routine rotation (Upper A/B/C).
- Runs: Strava/Garmin sync, run coach notes, run plan; demo data for empty states.
- Food: whole-day calories and macros synced from Fitatu every 2 hours (GitHub Action, FITATU-SETUP.md), targets, body weight. Food itself is logged in Fitatu, not in this app. A grocery list adds up the meals planned in Fitatu for the days you pick (recipes as ingredients).
- Cut plan: daily checklist (weigh-in, distance = bike km + steps/1000, sleep, weekly gym count; calories/protein only if switched on), day status (green/yellow), weekly review with measurements and photos, red flags, progress charts.
- Stats tab, Me/settings screen, backup/export, local-only mode without an account.

## Capabilities and Constraints
- Vanilla JS ES modules + plain CSS in `docs/`, served by GitHub Pages; no build step. Service worker; `node scripts/release.cjs` bumps the version.
- Supabase for login + sync; works offline / local-only.
- Tests: `node --test` (must stay green).
- UI copy stays in English. Light and dark themes follow the phone setting.
- The live workout logger's layout (set rows, rest bar, inputs) is kept structurally; it may be restyled.

## Brand Commitments
- Name: "Fit".
- Voice: blunt but kind, rule-based coach ("Set counts never go down", "Walk breaks are fine"). Honest, never shaming.

## Evidence on Hand
Real personal data lives in the user's account; demo data exists for runs (`docs/run-demo.js`). No testimonials or external claims — none are needed.

## Product Principles
1. Logging must be faster than thinking about it.
2. Tell the truth about the plan; phrase problems as the next action, not as blame.
3. One-handed, glanceable, works on the gym floor.
4. Never lose or silently change the user's data.

## Accessibility & Inclusion
WCAG AA contrast in both themes; respect reduced motion; 44px touch targets in the core loops.
