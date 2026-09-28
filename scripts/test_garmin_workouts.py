#!/usr/bin/env python3
"""Unit tests for garmin_workouts.py (pure; no network, no garminconnect)."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import garmin_workouts as gw

INTERVALS = [
    {"kind": "warmup", "distance_m": 2000},
    {"kind": "repeat", "reps": 5, "steps": [
        {"kind": "run", "distance_m": 1000, "pace_min_s_per_km": 252, "pace_max_s_per_km": 268},
        {"kind": "recovery", "duration_s": 90},
    ]},
    {"kind": "cooldown", "distance_m": 1500},
]


class Convert(unittest.TestCase):
    def test_speed_conversion_and_bounds(self):
        self.assertAlmostEqual(gw.speed_ms(300), 3.3333, places=3)
        self.assertLess(gw.speed_ms(400), gw.speed_ms(300))  # slower pace = lower speed
        with self.assertRaises(gw.StepError):
            gw.speed_ms(20)

    def test_intervals_structure(self):
        w = gw.build_workout("Fit W3 VO2max intervals 5x1 km", INTERVALS)
        self.assertEqual(w["sportType"]["sportTypeKey"], "running")
        seg = w["workoutSegments"][0]
        self.assertEqual(seg["segmentOrder"], 1)
        st = seg["workoutSteps"]
        self.assertEqual([s["type"] for s in st], ["ExecutableStepDTO", "RepeatGroupDTO", "ExecutableStepDTO"])
        self.assertEqual(st[0]["stepType"]["stepTypeKey"], "warmup")
        self.assertEqual(st[0]["endCondition"]["conditionTypeKey"], "distance")
        self.assertEqual(st[0]["endConditionValue"], 2000.0)
        self.assertEqual(st[0]["targetType"]["workoutTargetTypeKey"], "no.target")
        rg = st[1]
        self.assertEqual(rg["numberOfIterations"], 5)
        self.assertEqual(rg["endCondition"]["conditionTypeKey"], "iterations")
        work, rec = rg["workoutSteps"]
        self.assertEqual(work["stepType"]["stepTypeKey"], "interval")
        self.assertEqual(work["targetType"]["workoutTargetTypeKey"], "pace.zone")
        self.assertGreater(work["targetValueOne"], work["targetValueTwo"])  # faster speed first (FR55 order)
        self.assertAlmostEqual(work["targetValueOne"], 1000 / 252, places=3)
        self.assertAlmostEqual(work["targetValueTwo"], 1000 / 268, places=3)
        self.assertEqual(rec["stepType"]["stepTypeKey"], "recovery")
        self.assertEqual(rec["endCondition"]["conditionTypeKey"], "time")
        self.assertEqual(rec["endConditionValue"], 90.0)
        self.assertEqual(rec["targetType"]["workoutTargetTypeKey"], "no.target")
        self.assertEqual(work["childStepId"], rg["childStepId"])
        orders = [st[0]["stepOrder"], rg["stepOrder"], work["stepOrder"], rec["stepOrder"], st[2]["stepOrder"]]
        self.assertEqual(orders, [1, 2, 3, 4, 5])

    def test_duration_estimate(self):
        w = gw.build_workout("x", INTERVALS)
        # 2 km@6:00 + 5*(1 km@4:20 + 90 s) + 1.5 km@6:00 = 720 + 5*(260+90) + 540
        self.assertEqual(w["estimatedDurationInSecs"], 720 + 1750 + 540)

    def test_open_and_time_steps(self):
        w = gw.build_workout("x", [{"kind": "run", "open": True}, {"kind": "cooldown", "duration_s": 600}])
        s = w["workoutSegments"][0]["workoutSteps"]
        self.assertEqual(s[0]["endCondition"]["conditionTypeKey"], "lap.button")
        self.assertIsNone(s[0]["endConditionValue"])
        self.assertEqual(s[1]["endCondition"]["conditionTypeKey"], "time")

    def test_reversed_pace_bounds_still_ok(self):
        w = gw.build_workout("x", [{"kind": "run", "distance_m": 5000, "pace_min_s_per_km": 410, "pace_max_s_per_km": 370}])
        s = w["workoutSegments"][0]["workoutSteps"][0]
        self.assertGreater(s["targetValueOne"], s["targetValueTwo"])

    def test_name_cleaned_and_json_serialisable(self):
        w = gw.build_workout("  Fit   W1\nEasy " + "x" * 200, INTERVALS, description="d")
        self.assertLessEqual(len(w["workoutName"]), gw.MAX_NAME_LEN)
        self.assertNotIn("\n", w["workoutName"])
        json.dumps(w)

    def test_rejects_bad_input(self):
        for bad in ([], [{"kind": "swim", "distance_m": 1}], [{"kind": "run"}],
                    [{"kind": "repeat", "reps": 0, "steps": [{"kind": "run", "open": True}]}],
                    [{"kind": "repeat", "reps": 2, "steps": [{"kind": "repeat", "reps": 2, "steps": []}]}]):
            with self.assertRaises(gw.StepError):
                gw.build_workout("x", bad)


if __name__ == "__main__":
    unittest.main()
