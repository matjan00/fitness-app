"""Pure conversion: the app's device-neutral session steps -> Garmin Connect workout JSON.

No network and no garminconnect import, so it is unit-tested locally (test_garmin_workouts.py).

Input steps (built by docs/run-plan.js sessionSteps()):
  {"kind": "warmup"|"run"|"recovery"|"cooldown", "distance_m"|"duration_s"|"open": true,
   "pace_min_s_per_km": faster end, "pace_max_s_per_km": slower end}
  {"kind": "repeat", "reps": n, "steps": [...]}

Output follows the JSON that garminconnect.upload_workout() posts to /workout-service/workout and that
garminconnect.workout (RunningWorkout / ExecutableStep / RepeatGroup) models: sportType running,
workoutSegments -> workoutSteps of ExecutableStepDTO / RepeatGroupDTO. Only features the Forerunner 55
supports are used (distance / time / lap-button end conditions, pace or no target; no power targets).
"""

RUNNING = {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1}

STEP_TYPES = {
    "warmup": {"stepTypeId": 1, "stepTypeKey": "warmup", "displayOrder": 1},
    "cooldown": {"stepTypeId": 2, "stepTypeKey": "cooldown", "displayOrder": 2},
    "run": {"stepTypeId": 3, "stepTypeKey": "interval", "displayOrder": 3},
    "recovery": {"stepTypeId": 4, "stepTypeKey": "recovery", "displayOrder": 4},
    "repeat": {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6},
}
END_LAP = {"conditionTypeId": 1, "conditionTypeKey": "lap.button", "displayOrder": 1, "displayable": True}
END_TIME = {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": True}
END_DISTANCE = {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": True}
END_ITERATIONS = {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": False}
NO_TARGET = {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}
PACE_TARGET = {"workoutTargetTypeId": 6, "workoutTargetTypeKey": "pace.zone", "displayOrder": 6}

DEFAULT_PACE_S_PER_KM = 360  # used only to estimate total duration of distance steps without a pace target
MAX_NAME_LEN = 60
MIN_PACE, MAX_PACE = 120, 1200  # s/km sanity bounds (2:00 .. 20:00)


class StepError(ValueError):
    pass


def speed_ms(pace_s_per_km):
    """Pace (s/km) -> speed (m/s). Slower pace = lower speed."""
    p = float(pace_s_per_km)
    if not (MIN_PACE <= p <= MAX_PACE):
        raise StepError("pace out of range")
    return round(1000.0 / p, 4)


def _end_condition(step):
    if step.get("distance_m"):
        return END_DISTANCE, float(step["distance_m"])
    if step.get("duration_s"):
        return END_TIME, float(step["duration_s"])
    if step.get("open"):
        return END_LAP, None
    raise StepError("step has no distance, duration or open end")


def _pace_bounds(step):
    lo, hi = step.get("pace_min_s_per_km"), step.get("pace_max_s_per_km")
    if lo is None or hi is None:
        return None
    lo, hi = sorted((float(lo), float(hi)))
    return lo, hi


def _estimate_seconds(step):
    if step.get("duration_s"):
        return float(step["duration_s"])
    if step.get("distance_m"):
        b = _pace_bounds(step)
        pace = (b[0] + b[1]) / 2 if b else DEFAULT_PACE_S_PER_KM
        return float(step["distance_m"]) / 1000.0 * pace
    return 0.0


def _executable(step, order, child_id=None):
    kind = step.get("kind")
    if kind not in ("warmup", "run", "recovery", "cooldown"):
        raise StepError("unknown step kind: %r" % (kind,))
    cond, value = _end_condition(step)
    out = {
        "type": "ExecutableStepDTO",
        "stepId": None,
        "stepOrder": order,
        "stepType": dict(STEP_TYPES[kind]),
        "childStepId": child_id,
        "endCondition": dict(cond),
        "endConditionValue": value,
        "targetType": dict(NO_TARGET),
    }
    b = _pace_bounds(step)
    if b and kind in ("run", "recovery"):
        # Garmin pace targets are speeds in m/s: One = slower end (lower speed), Two = faster end.
        out["targetType"] = dict(PACE_TARGET)
        out["targetValueOne"] = speed_ms(b[1])
        out["targetValueTwo"] = speed_ms(b[0])
    return out


def build_steps(steps):
    """Return (garmin workoutSteps list, estimated seconds). Step orders are sequential across nesting."""
    if not steps:
        raise StepError("no steps")
    counter = {"order": 0, "child": 0}
    total = 0.0
    out = []
    for s in steps:
        counter["order"] += 1
        if s.get("kind") == "repeat":
            reps = int(s.get("reps") or 0)
            inner = s.get("steps") or []
            if reps < 1 or reps > 99 or not inner:
                raise StepError("bad repeat group")
            counter["child"] += 1
            child_id = counter["child"]
            group = {
                "type": "RepeatGroupDTO",
                "stepId": None,
                "stepOrder": counter["order"],
                "stepType": dict(STEP_TYPES["repeat"]),
                "childStepId": child_id,
                "numberOfIterations": reps,
                "workoutSteps": [],
                "endCondition": dict(END_ITERATIONS),
                "endConditionValue": float(reps),
                "smartRepeat": False,
            }
            for c in inner:
                if c.get("kind") == "repeat":
                    raise StepError("nested repeat groups are not supported")
                counter["order"] += 1
                group["workoutSteps"].append(_executable(c, counter["order"], child_id))
                total += reps * _estimate_seconds(c)
            out.append(group)
        else:
            out.append(_executable(s, counter["order"]))
            total += _estimate_seconds(s)
    return out, int(round(total))


def build_workout(name, steps, description=None):
    """Build the full Garmin Connect workout JSON for upload_workout()."""
    clean = " ".join(str(name or "Fit run").split())[:MAX_NAME_LEN] or "Fit run"
    wsteps, seconds = build_steps(steps)
    workout = {
        "workoutName": clean,
        "sportType": dict(RUNNING),
        "estimatedDurationInSecs": seconds,
        "workoutSegments": [{"segmentOrder": 1, "sportType": dict(RUNNING), "workoutSteps": wsteps}],
    }
    if description:
        workout["description"] = str(description)[:400]
    return workout
