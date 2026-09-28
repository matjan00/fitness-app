#!/usr/bin/env python3
"""Unit tests for the pure parts of garmin_send.py (no network, no garminconnect)."""
import os
import sys
import unittest
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
import garmin_send as gsend

USER = "3f2a9c10-1111-4222-8333-444455556666"


class Send(unittest.TestCase):
    def test_ids_are_deterministic_and_distinct(self):
        a, b = gsend.request_record_id(USER), gsend.send_status_record_id(USER)
        self.assertEqual(a, gsend.request_record_id(USER))
        self.assertNotEqual(a, b)
        uuid.UUID(a)
        uuid.UUID(b)

    def test_local_today_uses_warsaw(self):
        # 23:30 UTC on 30 Sep is already 1 Oct in Warsaw (UTC+2 in summer)
        now = datetime(2026, 9, 30, 23, 30, tzinfo=timezone.utc)
        self.assertEqual(gsend.local_today(now), "2026-10-01")

    def test_validate_request(self):
        req = {"session_id": "s1", "name": "Fit W1 Easy", "steps": [{"kind": "run", "open": True}]}
        self.assertEqual(gsend.validate_request(req, "s1")[0], "Fit W1 Easy")
        for bad in (None, {"session_id": "other", "steps": [1]}, {"session_id": "s1", "steps": []}):
            with self.assertRaises(ValueError):
                gsend.validate_request(bad, "s1")

    def test_status_data(self):
        d = gsend.status_data("s1", "error", requested_at="t", error="boom")
        self.assertEqual((d["state"], d["error"], d["requested_at"]), ("error", "boom", "t"))
        self.assertNotIn("error", gsend.status_data("s1", "sent", workout_id=5))


if __name__ == "__main__":
    unittest.main()
