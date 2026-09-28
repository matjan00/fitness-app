#!/usr/bin/env python3
"""Send one planned running session to the watch as a structured Garmin Connect workout.

Flow (run by .github/workflows/garmin-send.yml, triggered through the garmin-send edge function):
  1. read the 'garmin-send-request' record the app wrote (name + ready-made steps for the session)
  2. convert to Garmin workout JSON (garmin_workouts.py), upload it, schedule it for today (Europe/Warsaw)
  3. delete the workout this app sent previously (tracked in the 'garmin-send' status record) to avoid clutter
  4. write the status record {session_id, state, workout_id, sent_at, requested_at, error?}

PRIVACY: this repo is public, so logs only carry generic messages / counts - never names, ids or paces.

Env: SUPABASE_SECRET_KEY, SESSION_ID (workflow input), optional SUPABASE_URL, SUPABASE_USER_ID,
     GARMIN_EMAIL / GARMIN_PASSWORD / GARMIN_TOKENS (see garmin_sync.garmin_login).
"""
import os
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
import garmin_sync as gs
import garmin_workouts as gw

REQUEST_KIND = "garmin-send-request"
STATUS_KIND = "garmin-send"
TIMEZONE = "Europe/Warsaw"


def request_record_id(user_id):
    return str(uuid.uuid5(gs.NAMESPACE, f"{user_id}:garmin-send-request"))


def send_status_record_id(user_id):
    return str(uuid.uuid5(gs.NAMESPACE, f"{user_id}:garmin-send"))


def _eu_offset_hours(now_utc):
    """Central European offset (1 or 2 h): summer time runs from the last Sunday of March to the last Sunday of
    October, both at 01:00 UTC. Used only when the system has no time zone database (e.g. Windows)."""
    from datetime import timedelta

    def last_sunday(year, month):
        d = datetime(year, month, 31, 1, tzinfo=timezone.utc)
        return d - timedelta(days=(d.weekday() + 1) % 7)

    y = now_utc.year
    return 2 if last_sunday(y, 3) <= now_utc < last_sunday(y, 10) else 1


def local_today(now=None, tz=TIMEZONE):
    """Today's date (YYYY-MM-DD) in the user's time zone."""
    from datetime import timedelta
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    try:
        from zoneinfo import ZoneInfo
        return now.astimezone(ZoneInfo(tz)).strftime("%Y-%m-%d")
    except Exception:
        return (now + timedelta(hours=_eu_offset_hours(now))).strftime("%Y-%m-%d")


def validate_request(req, session_id):
    """Return (name, steps) or raise ValueError with a plain-language message."""
    if not isinstance(req, dict):
        raise ValueError("No send request found. Press the button in the app again.")
    if session_id and req.get("session_id") != session_id:
        raise ValueError("The request in the app is for a different session. Press the button again.")
    steps = req.get("steps")
    if not isinstance(steps, list) or not steps:
        raise ValueError("The request had no workout steps.")
    return str(req.get("name") or "Fit run"), steps


def status_data(session_id, state, workout_id=None, requested_at=None, error=None, now=None):
    now = now or datetime.now(timezone.utc)
    d = {
        "session_id": session_id,
        "state": state,
        "workout_id": workout_id,
        "requested_at": requested_at,
        "sent_at": now.isoformat(),
    }
    if error:
        d["error"] = error
    return d


def read_record(supabase_url, secret_key, record_id):
    status, body = gs._http(
        "GET",
        f"{supabase_url}/rest/v1/records?id=eq.{record_id}&select=data,deleted",
        gs.supabase_headers(secret_key),
    )
    if status >= 300:
        raise RuntimeError("Could not read from Supabase.")
    if body and not body[0].get("deleted"):
        return body[0].get("data")
    return None


def write_status(supabase_url, secret_key, user_id, data):
    row = {
        "id": send_status_record_id(user_id),
        "user_id": user_id,
        "kind": STATUS_KIND,
        "data": data,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "deleted": False,
    }
    gs.upsert_records(supabase_url, secret_key, [row])


def main():
    supabase_url = os.environ.get("SUPABASE_URL", "https://txhcnqwrdazgaxjwabln.supabase.co").rstrip("/")
    secret_key = os.environ.get("SUPABASE_SECRET_KEY")
    session_id = (os.environ.get("SESSION_ID") or "").strip()
    if not secret_key:
        gs.log("Missing SUPABASE_SECRET_KEY secret.")
        return 1
    try:
        user_id = gs.get_sole_user_id(supabase_url, secret_key, os.environ.get("SUPABASE_USER_ID"))
    except Exception:
        gs.log("Could not determine the app user.")
        return 1

    req = None
    prev = None
    try:
        req = read_record(supabase_url, secret_key, request_record_id(user_id))
        prev = read_record(supabase_url, secret_key, send_status_record_id(user_id))
    except Exception:
        gs.log("Could not read the request from Supabase.")
        return 1

    requested_at = (req or {}).get("requested_at") if isinstance(req, dict) else None
    sid = session_id or ((req or {}).get("session_id") if isinstance(req, dict) else "") or ""

    def fail(message):
        gs.log("Send failed: " + message)
        try:
            write_status(supabase_url, secret_key, user_id, status_data(sid, "error", requested_at=requested_at, error=message))
        except Exception:
            gs.log("Could not write the status record.")
        return 1

    try:
        name, steps = validate_request(req, session_id)
        workout = gw.build_workout(name, steps)
    except (ValueError, gw.StepError) as e:
        return fail(str(e) if isinstance(e, ValueError) and not isinstance(e, gw.StepError) else "The workout could not be built from this session.")

    try:
        client = gs.garmin_login()
    except Exception as e:
        return fail(str(e)[:200] or "Could not log in to Garmin Connect.")

    try:
        result = client.upload_workout(workout)
        workout_id = (result or {}).get("workoutId") if isinstance(result, dict) else None
        if not workout_id:
            return fail("Garmin did not confirm the upload.")
        client.schedule_workout(workout_id, local_today())
    except Exception as e:
        return fail(f"Garmin Connect rejected the workout ({type(e).__name__}).")

    # Remove the workout this app sent last time (best effort; a failure here must not fail the send).
    old_id = (prev or {}).get("workout_id") if isinstance(prev, dict) else None
    if old_id and str(old_id) != str(workout_id):
        try:
            client.delete_workout(old_id)
        except Exception:
            gs.log("Could not remove the previous workout (ignored).")

    try:
        write_status(supabase_url, secret_key, user_id, status_data(sid, "sent", workout_id=workout_id, requested_at=requested_at))
    except Exception:
        gs.log("Sent, but could not write the status record.")
        return 1
    gs.log("Workout sent and scheduled for today.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
