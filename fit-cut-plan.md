# FIT — 11-Week Cut Plan + App Build Spec

**How to use this file:** Drop it into the root of the `fit` project and tell Claude Code:
> "Read fit-cut-plan.md. Inspect the existing app first, then implement Part 2 on top of what's there, reusing existing screens/data where possible. Seed the app with the data in Part 1. Ask me before deleting or rewriting anything major."

## Build status (stages agreed 2026-10-05; one branch / review per stage)
1. ✅ Settings, data model, plan seeding (Upper A/B/C routines, dated plan), JSON export/import (already existed) — `docs/cut-calc.js`, `docs/cut.js`
2. ✅ Today screen: daily checklist, day status, streaks, minimum day
3. ✅ Workout logger: prefilled sets, rest timer, verdicts, progression engine
4. ✅ Trend weight, adaptive TDEE, red flags, "Log yesterday"
5. ✅ Weekly review: measurements, photos, grading, adjustment suggestions
6. ✅ Progress charts, photo comparison, reminders

Implementation notes: weight stays in the existing `bodyweight` records; kcal/macros targets are the Food tab's targets
(config `food`); plan settings in config `cut`; new record kinds `daily`, `checkin`, `targets` (targets history).

---

# PART 1 — THE PLAN

## Goal & numbers
- **Start:** whatever you weigh in the first 3 mornings after the holiday (average them). Example below assumes 73kg.
- **Goal:** 65kg, keeping as much muscle and strength as possible.
- **Rate:** 0.75kg/week of *trend* weight → ~11 weeks of cutting, plus up to 2 buffer weeks.
- **Weekly structure:** 3 upper-body lifts (Upper A → B → C, rotating) + 2 runs (Easy + Quality), never two lifts on consecutive days.

## Nutrition targets (starting point; the app adjusts them)
| Target | Value | Notes |
|---|---|---|
| Calories | **1,750 kcal/day** | Estimated maintenance ≈ 2,500. The app recalculates your real maintenance from data after 2–3 weeks. |
| Protein | **150 g/day** (min 140) | The single most important number for keeping muscle in a fast cut. |
| Fat | **~55 g/day** (min 45) | Don't go lower for hormones/recovery. |
| Carbs | **~165 g/day** | The remainder. Put most around training. |
| Hard floor | 1,550 kcal | The app never suggests going below this; it raises steps instead. |

Calories/macros are still tracked in your separate food app. Enter the day totals in Fit.

## Daily non-negotiables (the "green day")
A day is **green** if all of these are hit:
1. Weighed in (morning, after bathroom, before food)
2. Protein ≥ 140 g
3. Calories within target ±100
4. Steps ≥ 10,000 (minimum 8,000 counts as "yellow", not failed)
5. Sleep ≥ 7 h
6. Scheduled session done (or none scheduled)

**Minimum day** (for bad days, travel, illness): weigh-in + protein ≥ 140 + 6,000 steps. A minimum day keeps your streak alive but is graded yellow. Max 1 per week without a flag.

## Weekly checkpoints
Target trend weight = start − 0.75 × week (example from 73kg):

| Week | Phase | Target trend weight | Training focus |
|---|---|---|---|
| 1 | Re-entry | 72.3 | Find working weights (RPE 7–8). Expect a bigger drop (holiday water). |
| 2 | Block 1 | 71.5 | Progress |
| 3 | Block 1 | 70.8 | Progress |
| 4 | Block 1 | 70.0 | Progress, **checkpoint 1** |
| 5 | Deload | 69.3 | Same weights, half the sets. Calories unchanged. |
| 6 | Block 2 | 68.5 | Progress / hold |
| 7 | Block 2 | 67.8 | Progress / hold |
| 8 | Block 2 | 67.0 | Hold, **checkpoint 2** |
| 9 | Block 2 | 66.3 | Hold |
| 10 | Deload | 65.5 | Same weights, half the sets |
| 11 | Final | 65.0 | **Goal week**: re-test lifts + 5k time trial |
| 12–13 | Buffer | — | Only if behind. Otherwise start maintenance. |

**After reaching the goal:** raise calories by +150/week for 3–4 weeks toward maintenance (~2,400–2,500), keeping weight within 65–66kg. Then the focus shifts to muscle gain at maintenance or a small surplus.

## Strength (3x/week upper body, rotate A → B → C)
Week 1: work up to a weight where each set ends with ~2 reps in reserve. That becomes your baseline.

Upper body only in the gym; your legs get trained by the two runs and the daily steps. Abs are crunches only.

**Upper A**
| Exercise | Sets × reps | Rest |
|---|---|---|
| Machine Chest Press | 4 × 6–10 | 2–3 min |
| Chest-Supported DB Row | 4 × 8–10 | 2 min |
| DB Lateral Raise | 3 × 12–15 | 60 s |
| DB Curl | 3 × 10–12 | 60 s |
| Crunch (weighted or cable) | 3 × 12–20 | 60 s |

**Upper B**
| Exercise | Sets × reps | Rest |
|---|---|---|
| Overhead Press | 4 × 6–8 | 2–3 min |
| Pull-Up (or Lat Pulldown) | 4 × 6–10 | 2 min |
| Reverse Pec Deck | 3 × 12–15 | 60 s |
| Triceps Pushdown | 3 × 12–15 | 60 s |
| Crunch (weighted or cable) | 3 × 12–20 | 60 s |

**Upper C**
| Exercise | Sets × reps | Rest |
|---|---|---|
| Incline DB Press | 3 × 8–12 | 2 min |
| Seated Cable Row | 3 × 10–12 | 90 s |
| DB Lateral Raise | 3 × 12–15 | 60 s |
| Hammer Curl | 3 × 10–12 | 60 s |
| Overhead Triceps Extension | 3 × 12–15 | 60 s |
| Crunch (weighted or cable) | 3 × 12–20 | 60 s |

**Progression (double progression):**
- When all sets hit the **top** of the rep range → next time add **+2.5kg** (presses, rows, pulldowns). Isolation exercises and crunches: add reps first, then the smallest weight jump. Pull-ups: add reps, then weight once you hit 4 × 10.
- Missed the bottom of the range on 2+ sets → repeat the weight next time.
- Same lift fails to progress for **3 sessions** → drop 10% and rebuild.
- In a fast cut, **holding** your strength in weeks 6–11 counts as a win. Losing more than 5% on a main lift is a red flag (see below).

## Workout judging (every session, based on what you actually lift)
Every exercise is compared with the **last time you did that same exercise**, using the weight and reps of every set.

**Exercise verdict**
| Verdict | When |
|---|---|
| ⬆️ Beat | More weight at the same or more reps, **or** more total reps at the same weight |
| ➡️ Matched | Same weight, same total reps (±1) |
| ⬇️ Dropped | Fewer total reps at the same weight, or best-set e1RM down > 3% |

**Next session's prescription** is set from what you actually did, not from the plan:
| What you did | Next time |
|---|---|
| All sets at the top of the rep range | Add weight (+2.5kg, or the smallest jump on isolation/crunches), reps reset to the bottom of the range |
| Beat, but not at the top yet | Same weight, target +1 rep on your weakest set(s) |
| Matched | Same weight, same target; beat it by 1 rep |
| Any set below the bottom of the range | Same weight, repeat |
| Below the range 2 sessions in a row | −5% weight |
| No improvement for 3 sessions | −10% weight and rebuild |

**Session verdict**, shown when you finish:
- **Progressed:** at least half the exercises beat last time, and none of the main lifts dropped
- **Held:** no main lift dropped (counts as a pass, especially in weeks 6–11)
- **Dropped:** any main lift dropped. Two "Dropped" sessions in a row trigger the strength red flag.

Main lifts: Machine Chest Press, Overhead Press, Chest-Supported DB Row, Pull-Up/Lat Pulldown, Incline DB Press. In deload weeks, sessions are judged only on completion, not on performance.

**Deload weeks (5, 10):** same weights, 2 sets instead of 3–4, no grinding reps.

## Running (2x/week, on non-lifting days)
**Easy run**, at a conversational pace (6:30–6:45/km):
- Weeks 1–4: 30–35 min
- Weeks 6–9: 40 min
- Week 11: 45 min

**Quality run**, always with a 10-min easy warm-up and cool-down:
| Week | Session |
|---|---|
| 1 | 4 × 800m @ 5:25/km, 2 min jog between |
| 2 | 5 × 800m @ 5:25/km |
| 3 | 4 × 1000m @ 5:20/km, 2–3 min jog |
| 4 | 5 × 1000m @ 5:20/km |
| 5 | Deload: 20 min easy + 6 × 20 s strides |
| 6 | 2 × 10 min tempo @ 5:35/km, 3 min jog |
| 7 | 3 × 8 min tempo @ 5:35/km |
| 8 | 20 min continuous tempo @ 5:40/km |
| 9 | 5 × 1000m @ 5:15/km |
| 10 | Deload: 20 min easy + 6 × 20 s strides |
| 11 | **5k time trial** (benchmark) |

## Example week (order flexible)
Mon: Upper A · Tue: Easy run · Wed: Upper B · Thu: Quality run · Fri: Upper C · Sat: Steps only · Sun: Rest + weekly check-in (measurements, photos, review)

## Weekly check-in (same day each week, morning)
- **Measurements:** waist at the navel, hips, chest, relaxed arm, mid-thigh. Same tape, same spots.
- **Photos:** front, side, back. Same place, light, time and clothes.
- **Review:** the app grades the week; you write one sentence: *"What went wrong, and the one fix for next week."*

## Automatic adjustment rules
Checked every review, using 2 weeks of trend data:
| Situation | Action |
|---|---|
| Losing < 0.5 kg/week, compliance ≥ 85% | −100 kcal **or** +2,000 steps/day (steps first if already at 1,650 or below) |
| Losing < 0.5 kg/week, compliance < 85% | No change to targets. **Fix compliance first.** |
| Losing 0.5–1.0 kg/week | No change |
| Losing > 1.0 kg/week (after week 2) | +150 kcal |
| Main lift down > 5% over 2 weeks | +150 kcal on lifting days, check sleep |
| Avg sleep < 6.5 h for the week | Flag; the sleep target becomes the week's #1 fix |

## Red flags (shown at the top of the app until resolved)
- 2 scheduled workouts missed in a week
- Protein under 140 g for 3 days in a row
- No weigh-in for 3 days
- Weekly check-in skipped
- Trend weight behind the checkpoint by > 1 kg
- Main lift e1RM down > 5%
- Feeling dizzy, persistently exhausted, or performance crashing → slow the rate to 0.5 kg/week. This is not a willpower problem.

---

# PART 2 — APP BUILD SPEC (for Claude Code)

Implement on top of the existing `fit` app. Keep the existing tech stack and styling. Mobile-first: the app must be fast to use one-handed in the gym.

## 1. Settings / Profile
- Start date, start weight (auto-filled from the average of the first 3 weigh-ins), goal weight (65), target rate (0.75 kg/week), height, age, sex
- Nutrition targets (kcal, protein, fat, carbs), step target, sleep target, editable
- Weekly check-in day
- Export/import all data as JSON (backup)

## 2. Data model (adapt names to the existing code)
- `DailyLog`: date, weight, sleepHours, steps, kcal, protein, carbs, fat, isMinimumDay, note
- `WeeklyCheckin`: date, waist, hips, chest, arm, thigh, photo refs (front/side/back), reflection text, grade
- `WorkoutSession`: date, type (A/B/C/Easy/Quality), exercises → sets (weight, reps, RPE optional), for runs: distance, duration, auto pace
- `PlanWeek`: week number, phase, target trend weight, quality run prescription, easy run duration, isDeload
- `TargetsHistory`: date, kcal, protein, steps (so adjustments are traceable)
- Seed `PlanWeek` and routines from Part 1.

## 3. Core calculations
- **Trend weight:** exponential moving average of daily weights (α = 0.1); show both raw and trend.
- **Projected line:** start − rate × weeks, flattening at the goal.
- **Adaptive maintenance (TDEE):** after 14+ days of data, TDEE = avg kcal − (Δ trend kg × 7,700 / days), on a rolling 21-day window. Show it next to the initial estimate.
- **e1RM** per main lift (Machine Chest Press, Overhead Press, Chest-Supported DB Row, Pull-Up/Lat Pulldown) (Epley: weight × (1 + reps/30)) from the best set of each session.
- **Progression engine:** after every session, apply the Part 1 "Workout judging" rules to the sets actually logged: store a verdict per exercise (Beat / Matched / Dropped) and per session (Progressed / Held / Dropped), and pre-fill the next session's weight and target reps from those actual results. Track consecutive below-range and no-improvement counts per exercise for the −5% / −10% rules. Swapped exercises are judged against their own history.
- **Day status:** green / yellow / red per the Part 1 rules.
- **Week grade:** % of green days + workouts done/scheduled + check-in done + strength score (Progressed = 100%, Held = 80%, Dropped = 0% per session, averaged) → A (≥ 90%), B (≥ 80%), C (≥ 70%), D (≥ 60%), E (≥ 50%), F (< 50%).

## 4. Screens
1. **Today**
   - Week X of 11, phase, days to goal
   - Today's prescribed session (exact weights/reps or run details) with a "Start" button
   - Daily checklist: weight, sleep, steps, kcal/macros, each tappable to enter a value in under 10 s
   - Red flags banner, current streaks (check-in streak, protein streak, green-day streak)
2. **Workout logger**
   - Pre-filled sets from the progression engine; tap to confirm, or adjust the weight/reps
   - Rest timer auto-starts after each set, using the Part 1 rest times
   - Shows last session's numbers next to each exercise, and today's target ("Target: 40kg × 9, 8, 8 — last time 40kg × 8, 8, 7")
   - After each set, an instant mark: ⬆️ above target, ➡️ on target, ⬇️ below target
   - End-of-workout summary: verdict per exercise, session verdict, best sets, e1RM change for main lifts, and next session's prescription
   - Swap exercise (e.g. Pull-Up → Lat Pulldown, Machine Chest Press → DB Flat Press) keeps the history separate
   - Runs: distance + time → auto pace, compared against the prescribed pace
3. **Plan**: all 11(+2) weeks, the current week highlighted, the checkpoint target weights, the deload weeks marked
4. **Weekly review** (opens on check-in day, can't be dismissed until completed)
   - Measurements + 3 photo slots
   - Auto summary: trend change vs target, avg kcal/protein/steps/sleep vs targets, sessions done, lift changes, grade
   - Adjustment suggestion from the Part 1 rules → Accept / Ignore (choices logged)
   - Required reflection sentence
5. **Progress**
   - Weight chart: raw dots + trend line + projected line + goal line
   - Waist chart, e1RM chart per main lift, run pace chart, weekly grade history
   - Photo comparison: pick any 2 weeks side by side

## 5. Accountability mechanics
- Morning reminder (weigh-in) and evening reminder (log nutrition/steps/sleep) if the platform supports notifications; otherwise an in-app prompt on open.
- If yesterday wasn't logged, the app opens on a "Log yesterday" screen first.
- Missed workout: the rotation does not skip (if B is missed, B is next), and the app suggests the next free day that keeps lifts non-consecutive.
- Minimum-day button: one tap, max 1/week before it raises a flag.
- Honest framing: no fake praise. Show the numbers vs targets plainly.

## 6. Acceptance checks
- Entering a full day takes < 60 s.
- Logging a full lifting session needs only taps when hitting the prescribed numbers.
- Changing the start date re-dates the whole plan.
- Exported JSON re-imports with no data loss.
