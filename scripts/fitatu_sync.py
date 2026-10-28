#!/usr/bin/env python3
"""Pull whole-day calorie and macro totals from Fitatu (the private API its own web app uses) and
upsert them into the Supabase `records` table as kind 'fitatu-day' {day, kcal, p, c, f, items}.
For the grocery list it also stores what is planned and not yet eaten from today on, as kind
'fitatu-plan' {day, lines}: product names and amounts, with planned recipes split into their
ingredients. A 'fitatu-status' record tells the app when the last sync ran and whether it failed.

Runs on a schedule from .github/workflows/fitatu-sync.yml. This repo (and its Actions logs) are
PUBLIC — never print food data, emails, user ids or tokens. Only counts and generic messages.

Pure / testable logic (no network) lives in functions that take plain dicts and return plain
dicts, so scripts/test_fitatu_sync.py can exercise them. Everything that talks to the network
(Fitatu login and diary calls, Supabase REST) is kept in separate functions.

The Fitatu API is unofficial (reverse-engineered by e.g. github.com/Jezue/fitatu_library and
github.com/Capure/fitatu-sdk) and can change without notice.
"""
import base64
import json
import math
import os
import sys
import time
import uuid
import urllib.request
import urllib.error
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# ---------------------------------------------------------------------------
# Config / constants
# ---------------------------------------------------------------------------

FITATU_API = os.environ.get("FITATU_API_URL", "https://pl-pl.fitatu.com/api").rstrip("/")
# Static values the Fitatu web app sends with every call (not secrets: they are in its public JS).
FITATU_HEADERS = {
    "accept": "application/json, text/plain, */*",
    "api-key": "FITATU-MOBILE-APP",
    "api-secret": "PYRXtfs88UDJMuCCrNpLV",
    "app-uuid": "64c2d1b0-c8ad-11e8-8956-0242ac120008",
    "api-cluster": "pl-pl0",
    "app-os": "WEB",
    "app-version": "4.13.1",
    "app-locale": "pl_PL",
    "app-storagelocale": "pl_PL",
    "app-searchlocale": "pl_PL",
    "app-timezone": "Europe/Warsaw",
    "user-agent": "Mozilla/5.0",
}
TIMEZONE = ZoneInfo("Europe/Warsaw")

DAY_KIND = "fitatu-day"
STATUS_KIND = "fitatu-status"
PLAN_KIND = "fitatu-plan"
PLAN_DAYS = 14  # today and the next 13 days, for the grocery list
PORTION_MEASURE = 39  # Fitatu's measure id for one portion of a recipe
FIRST_SYNC_DAYS = 60
INCREMENTAL_SYNC_DAYS = 7  # past days get edited in Fitatu too, so re-read the last week every time
REQUEST_SLEEP_S = 0.5
# Days before this stay as they were logged in the app's own diary; Fitatu takes over from here.
START_DAY = date.fromisoformat(os.environ.get("FITATU_START") or "2026-10-20")
NAMESPACE = uuid.UUID("6f2f5a3e-6a1a-4a55-9c2e-6d0d6a1a3b10")  # same namespace as garmin_sync.py


# ---------------------------------------------------------------------------
# Pure helpers (unit tested)
# ---------------------------------------------------------------------------

def day_record_id(user_id, day):
    """Deterministic record id for (user, day) so re-syncs update, not duplicate."""
    return str(uuid.uuid5(NAMESPACE, f"{user_id}:fitatu:{day}"))


def plan_record_id(user_id, day):
    return str(uuid.uuid5(NAMESPACE, f"{user_id}:fitatu-plan:{day}"))


def status_record_id(user_id):
    return str(uuid.uuid5(NAMESPACE, f"{user_id}:fitatu-status"))


def _num(x):
    if isinstance(x, bool) or x is None:
        return 0.0
    try:
        v = float(x)
        return v if math.isfinite(v) else 0.0
    except (TypeError, ValueError):
        return 0.0


def jwt_user_id(token):
    """The Fitatu user id carried in the login token's payload (not verified, just read)."""
    parts = token.split(".") if isinstance(token, str) else []
    if len(parts) < 2:
        return None
    seg = parts[1]
    try:
        payload = json.loads(base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4)))
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    uid = payload.get("id") or payload.get("user_id") or payload.get("uid") or payload.get("sub")
    return str(uid) if uid is not None else None


def day_totals(day_plan):
    """Sum every food row of a Fitatu day ({dietPlan: {mealKey: {items: [...]}}}) into
    {kcal, p, c, f, items}. Rows carry their own portion's energy (kcal) and grams of protein,
    fat and carbohydrate. Returns None when nothing was logged that day."""
    diet = (day_plan or {}).get("dietPlan") or {}
    tot = {"kcal": 0.0, "p": 0.0, "c": 0.0, "f": 0.0}
    n = 0
    for meal in diet.values() if isinstance(diet, dict) else []:
        if not isinstance(meal, dict):
            continue
        for item in meal.get("items") or []:
            if not isinstance(item, dict) or item.get("deletedAt"):
                continue
            n += 1
            tot["kcal"] += _num(item.get("energy"))
            tot["p"] += _num(item.get("protein"))
            tot["c"] += _num(item.get("carbohydrate"))
            tot["f"] += _num(item.get("fat"))
    if not n:
        return None
    return {"kcal": round(tot["kcal"]), "p": round(tot["p"], 1), "c": round(tot["c"], 1), "f": round(tot["f"], 1), "items": n}


def _rows(day_plan):
    """Every live food row of a Fitatu day as (meal key, row)."""
    diet = (day_plan or {}).get("dietPlan") or {}
    for key, meal in diet.items() if isinstance(diet, dict) else []:
        for item in ((meal or {}).get("items") or []) if isinstance(meal, dict) else []:
            if isinstance(item, dict) and not item.get("deletedAt"):
                yield key, item


def recipe_ids(day_plan):
    """Ids of the recipes planned and not yet eaten on a day."""
    return {r.get("recipeId") for _, r in _rows(day_plan) if r.get("foodType") == "RECIPE" and not r.get("eaten") and r.get("recipeId")}


def _line(key, name, unit, qty, grams, meal, recipe=None):
    return {"key": key, "name": str(name or "?").strip(), "unit": str(unit or "").strip(), "qty": round(qty, 2),
            "g": None if grams is None else round(grams, 1), "meal": meal, "recipe": recipe}


def plan_lines(day_plan, recipes):
    """What a day still needs bought: one line per planned row not ticked as eaten, with planned
    recipes split into their ingredients for the portions planned (`recipes` maps recipe id to
    Fitatu's recipe details, {} when they could not be read). A line's key is the same for the
    same product in the same measure, so the app can add them up across days."""
    lines = []
    for meal, row in _rows(day_plan):
        if row.get("eaten"):
            continue
        qty = _num(row.get("measureQuantity"))
        grams = _num(row["weight"]) if row.get("weight") is not None else None
        kind = row.get("foodType")
        if kind == "PRODUCT":
            lines.append(_line(f"p{row.get('productId')}:{row.get('measureId')}", row.get("name"), row.get("measureName"), qty, grams, meal))
            continue
        recipe = (recipes.get(row.get("recipeId")) or {}) if kind == "RECIPE" else {}
        items = [i for i in recipe.get("items") or [] if isinstance(i, dict)]
        portion = next((m for m in recipe.get("measures") or [] if isinstance(m, dict) and m.get("id") == PORTION_MEASURE), {})
        if row.get("measureId") == PORTION_MEASURE:
            portions = qty
        elif grams and _num(portion.get("weightPerUnit")):
            portions = grams / _num(portion.get("weightPerUnit"))
        else:
            portions = None
        if not items or not portions:
            # A custom row, or a recipe whose ingredients could not be read: listed as it is.
            lines.append(_line(f"x{row.get('recipeId') or row.get('name')}:{row.get('measureId')}", row.get("name"), row.get("measureName"), qty, grams, meal))
            continue
        share = portions / (_num(recipe.get("serving")) or 1)  # the ingredients make the recipe's servings
        for i in items:
            amount = _num(i.get("measureQuantity")) * share  # Fitatu sends these as strings, e.g. "0.50"
            g = _num(i["measureWeight"]) * amount if i.get("measureWeight") is not None else None
            lines.append(_line(f"p{i.get('itemId')}:{i.get('measureId')}", i.get("name"), i.get("measureName"), amount, g, meal,
                               str(row.get("name") or "").strip() or None))
    return lines


def plan_days(today):
    """Days the grocery list can pick from: today and the next PLAN_DAYS - 1."""
    return [(today + timedelta(days=i)).isoformat() for i in range(PLAN_DAYS)]


def plan_change(existing, day, lines):
    """Like plan_day, for a day's grocery lines."""
    if not lines:
        return ("delete", None) if existing else (None, None)
    data = {"day": day, "lines": lines}
    return (None, None) if existing == data else ("put", data)


def sync_days(status, today, start=START_DAY):
    """Days (YYYY-MM-DD, oldest first) to read: a long window on the first run, then the last week,
    never before `start`."""
    n = INCREMENTAL_SYNC_DAYS if (status or {}).get("first_sync_done") else FIRST_SYNC_DAYS
    days = [today - timedelta(days=i) for i in range(n - 1, -1, -1)]
    return [d.isoformat() for d in days if d >= start]


def plan_day(existing, day, totals):
    """What to do with the stored record for `day`: ('put', data), ('delete', None) when the day
    was emptied in Fitatu, or (None, None) when nothing changed."""
    if totals is None:
        return ("delete", None) if existing else (None, None)
    data = {"day": day, **totals}
    if existing and all(existing.get(k) == v for k, v in data.items()):
        return (None, None)
    return ("put", data)


# ---------------------------------------------------------------------------
# HTTP (network)
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
    return {"apikey": secret_key, "Authorization": f"Bearer {secret_key}", "Content-Type": "application/json"}


def get_sole_user_id(supabase_url, secret_key, override=None):
    if override:
        return override
    status, body = _http("GET", f"{supabase_url}/auth/v1/admin/users", supabase_headers(secret_key))
    if status >= 300 or not body:
        raise RuntimeError("Could not look up the app's user via Supabase Auth admin API.")
    users = body.get("users", body) if isinstance(body, dict) else body
    if not users:
        raise RuntimeError("No user found in the Supabase project.")
    return users[0]["id"]


def fetch_existing_days(supabase_url, secret_key, user_id, kind=DAY_KIND):
    status, body = _http(
        "GET",
        f"{supabase_url}/rest/v1/records?user_id=eq.{user_id}&kind=eq.{kind}&deleted=eq.false&select=id,data",
        supabase_headers(secret_key),
    )
    if status >= 300:
        raise RuntimeError("Could not read existing Fitatu days from Supabase.")
    return {(r.get("data") or {}).get("day"): r["data"] for r in body or [] if (r.get("data") or {}).get("day")}


def upsert_records(supabase_url, secret_key, rows):
    if not rows:
        return
    headers = supabase_headers(secret_key)
    headers["Prefer"] = "resolution=merge-duplicates"
    for i in range(0, len(rows), 50):
        status, _ = _http("POST", f"{supabase_url}/rest/v1/records?on_conflict=id", headers, body=rows[i:i + 50])
        if status >= 300:
            raise RuntimeError("Could not save Fitatu days to Supabase.")


def record_row(rec_id, user_id, kind, data, deleted=False):
    return {
        "id": rec_id,
        "user_id": user_id,
        "kind": kind,
        "data": data,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "deleted": deleted,
    }


def fitatu_login():
    """Log in with FITATU_EMAIL / FITATU_PASSWORD. Returns (bearer token, Fitatu user id)."""
    email = os.environ.get("FITATU_EMAIL")
    password = os.environ.get("FITATU_PASSWORD")
    if not email or not password:
        raise RuntimeError("No Fitatu login available: set the FITATU_EMAIL and FITATU_PASSWORD secrets.")
    headers = {**FITATU_HEADERS, "content-type": "application/json;charset=UTF-8"}
    status, body = _http("POST", f"{FITATU_API}/login", headers, {"_username": email, "_password": password})
    if status in (401, 422):
        raise RuntimeError("Fitatu rejected the email or password (check FITATU_EMAIL / FITATU_PASSWORD).")
    if status == 429:
        raise RuntimeError("Fitatu is rate-limiting logins (429). Try again later.")
    if status >= 300 or not isinstance(body, dict) or not body.get("token"):
        raise RuntimeError(f"Fitatu login failed (HTTP {status}).")
    user_id = jwt_user_id(body["token"])
    if not user_id:
        raise RuntimeError("Fitatu login worked but the token had no user id.")
    return body["token"], user_id


def fetch_day(token, fitatu_user_id, day):
    headers = {**FITATU_HEADERS, "authorization": f"Bearer {token}"}
    status, body = _http("GET", f"{FITATU_API}/diet-and-activity-plan/{fitatu_user_id}/day/{day}", headers)
    if status == 404:
        return {}
    if status >= 300 or not isinstance(body, dict):
        raise RuntimeError(f"Could not read a Fitatu day (HTTP {status}).")
    return body


def fetch_recipe(token, recipe_id):
    """A recipe's details (servings, measures, ingredients), or {} when Fitatu will not give them."""
    headers = {**FITATU_HEADERS, "authorization": f"Bearer {token}"}
    status, body = _http("GET", f"{FITATU_API}/recipes/{int(recipe_id)}", headers)
    if status in (403, 404):
        return {}
    if status >= 300 or not isinstance(body, dict):
        raise RuntimeError(f"Could not read a Fitatu recipe (HTTP {status}).")
    return body


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

    try:
        user_id = get_sole_user_id(supabase_url, secret_key, os.environ.get("SUPABASE_USER_ID"))
        existing = fetch_existing_days(supabase_url, secret_key, user_id)
        existing_plans = fetch_existing_days(supabase_url, secret_key, user_id, PLAN_KIND)
    except Exception as e:
        log(f"Could not read from Supabase: {e}")
        return 1

    status_id = status_record_id(user_id)
    st, sbody = _http("GET", f"{supabase_url}/rest/v1/records?id=eq.{status_id}&select=data", supabase_headers(secret_key))
    prior = (sbody[0]["data"] if st == 200 and sbody else {}) or {}

    def save_status(data):
        upsert_records(supabase_url, secret_key, [record_row(status_id, user_id, STATUS_KIND, data)])

    try:
        token, fitatu_user = fitatu_login()
    except Exception as e:
        short = str(e).splitlines()[0]
        log(f"Fitatu login failed: {short}")
        try:
            save_status({**prior, "last_error": short})
        except Exception:
            pass
        return 1

    today = datetime.now(TIMEZONE).date()
    days = sync_days(prior, today)
    upcoming = plan_days(today)
    rows = []
    read = 0
    fetched = {}  # today is in both lists, read it once
    recipes = {}

    def day_plan(d):
        if d not in fetched:
            fetched[d] = fetch_day(token, fitatu_user, d)
            time.sleep(REQUEST_SLEEP_S)
        return fetched[d]

    try:
        for d in days:
            action, data = plan_day(existing.get(d), d, day_totals(day_plan(d)))
            read += 1
            if action == "put":
                rows.append(record_row(day_record_id(user_id, d), user_id, DAY_KIND, data))
            elif action == "delete":
                rows.append(record_row(day_record_id(user_id, d), user_id, DAY_KIND, {"day": d}, deleted=True))
        for d in upcoming:
            plan = day_plan(d)
            for rid in recipe_ids(plan) - recipes.keys():
                recipes[rid] = fetch_recipe(token, rid)
                time.sleep(REQUEST_SLEEP_S)
            action, data = plan_change(existing_plans.get(d), d, plan_lines(plan, recipes))
            if action == "put":
                rows.append(record_row(plan_record_id(user_id, d), user_id, PLAN_KIND, data))
            elif action == "delete":
                rows.append(record_row(plan_record_id(user_id, d), user_id, PLAN_KIND, {"day": d}, deleted=True))
        # Past days drop off the grocery list.
        for d in existing_plans:
            if d < upcoming[0]:
                rows.append(record_row(plan_record_id(user_id, d), user_id, PLAN_KIND, {"day": d}, deleted=True))
    except Exception as e:
        short = str(e).splitlines()[0]
        log(f"Stopped after {read} day(s): {short}")
        try:
            upsert_records(supabase_url, secret_key, rows)
            save_status({**prior, "last_error": short})
        except Exception:
            pass
        return 1

    try:
        upsert_records(supabase_url, secret_key, rows)
        save_status({
            "last_sync_at": datetime.now(timezone.utc).isoformat(),
            "first_sync_done": True,
            "last_error": None,
        })
    except Exception as e:
        log(f"Could not save: {e}")
        return 1

    log(f"Fitatu sync complete: read {read} day(s) and {len(upcoming)} planned day(s), saved {len(rows)} change(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
