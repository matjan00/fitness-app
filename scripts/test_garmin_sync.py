#!/usr/bin/env python3
"""Unit tests for the pure/no-network parts of garmin_sync.py. No garminconnect install or
network access needed — run with: python scripts/test_garmin_sync.py (or `python -m unittest`)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import garmin_sync as gs

USER = "3f2a9c10-1111-4222-8333-444455556666"


def fixture_activity(activity_id=123456, **over):
    a = {
        "activityId": activity_id,
        "activityName": "Morning Run",
        "activityType": {"typeKey": "running"},
        "startTimeGMT": "2026-09-20 06:10:00",
        "startTimeLocal": "2026-09-20 08:10:00",
        "distance": 8012.4,
        "duration": 2901.0,
        "movingDuration": 2880.0,
        "elapsedDuration": 2990.0,
        "elevationGain": 41.3,
        "averageHR": 148.36,
        "maxHR": 171,
        "averageRunningCadenceInStepsPerMinute": 169.2,
        "averageSpeed": 2.762,
        "maxSpeed": 4.1,
        "calories": 540,
    }
    a.update(over)
    return a


def fixture_laps(n=8, km_s=355):
    """n auto 1km laps of km_s seconds each (some variation), for best-effort tests."""
    laps = []
    for i in range(n):
        laps.append({
            "distance": 1000.0,
            "movingDuration": km_s + (i % 3) * 2,
            "averageHR": 145 + i,
            "elevationGain": 3.0,
            "elevationLoss": 1.0,
        })
    return laps


class TestPureHelpers(unittest.TestCase):
    def test_is_running_activity(self):
        self.assertTrue(gs.is_running_activity({"activityType": {"typeKey": "running"}}))
        self.assertTrue(gs.is_running_activity({"activityType": {"typeKey": "trail_running"}}))
        self.assertTrue(gs.is_running_activity({"activityType": {"typeKey": "treadmill_running"}}))
        self.assertTrue(gs.is_running_activity({"activityType": {"typeKey": "track_running"}}))
        self.assertFalse(gs.is_running_activity({"activityType": {"typeKey": "cycling"}}))
        self.assertFalse(gs.is_running_activity(None))
        self.assertFalse(gs.is_running_activity({}))

    def test_run_record_id_deterministic(self):
        a = gs.run_record_id(USER, 555)
        b = gs.run_record_id(USER, 555)
        c = gs.run_record_id(USER, 556)
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        self.assertRegex(a, r"^[0-9a-f-]{36}$")
        # different user -> different id for same activity
        self.assertNotEqual(a, gs.run_record_id("other-user", 555))

    def test_status_record_id_stable_per_user(self):
        self.assertEqual(gs.status_record_id(USER), gs.status_record_id(USER))
        self.assertNotEqual(gs.status_record_id(USER), gs.run_record_id(USER, 1))

    def test_fingerprint_changes_with_distance_or_duration(self):
        a = fixture_activity()
        b = fixture_activity(distance=9000)
        c = fixture_activity(duration=3200, movingDuration=3200)
        self.assertEqual(gs.fingerprint(a), gs.fingerprint(fixture_activity()))
        self.assertNotEqual(gs.fingerprint(a), gs.fingerprint(b))
        self.assertNotEqual(gs.fingerprint(a), gs.fingerprint(c))

    def test_map_activity_summary_only(self):
        d = gs.map_activity(fixture_activity())
        self.assertEqual(d["garmin_id"], "123456")
        self.assertEqual(d["distance_m"], 8012.4)
        self.assertEqual(d["moving_s"], 2880)
        self.assertEqual(d["avg_hr"], 148.4)
        self.assertEqual(d["avg_cadence"], 169)
        self.assertTrue(d["start"].startswith("2026-09-20T06:10:00"))
        self.assertFalse(d["detail"])
        self.assertNotIn("splits", d)
        self.assertNotIn("strava_id", d)

    def test_map_activity_treadmill_marks_trainer(self):
        d = gs.map_activity(fixture_activity(activityType={"typeKey": "treadmill_running"}))
        self.assertTrue(d["trainer"])

    def test_map_activity_drops_empty_fields(self):
        d = gs.map_activity(fixture_activity(averageHR=None, maxHR=None))
        self.assertNotIn("avg_hr", d)
        self.assertNotIn("max_hr", d)

    def test_map_activity_with_laps_adds_splits_and_best_efforts(self):
        d = gs.map_activity(fixture_activity(distance=8100, duration=2860, movingDuration=2860), fixture_laps(8))
        self.assertTrue(d["detail"])
        self.assertEqual(len(d["splits"]), 8)
        self.assertEqual(d["splits"][0]["km"], 1)
        self.assertEqual(len(d["laps"]), 8)
        self.assertTrue(all(e.get("approx") for e in d["best_efforts"]))
        names = [e["name"] for e in d["best_efforts"]]
        self.assertIn("1k", names)
        self.assertIn("5k", names)

    def test_splits_from_laps_filters_junk(self):
        laps = fixture_laps(2) + [{"distance": 0, "movingDuration": 0}]
        splits = gs.splits_from_laps(laps)
        self.assertEqual(len(splits), 2)

    def test_best_efforts_needs_enough_distance(self):
        short = gs.best_efforts_from_splits(gs.splits_from_laps(fixture_laps(3)))
        names = [e["name"] for e in short]
        self.assertIn("1k", names)
        self.assertNotIn("5k", names)

    def test_best_efforts_empty_for_no_splits(self):
        self.assertEqual(gs.best_efforts_from_splits([]), [])

    def test_needs_full_sync(self):
        self.assertTrue(gs.needs_full_sync(None))
        self.assertTrue(gs.needs_full_sync({}))
        self.assertTrue(gs.needs_full_sync({"full_sync_done": False}))
        self.assertTrue(gs.needs_full_sync({"full_sync_done": True}))  # done before the 40-run fix: fill history once more
        self.assertFalse(gs.needs_full_sync({"full_sync_done": True, "history_v2": True}))

    def test_sync_window_start_first_vs_incremental(self):
        import datetime as dt
        now = dt.datetime(2026, 9, 28, tzinfo=dt.timezone.utc)
        first = gs.sync_window_start(None, now)
        later = gs.sync_window_start({"full_sync_done": True, "history_v2": True}, now)
        self.assertEqual((now - first).days, gs.FIRST_SYNC_DAYS)
        self.assertEqual((now - later).days, gs.INCREMENTAL_SYNC_DAYS)

    def test_plan_sync_skips_unchanged_and_non_runs(self):
        a1 = fixture_activity(123, startTimeGMT="2026-09-20 06:10:00")
        a2 = fixture_activity(124, startTimeGMT="2026-09-21 06:10:00")
        ride = fixture_activity(125, activityType={"typeKey": "cycling"})
        existing = {"123": {"detail": True, "fp": gs.fingerprint(a1)}}
        plan = gs.plan_sync([a1, a2, ride], existing)
        ids = [a["activityId"] for a in plan["to_fetch"]]
        self.assertEqual(ids, [124])
        self.assertEqual(plan["unchanged"], 1)

    def test_plan_sync_refetches_when_fingerprint_changes(self):
        a1 = fixture_activity(123, distance=9999)
        existing = {"123": {"detail": True, "fp": "stale"}}
        plan = gs.plan_sync([a1], existing)
        self.assertEqual(len(plan["to_fetch"]), 1)

    def test_plan_sync_caps_detail_fetches(self):
        acts = [fixture_activity(i, startTimeGMT=f"2026-09-{(i % 20) + 1:02d} 06:10:00") for i in range(1, 60)]
        plan = gs.plan_sync(acts, {})
        self.assertEqual(len(plan["to_fetch"]), gs.MAX_DETAIL_FETCHES)
        self.assertTrue(plan["skipped"] > 0)


class TestSleep(unittest.TestCase):
    def test_sleep_hours(self):
        self.assertEqual(gs.sleep_hours({"dailySleepDTO": {"sleepTimeSeconds": 26460}}), 7.3)
        self.assertIsNone(gs.sleep_hours({"dailySleepDTO": {"sleepTimeSeconds": None}}))
        self.assertIsNone(gs.sleep_hours({"dailySleepDTO": {"sleepTimeSeconds": 0}}))
        self.assertIsNone(gs.sleep_hours({}))
        self.assertIsNone(gs.sleep_hours(None))

    def test_sleep_days_first_vs_incremental(self):
        from datetime import date
        first = gs.sleep_days({}, date(2026, 10, 13))
        self.assertEqual(len(first), gs.FIRST_SLEEP_DAYS)
        self.assertEqual(first[-1], "2026-10-13")
        inc = gs.sleep_days({"sleep_sync_done": True}, date(2026, 10, 13))
        self.assertEqual(inc, ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"])

    def test_merge_sleep_new_day(self):
        self.assertEqual(gs.merge_sleep(None, "2026-10-13", 7.3), {"day": "2026-10-13", "sleepHours": 7.3, "sleepSource": "garmin"})

    def test_merge_sleep_keeps_other_fields(self):
        out = gs.merge_sleep({"day": "2026-10-13", "steps": 9000, "sleepHours": None}, "2026-10-13", 6.8)
        self.assertEqual(out["steps"], 9000)
        self.assertEqual(out["sleepHours"], 6.8)

    def test_merge_sleep_never_overwrites_hand_typed(self):
        self.assertIsNone(gs.merge_sleep({"day": "2026-10-13", "sleepHours": 8}, "2026-10-13", 6.8))
        self.assertEqual(gs.merge_sleep({"day": "2026-10-13", "sleepHours": 8}, "2026-10-13", 6.8, replace_typed=True)["sleepHours"], 6.8)

    def test_merge_sleep_updates_garmin_value_and_skips_unchanged(self):
        prev = {"day": "2026-10-13", "sleepHours": 6.5, "sleepSource": "garmin"}
        self.assertEqual(gs.merge_sleep(prev, "2026-10-13", 6.8)["sleepHours"], 6.8)
        self.assertIsNone(gs.merge_sleep(prev, "2026-10-13", 6.5))
        self.assertIsNone(gs.merge_sleep(prev, "2026-10-13", None))

    def test_daily_record_id_stable(self):
        self.assertEqual(gs.daily_record_id(USER, "2026-10-13"), gs.daily_record_id(USER, "2026-10-13"))
        self.assertNotEqual(gs.daily_record_id(USER, "2026-10-13"), gs.daily_record_id(USER, "2026-10-12"))


if __name__ == "__main__":
    unittest.main()


class TestSplitsSkipRestLaps(unittest.TestCase):
    def test_rest_lap_is_not_a_split(self):
        laps = [{"distance": 1000, "movingDuration": 300}, {"distance": 5, "movingDuration": 0, "duration": 60}, {"distance": 1000, "movingDuration": 310}]
        out = gs.splits_from_laps(laps)
        self.assertEqual([x["d"] for x in out], [1000, 1000])
