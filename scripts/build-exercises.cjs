// Builds docs/data/exercises.json from free-exercise-db (public domain, github.com/yuhonas/free-exercise-db).
// Run: node scripts/build-exercises.js
const fs = require('fs');
const path = require('path');
const src = JSON.parse(fs.readFileSync(path.join(__dirname, 'exercises-source.json'), 'utf8'));

// Everyday gym exercises shown first in search results.
const POPULAR = `Barbell_Bench_Press_-_Medium_Grip Barbell_Squat Barbell_Deadlift Romanian_Deadlift Pullups Chin-Up
Wide-Grip_Lat_Pulldown Close-Grip_Front_Lat_Pulldown Seated_Cable_Rows Bent_Over_Barbell_Row One-Arm_Dumbbell_Row
Standing_Military_Press Dumbbell_Shoulder_Press Side_Lateral_Raise Face_Pull Dumbbell_Bench_Press
Barbell_Incline_Bench_Press_-_Medium_Grip Incline_Dumbbell_Press Dumbbell_Flyes Butterfly Dips_-_Triceps_Version
Dips_-_Chest_Version Pushups Barbell_Curl Dumbbell_Bicep_Curl Hammer_Curls EZ-Bar_Curl Preacher_Curl
Triceps_Pushdown Triceps_Pushdown_-_Rope_Attachment EZ-Bar_Skullcrusher Triceps_Overhead_Extension_with_Rope
Leg_Press Leg_Extensions Lying_Leg_Curls Seated_Leg_Curl Barbell_Hip_Thrust Barbell_Lunge Dumbbell_Lunges
Split_Squat_with_Dumbbells Goblet_Squat Front_Barbell_Squat Hack_Squat Standing_Calf_Raises Seated_Calf_Raise
Barbell_Shrug Dumbbell_Shrug Plank Cable_Crunch Hanging_Leg_Raise Crunches Reverse_Flyes Trap_Bar_Deadlift
Machine_Bench_Press Leverage_Shoulder_Press Smith_Machine_Squat T-Bar_Row_with_Handle Close-Grip_Barbell_Bench_Press
Weighted_Pull_Ups Stiff-Legged_Dumbbell_Deadlift Glute_Ham_Raise Ab_Roller`.split(/\s+/);

const byId = new Map(src.map((e) => [e.id, e]));
const missing = POPULAR.filter((id) => !byId.has(id));
if (missing.length) console.warn('Not in database (skipped):', missing.join(', '));

const out = src.map((e) => ({
  id: e.id,
  n: e.name,
  eq: e.equipment || 'other',
  p: e.primaryMuscles,
  s: e.secondaryMuscles,
  c: e.category,
  l: e.level,
  i: e.instructions,
  im: e.images.length,
  ...(POPULAR.includes(e.id) ? { pop: POPULAR.indexOf(e.id) + 1 } : {}),
}));
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'data', 'exercises.json'), JSON.stringify(out));
console.log(`Wrote ${out.length} exercises (${POPULAR.length - missing.length} popular).`);
