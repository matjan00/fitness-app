#!/usr/bin/env python3
"""Unit tests for the pure/no-network parts of fitatu_sync.py — run with:
python scripts/test_fitatu_sync.py (or `python -m unittest`)."""
import base64
import json
import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(__file__))
import fitatu_sync as fs

USER = "3f2a9c10-1111-4222-8333-444455556666"


def item(energy, protein, fat, carbs, **over):
    return {"name": "x", "energy": energy, "protein": protein, "fat": fat, "carbohydrate": carbs, **over}


def token(payload):
    seg = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"eyJhbGciOiJIUzI1NiJ9.{seg}.sig"


class DayTotals(unittest.TestCase):
    def test_sums_every_meal(self):
        plan = {"dietPlan": {
            "breakfast": {"items": [item(350, 20.4, 10, 40.2), item(50.6, 1, 0.5, 9)]},
            "dinner": {"items": [item(700, 45, 25.25, 60)]},
            "snack": {"items": []},
        }}
        self.assertEqual(fs.day_totals(plan), {"kcal": 1101, "p": 66.4, "c": 109.2, "f": 35.8, "items": 3})

    def test_empty_day_is_none(self):
        self.assertIsNone(fs.day_totals({"dietPlan": {"breakfast": {"items": []}}}))
        self.assertIsNone(fs.day_totals({}))
        self.assertIsNone(fs.day_totals(None))

    def test_nulls_and_junk_count_as_zero(self):
        plan = {"dietPlan": {"supper": {"items": [item(None, "abc", None, 10), "junk"]}, "x": None}}
        self.assertEqual(fs.day_totals(plan), {"kcal": 0, "p": 0, "c": 10, "f": 0, "items": 1})

    def test_skips_deleted_rows(self):
        plan = {"dietPlan": {"breakfast": {"items": [item(100, 1, 1, 1), item(900, 9, 9, 9, deletedAt="2026-10-01 10:00:00")]}}}
        self.assertEqual(fs.day_totals(plan)["kcal"], 100)


class Planning(unittest.TestCase):
    def test_new_day_is_saved(self):
        t = {"kcal": 2000, "p": 150, "c": 200, "f": 60, "items": 9}
        self.assertEqual(fs.plan_day(None, "2026-10-18", t), ("put", {"day": "2026-10-18", **t}))

    def test_unchanged_day_is_skipped(self):
        t = {"kcal": 2000, "p": 150, "c": 200, "f": 60, "items": 9}
        self.assertEqual(fs.plan_day({"day": "2026-10-18", **t}, "2026-10-18", t), (None, None))

    def test_changed_day_is_saved(self):
        old = {"day": "2026-10-18", "kcal": 1500, "p": 100, "c": 150, "f": 50, "items": 5}
        t = {"kcal": 2000, "p": 150, "c": 200, "f": 60, "items": 9}
        self.assertEqual(fs.plan_day(old, "2026-10-18", t)[0], "put")

    def test_emptied_day_is_deleted(self):
        self.assertEqual(fs.plan_day({"day": "2026-10-18", "kcal": 10}, "2026-10-18", None), ("delete", None))
        self.assertEqual(fs.plan_day(None, "2026-10-18", None), (None, None))

    def test_sync_window(self):
        days = fs.sync_days({}, date(2026, 10, 19), start=date(2026, 1, 1))
        self.assertEqual(len(days), fs.FIRST_SYNC_DAYS)
        self.assertEqual(days[-1], "2026-10-19")
        days = fs.sync_days({"first_sync_done": True}, date(2026, 10, 19), start=date(2026, 1, 1))
        self.assertEqual(days, ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"])

    def test_nothing_before_the_start_day(self):
        self.assertEqual(fs.sync_days({}, date(2026, 10, 19)), [])
        self.assertEqual(fs.sync_days({}, date(2026, 10, 22)), ["2026-10-20", "2026-10-21", "2026-10-22"])
        self.assertEqual(fs.sync_days({"first_sync_done": True}, date(2026, 10, 21)), ["2026-10-20", "2026-10-21"])


class Ids(unittest.TestCase):
    def test_ids_are_stable_and_distinct(self):
        self.assertEqual(fs.day_record_id(USER, "2026-10-18"), fs.day_record_id(USER, "2026-10-18"))
        self.assertNotEqual(fs.day_record_id(USER, "2026-10-18"), fs.day_record_id(USER, "2026-10-19"))
        self.assertNotEqual(fs.status_record_id(USER), fs.day_record_id(USER, "2026-10-18"))

    def test_user_id_from_token(self):
        self.assertEqual(fs.jwt_user_id(token({"id": 1234567, "exp": 1})), "1234567")
        self.assertEqual(fs.jwt_user_id(token({"sub": "abc"})), "abc")
        self.assertIsNone(fs.jwt_user_id(token({"exp": 1})))
        self.assertIsNone(fs.jwt_user_id("not-a-jwt"))
        self.assertIsNone(fs.jwt_user_id(None))


if __name__ == "__main__":
    unittest.main()
