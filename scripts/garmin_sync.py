#!/usr/bin/env python3
"""Pull running activities from Garmin Connect (unofficial API via the garminconnect / garth
libraries) and upsert them into the Supabase `records` table as kind 'run', in the same record
shape the app's coach/detail views already expect (see supabase/functions/strava/map.js).

Runs on a schedule from .github/workflows/garmin-sync.yml. This repo (and its Actions logs) are
PUBLIC — never print activity data, names, HR, locations, emails, user ids or tokens. Only counts
and generic messages.

Pure / testable logic (no network) lives in functions that take plain dicts and return plain
dicts, so scripts/test_garmin_sync.py can exercise them without garminconnect installed.
Everything that talks to the network (Garmin login, Garmin API calls, Supabase REST) is kept in
separate functions and imports its dependencies lazily.
"""
import json
import math
import os
import sys
import time
import uuid
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

# ---------------------------------------------------------------------------
# Config / constants
# ---------------------------------------------------------------------------

RUN_TYPE_KEYS = {"running", "treadmill_running", "trail_running", "track_running"}
FIRST_SYNC_DAYS = 180
INCREMENTAL_SYNC_DAYS = 21
MAX_DETAIL_FETCHES = 40
DETAIL_SLEEP_S = 1.0
BEST_EFFORT_DISTANCES = [
    ("1k", 1000),
    ("1 mile", 1609.34),
    ("5k", 5000),
    ("10k", 10000),
    ("Half-Marathon", 21097.5),
]

STATUS_KIND = "garmin-status"
RUN_KIND = "run"
NAMESPACE = uuid.UUID("6f2f5a3e-6a1a-4a55-9c2e-6d0d6a1a3b10")  # fixed namespace for this app's uuid5 ids


# ---------------------------------------------------------------------------
# Pure helpers (unit tested)
# ---------------------------------------------------------------------------

def is_running_activity(activity):
    """Does a Garmin activity summary represent a run we keep?"""
    if not activity:
        return False
    type_key = ((activity.get("activityType") or {}).get("typeKey") or "").lower()
    return type_key in RUN_TYPE_KEYS


def run_record_id(user_id, garmin_activity_id):
    """Deterministic record id for (user, Garmin activity) so re-syncs update, not duplicate."""
    return str(uuid.uuid5(NAMESPACE, f"{user_id}:garmin:{garmin_activity_id}"))


def status_record_id(user_id):
    return str(uuid.uuid5(NAMESPACE, f"{user_id}:garmin-status"))


def _num(x):
    try:
        if x is None:
            return None
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def _r1(x):
    x = _num(x)
    return None if x is None else round(x, 1)


def _r0(x):
    x = _num(x)
    return None if x is None else round(x)


def fingerprint(activity):
    """Cheap signature: changes if distance or duration change materially."""
    d = _r0(activity.get("distance"))
    dur = _r0(activity.get("duration") or activity.get("elapsedDuration"))
    return f"{d}|{dur}"


def cadence_spm(activity):
    # Garmin already reports running cadence in steps/min (unlike Strava's per-leg value).
    return _r0(
        activity.get("averageRunningCadenceInStepsPerMinute")
        or activity.get("averageRunCadence")
    )


def map_activity(activity, laps=None):
    """Map a Garmin activity summary (+ optional per-km laps) to the compact run record the
    app's UI/coach expect (same shape as supabase/functions/strava/map.js `mapActivity`), using
    garmin_id instead of strava_id. Units: Garmin distance in m, duration in s, speed in m/s."""
    activity_id = activity.get("activityId")
    type_key = ((activity.get("activityType") or {}).get("typeKey") or "").lower()
    distance_m = _r1(activity.get("distance")) or 0
    moving_s = _r0(activity.get("movingDuration") or activity.get("duration")) or 0
    data = {
        "garmin_id": str(activity_id),
        "name": activity.get("activityName") or "Run",
        "type": "Run",
        "sport": type_key,
        "trainer": type_key == "treadmill_running" or None,
        "start": _to_iso(activity.get("startTimeGMT")),
        "start_local": _to_iso(activity.get("startTimeLocal"), assume_utc=False),
        "distance_m": distance_m,
        "moving_s": moving_s,
        "elapsed_s": _r0(activity.get("elapsedDuration") or activity.get("duration")),
        "elev_m": _r1(activity.get("elevationGain")),
        "avg_hr": _r1(activity.get("averageHR")),
        "max_hr": _r0(activity.get("maxHR")),
        "avg_cadence": cadence_spm(activity),
        "avg_speed": _num(activity.get("averageSpeed")),
        "max_speed": _num(activity.get("maxSpeed")),
        "workout_type": None,
        "calories": _r0(activity.get("calories")),
        "fp": fingerprint(activity),
        "detail": bool(laps),
    }
    if laps:
        splits = splits_from_laps(laps)
        data["splits"] = splits
        data["laps"] = [
            {
                "n": i + 1,
                "d": _r1(l.get("distance")),
                "s": _r0(l.get("movingDuration") or l.get("duration")),
                "hr": _r1(l.get("averageHR")),
                "cad": cadence_spm(l),
            }
            for i, l in enumerate(laps)
            if _r1(l.get("distance")) and (l.get("movingDuration") or l.get("duration"))
        ]
        data["best_efforts"] = best_efforts_from_splits(splits)
    # Drop empty values to keep rows small (mirrors map.js).
    return {k: v for k, v in data.items() if v not in (None, "", [])}


def _to_iso(value, assume_utc=True):
    """Garmin timestamps come as 'YYYY-MM-DD HH:MM:SS' strings (GMT or local, no offset) or ms
    epoch. Normalise to ISO 8601."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    s = str(value)
    try:
        dt = datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return s
    if assume_utc:
        dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    return dt.isoformat()


def splits_from_laps(laps):
    """Garmin laps are usually auto 1 km laps already; turn them into the app's per-km split
    shape {km, d, s, hr, elev}. Filters out zero-distance/zero-time junk laps."""
    out = []
    for i, l in enumerate(laps):
        d = _r1(l.get("distance"))
        s = _r0(l.get("movingDuration") or l.get("duration"))
        if not d or not s or d <= 0 or s <= 0:
            continue
        out.append({
            "km": i + 1,
            "d": d,
            "s": s,
            "hr": _r1(l.get("averageHR")),
            "elev": _r1((l.get("elevationGain") or 0) - (l.get("elevationLoss") or 0)) if (l.get("elevationGain") is not None or l.get("elevationLoss") is not None) else None,
        })
    return [s for s in out if s.get("hr") is not None or True]


def best_efforts_from_splits(splits):
    """Approximate best efforts (1k, 1 mile, 5k, 10k, half marathon) from per-km splits using a
    sliding window over cumulative distance/time. Marked approx: true since splits are 1 km
    granularity, not continuous GPS data like Strava's segment matching."""
    if not splits:
        return []
    # Build cumulative distance/time arrays (point i = end of split i).
    cum_d = [0.0]
    cum_t = [0.0]
    for sp in splits:
        cum_d.append(cum_d[-1] + (sp.get("d") or 0))
        cum_t.append(cum_t[-1] + (sp.get("s") or 0))
    total_d = cum_d[-1]
    efforts = []
    for name, dist in BEST_EFFORT_DISTANCES:
        if total_d < dist * 0.98:
            continue
        best_time = None
        n = len(cum_d)
        for i in range(n):
            for j in range(i + 1, n):
                seg_d = cum_d[j] - cum_d[i]
                if seg_d < dist:
                    continue
                # Interpolate down to exactly `dist` assuming even pace within the last split.
                over = seg_d - dist
                seg_t = cum_t[j] - cum_t[i]
                last_split_d = cum_d[j] - cum_d[j - 1]
                last_split_t = cum_t[j] - cum_t[j - 1]
                adj_t = seg_t - (over / last_split_d * last_split_t if last_split_d > 0 else 0)
                if best_time is None or adj_t < best_time:
                    best_time = adj_t
                break  # first j where seg_d >= dist is the tightest for this i
        if best_time is not None:
            efforts.append({"name": name, "s": _r0(best_time), "distance": round(dist), "approx": True})
    return efforts


def needs_full_sync(status):
    return not bool((status or {}).get("full_sync_done"))


def sync_window_start(status, now=None):
    now = now or datetime.now(timezone.utc)
    days = FIRST_SYNC_DAYS if needs_full_sync(status) else INCREMENTAL_SYNC_DAYS
    return now - timedelta(days=days)


def plan_sync(activities, existing_by_garmin_id):
    """Given running activity summaries and existing run records (keyed by data.garmin_id),
    decide which activities are new/changed and need a detail fetch. Returns list of activities
    needing details, newest first, and a count of unchanged ones."""
    to_fetch = []
    unchanged = 0
    for a in activities:
        if not is_running_activity(a):
            continue
        gid = str(a.get("activityId"))
        old = existing_by_garmin_id.get(gid)
        if old and old.get("detail") and old.get("fp") == fingerprint(a):
            unchanged += 1
            continue
        to_fetch.append(a)
    to_fetch.sort(key=lambda a: a.get("startTimeGMT") or "", reverse=True)
    return {"to_fetch": to_fetch[:MAX_DETAIL_FETCHES], "unchanged": unchanged, "skipped": max(0, len(to_fetch) - MAX_DETAIL_FETCHES)}


# ---------------------------------------------------------------------------
# Supabase REST (network)
# ---------------------------------------------------------------------------

def _http(method, url, headers, body=None, timeout=20):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw.decode(errors="replace")


def supabase_headers(secret_key):
    return {
        "apikey": secret_key,
        "Authorization": f"Bearer {secret_key}",
        "Content-Type": "application/json",
    }


def get_sole_user_id(supabase_url, secret_key, override=None):
    if override:
        return override
    status, body = _http(
        "GET",
        f"{supabase_url}/auth/v1/admin/users",
        supabase_headers(secret_key),
    )
    if status >= 300 or not body:
        raise RuntimeError("Could not look up the app's user via Supabase Auth admin API.")
    users = body.get("users", body) if isinstance(body, dict) else body
    if not users:
        raise RuntimeError("No user found in the Supabase project.")
    return users[0]["id"]


def fetch_existing_runs(supabase_url, secret_key, user_id):
    status, body = _http(
        "GET",
        f"{supabase_url}/rest/v1/records?user_id=eq.{user_id}&kind=eq.{RUN_KIND}&deleted=eq.false&select=id,data",
        supabase_headers(secret_key),
    )
    if status >= 300:
        raise RuntimeError("Could not read existing runs from Supabase.")
    out = {}
    for row in body or []:
        gid = (row.get("data") or {}).get("garmin_id")
        if gid:
            out[str(gid)] = row["data"]
    return out


def upsert_records(supabase_url, secret_key, rows):
    if not rows:
        return
    headers = supabase_headers(secret_key)
    headers["Prefer"] = "resolution=merge-duplicates"
    for i in range(0, len(rows), 50):
        batch = rows[i:i + 50]
        status, body = _http(
            "POST",
            f"{supabase_url}/rest/v1/records?on_conflict=id",
            headers,
            body=batch,
        )
        if status >= 300:
            raise RuntimeError("Could not save runs to Supabase.")


def upsert_status(supabase_url, secret_key, user_id, data):
    row = {
        "id": status_record_id(user_id),
        "user_id": user_id,
        "kind": STATUS_KIND,
        "data": data,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "deleted": False,
    }
    upsert_records(supabase_url, secret_key, [row])


# ---------------------------------------------------------------------------
# Garmin login + fetch (network, garminconnect imported lazily)
# ---------------------------------------------------------------------------

def garmin_login():
    """Log in to Garmin Connect. Prefers a saved garth token string (GARMIN_TOKENS secret) over
    email/password, since email/password logins are more likely to hit MFA / rate limits."""
    tokens = os.environ.get("GARMIN_TOKENS")
    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")

    try:
        import garminconnect  # noqa: F401  (lazy import so unit tests don't need it installed)
        from garminconnect import Garmin
    except ImportError as e:
        raise RuntimeError("The garminconnect package is not installed.") from e

    if tokens:
        try:
            try:
                import garth
            except ImportError:
                # Newer garminconnect (0.3+) no longer uses garth: hand it the token JSON directly.
                client = Garmin(email or "token-login")
                client.login(tokenstore=tokens)
                return client
            garth.client.loads(tokens)
            client = Garmin(email or "token-login")
            client.garth = garth.client
            client.display_name = client.garth.profile.get("displayName") if client.garth.profile else None
            return client
        except Exception as e:
            raise RuntimeError(f"Saved Garmin login (GARMIN_TOKENS) did not work: {type(e).__name__}. It may have expired — generate a new one with scripts/garmin_login_once.py.") from e

    if not email or not password:
        raise RuntimeError("No Garmin login available: set GARMIN_EMAIL + GARMIN_PASSWORD, or GARMIN_TOKENS.")

    try:
        client = Garmin(email, password)
        client.login()
        return client
    except Exception as e:
        msg = str(e).lower()
        if "429" in msg or "rate" in msg:
            raise RuntimeError("Garmin is rate-limiting logins (429). Try again later.") from e
        if "mfa" in msg or "code" in msg and "verif" in msg:
            raise RuntimeError(
                "Garmin is asking for a two-step verification code, which this automated job can't "
                "enter. Turn off two-step verification for the Garmin account used here, or generate "
                "a GARMIN_TOKENS secret once with scripts/garmin_login_once.py (see GARMIN-SETUP.md)."
            ) from e
        raise RuntimeError("Could not log in to Garmin Connect — check GARMIN_EMAIL / GARMIN_PASSWORD.") from e


def fetch_activities(client, start, limit=200):
    # python-garminconnect: get_activities(start, limit) newest first.
    return client.get_activities(start, limit)


def fetch_laps(client, activity_id):
    try:
        return client.get_activity_splits(activity_id) or {}
    except Exception:
        return {}


def laps_from_detail(detail):
    """Pull a flat list of per-lap dicts out of whatever shape get_activity_splits returned."""
    if not detail:
        return []
    for key in ("lapDTOs", "laps"):
        if isinstance(detail.get(key), list):
            return detail[key]
    return []


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def log(msg):
    print(msg, flush=True)


def main():
    supabase_url = os.environ.get("SUPABASE_URL", "https://txhcnqwrdazgaxjwabln.supabase.co").rstrip("/")
    secret_key = os.environ.get("SUPABASE_SECRET_KEY")
    if not secret_key:
        log("Missing SUPABASE_SECRET_KEY secret.")
        return 1
    user_override = os.environ.get("SUPABASE_USER_ID")

    try:
        user_id = get_sole_user_id(supabase_url, secret_key, user_override)
    except Exception as e:
        log(f"Could not determine the app user: {e}")
        return 1

    try:
        existing = fetch_existing_runs(supabase_url, secret_key, user_id)
    except Exception as e:
        log(f"Could not read existing runs: {e}")
        return 1

    status_id = status_record_id(user_id)
    status, sbody = _http("GET", f"{supabase_url}/rest/v1/records?id=eq.{status_id}&select=data", supabase_headers(secret_key))
    prior_status = (sbody[0]["data"] if status == 200 and sbody else {}) or {}

    try:
        client = garmin_login()
    except Exception as e:
        short = str(e).splitlines()[0]
        log(f"Garmin login failed: {short}")
        try:
            upsert_status(supabase_url, secret_key, user_id, {**prior_status, "last_error": short})
        except Exception:
            pass
        return 1

    window_start = sync_window_start(prior_status)
    try:
        activities = fetch_activities(client, 0, 200)
    except Exception as e:
        log(f"Could not fetch activities from Garmin: {type(e).__name__}")
        return 1

    # Keep only activities inside the sync window.
    def within_window(a):
        iso = _to_iso(a.get("startTimeGMT"))
        try:
            return datetime.fromisoformat(iso.replace("Z", "+00:00")) >= window_start
        except Exception:
            return True
    activities = [a for a in activities if within_window(a)]

    plan = plan_sync(activities, existing)
    log(f"Garmin sync: {len(activities)} activities in window, {plan['unchanged']} unchanged, fetching details for {len(plan['to_fetch'])}.")

    rows = []
    fetched = 0
    for a in plan["to_fetch"]:
        laps = laps_from_detail(fetch_laps(client, a.get("activityId")))
        data = map_activity(a, laps)
        rec_id = run_record_id(user_id, a.get("activityId"))
        rows.append({
            "id": rec_id,
            "user_id": user_id,
            "kind": RUN_KIND,
            "data": data,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "deleted": False,
        })
        fetched += 1
        time.sleep(DETAIL_SLEEP_S)

    try:
        upsert_records(supabase_url, secret_key, rows)
    except Exception as e:
        log(f"Could not save runs: {e}")
        return 1

    runs_total = len(existing) + len([r for r in rows if str(r["data"].get("garmin_id")) not in existing])
    new_status = {
        "last_sync_at": datetime.now(timezone.utc).isoformat(),
        "runs_total": runs_total,
        "full_sync_done": True,
        "last_error": None,
    }
    try:
        upsert_status(supabase_url, secret_key, user_id, new_status)
    except Exception as e:
        log(f"Saved runs but could not update sync status: {e}")
        return 1

    log(f"Garmin sync complete: saved {fetched} run(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
