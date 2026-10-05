import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import random
import unittest

import followup_cadence as engine
from followup_cadence import ENGINE_VERSION, canonical_json, decide


class DiscoveryTests(unittest.TestCase):
    def test_nested_package_import_and_version(self):
        self.assertEqual(ENGINE_VERSION, "1.0.0")


def fixture():
    return json.loads((Path(__file__).parent / "fixtures" / "synthetic.json").read_text())


def iso(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


class CadenceTests(unittest.TestCase):
    def setUp(self):
        self.r = fixture()

    def open_calendar(self):
        self.r["recipient_utc_offset_minutes"] = 0
        self.r["policy"].update(allowed_weekdays=list(range(7)),
            quiet_hours={"start": "00:00", "end": "00:00"}, min_gap_hours=0)

    def test_exact_gap_boundary(self):
        self.open_calendar()
        for at, action in (("2026-10-05T05:59:59Z", "wait"),
                           ("2026-10-05T06:00:00Z", "draft_followup"),
                           ("2026-10-05T06:00:01Z", "draft_followup")):
            self.r["as_of"] = at
            result = decide(self.r)
            self.assertEqual(result["action"], action)
            self.assertEqual(result["next_eligible_at"], max(at, "2026-10-05T06:00:00Z"))
            self.assertEqual(result["touch_number"], 2)

    def test_min_gap_boundary(self):
        self.open_calendar()
        self.r["policy"].update(gap_days=[0, 0, 0], min_gap_hours=48)
        self.r["as_of"] = "2026-10-05T05:59:59Z"
        self.assertEqual(decide(self.r)["next_eligible_at"], "2026-10-05T06:00:00Z")
        self.r["as_of"] = "2026-10-05T06:00:00Z"
        self.assertEqual(decide(self.r)["action"], "draft_followup")

    def test_quiet_same_day_boundaries(self):
        self.open_calendar()
        self.r["policy"]["quiet_hours"] = {"start": "12:00", "end": "13:00"}
        for at, expected in (("11:59:59", "2026-10-05T11:59:59Z"),
                             ("12:00:00", "2026-10-05T13:00:00Z"),
                             ("12:59:59", "2026-10-05T13:00:00Z"),
                             ("13:00:00", "2026-10-05T13:00:00Z")):
            self.r["as_of"] = "2026-10-05T" + at + "Z"
            result = decide(self.r)
            self.assertTrue("codes" not in result)
            self.assertEqual(result["next_eligible_at"], expected)

    def test_quiet_wrap_boundaries_and_india_offset(self):
        # India local quiet 20:00--09:00, represented in UTC at +05:30.
        for at, expected in (("2026-10-05T14:29:59Z", "2026-10-05T14:29:59Z"),
                             ("2026-10-05T14:30:00Z", "2026-10-06T03:30:00Z"),
                             ("2026-10-06T03:29:59Z", "2026-10-06T03:30:00Z"),
                             ("2026-10-06T03:30:00Z", "2026-10-06T03:30:00Z")):
            self.r["as_of"] = at
            result = decide(self.r)
            self.assertTrue("codes" not in result)
            self.assertEqual(result["next_eligible_at"], expected)
            self.assertEqual(result["action"], "draft_followup" if at == expected else "wait")

    def test_weekday_and_holiday_chain(self):
        self.r["as_of"] = "2026-10-09T14:30:00Z"  # Friday quiet-start.
        self.r["policy"]["holidays"] = ["2026-10-12", "2026-10-13"]
        self.assertEqual(decide(self.r)["next_eligible_at"], "2026-10-14T03:30:00Z")

    def test_holidays_use_local_date(self):
        self.r["as_of"] = "2026-10-04T23:00:00Z"  # Monday local, Sunday UTC.
        self.r["policy"]["gap_days"] = [0, 0, 0]
        self.r["policy"]["holidays"] = ["2026-10-05"]
        self.assertEqual(decide(self.r)["next_eligible_at"], "2026-10-06T03:30:00Z")

    def test_suppression_precedence_each_flag(self):
        for flag in ("do_not_contact", "opted_out", "bounced"):
            r = fixture()
            r["lead"].update(replied=True, won=True, lost=True)
            r["lead"][flag] = True
            r["history"].append(dict(r["history"][0], direction="in"))
            r["policy"].update(max_touches=0, gap_days=[])
            result = decide(r)
            self.assertEqual((result["action"], result["reason_code"]), ("stop", flag))
            self.assertIsNone(result["next_eligible_at"])
        self.r["lead"].update(do_not_contact=True, opted_out=True, bounced=True)
        self.assertEqual(decide(self.r)["reason_code"], "do_not_contact")

    def test_inbound_and_replied_precedence(self):
        for reply_flag in (False, True):
            r = fixture()
            r["lead"].update(replied=reply_flag, won=True, lost=True)
            if not reply_flag:
                r["history"].append(dict(r["history"][0], direction="in"))
            r["policy"].update(max_touches=0, gap_days=[])
            self.assertEqual(decide(r)["reason_code"], "human_takeover")

    def test_closed_precedence(self):
        for flag in ("won", "lost"):
            r = fixture()
            r["lead"][flag] = True
            r["policy"].update(max_touches=0, gap_days=[])
            self.assertEqual(decide(r)["reason_code"], flag)
        self.r["lead"].update(won=True, lost=True)
        self.assertEqual(decide(self.r)["reason_code"], "won")

    def test_max_touches_boundary(self):
        for maximum, expected in ((0, "stop"), (1, "stop"), (2, "draft_followup")):
            self.r["policy"].update(max_touches=maximum, gap_days=[2] * max(maximum - 1, 0))
            result = decide(self.r)
            self.assertEqual(result["action"], expected)
            if maximum <= 1:
                self.assertEqual(result["reason_code"], "max_touches_reached")

    def test_empty_history_requires_initial_outreach(self):
        self.r["history"] = []
        self.assertEqual(decide(self.r)["reason_code"], "initial_outreach_required")
        self.assertEqual(decide(self.r)["touch_number"], 1)

    def test_zero_limit_without_history(self):
        self.r["history"] = []
        self.r["policy"].update(max_touches=0, gap_days=[])
        self.assertEqual(decide(self.r)["reason_code"], "max_touches_reached")

    def test_gap_index_and_latest_outbound(self):
        self.open_calendar()
        self.r["history"] = [dict(self.r["history"][0], timestamp="2026-10-01T06:00:00Z"),
                             dict(self.r["history"][0], timestamp="2026-10-03T06:00:00Z")]
        result = decide(self.r)
        self.assertEqual(result["touch_number"], 3)
        self.assertEqual(result["next_eligible_at"], "2026-10-07T06:00:00Z")
        self.r["history"].reverse()
        self.assertEqual(decide(self.r)["next_eligible_at"], result["next_eligible_at"])

    def test_zero_gap_and_equal_quiet_endpoints(self):
        self.open_calendar()
        self.r["policy"].update(gap_days=[0, 0, 0], quiet_hours={"start": "12:00", "end": "12:00"})
        self.r["as_of"] = "2026-10-05T12:00:00Z"
        self.assertEqual(decide(self.r)["next_eligible_at"], self.r["as_of"])
        self.assertEqual(decide(self.r)["action"], "draft_followup")

    def test_no_send_and_trace(self):
        result = decide(self.r)
        self.assertEqual(result["action"], "draft_followup")
        self.assertEqual(result["reason_code"], "eligible_now")
        self.assertTrue(all(t["rule_id"] and t["text"] and t["inputs"] for t in result["trace"]))

    def test_timestamp_rejections(self):
        for stamp in ("2026-10-05", "2026-10-05T06:00:00", "2026-10-05T06:00:00+00:00",
                      "2026-10-05T06:00:00.001Z", "2026-02-30T06:00:00Z"):
            self.r["as_of"] = stamp
            self.assertEqual(decide(self.r)["codes"], ["INVALID_TIMESTAMP"])
        self.r = fixture()
        self.r["history"][0]["timestamp"] = "2026-10-05T06:00:01Z"
        self.assertEqual(decide(self.r)["codes"], ["FUTURE_HISTORY"])
        self.r["history"][0]["timestamp"] = self.r["as_of"]
        self.assertNotIn("codes", decide(self.r))

    def test_business_rejections(self):
        alterations = [("policy", "allowed_weekdays", [], "NO_ALLOWED_WEEKDAYS"),
                       ("policy", "allowed_weekdays", [0, 0], "DUPLICATE_WEEKDAY"),
                       ("policy", "holidays", ["bad"], "INVALID_DATE"),
                       ("policy", "holidays", ["2026-10-05"] * 2, "DUPLICATE_HOLIDAY"),
                       ("policy", "gap_days", [1], "INVALID_GAP_COUNT")]
        for section, key, value, code in alterations:
            r = fixture()
            r[section][key] = value
            self.assertEqual(decide(r)["codes"], [code])
        self.r["history"][0]["direction"] = "sideways"
        self.assertEqual(decide(self.r)["codes"], ["INVALID_DIRECTION"])
        self.r = fixture()
        self.r["history"][0]["channel"] = ""
        self.assertEqual(decide(self.r)["codes"], ["EMPTY_IDENTIFIER"])
        self.r = fixture()
        self.r["extra"] = 1
        self.assertEqual(decide(self.r)["codes"], ["INVALID_FIELDS"])

    def test_quiet_hour_rejections(self):
        for text, code in (("24:00", "OUT_OF_RANGE"), ("23:60", "OUT_OF_RANGE"),
                           ("1:00", "INVALID_QUIET_HOURS"), ("ab:cd", "INVALID_QUIET_HOURS")):
            self.r["policy"]["quiet_hours"]["start"] = text
            self.assertEqual(decide(self.r)["codes"], [code])

    def test_date_overflow(self):
        self.r["as_of"] = "9999-12-31T23:59:59Z"
        self.r["history"][0]["timestamp"] = self.r["as_of"]
        self.assertEqual(decide(self.r)["codes"], ["DATE_OVERFLOW"])
        self.r["policy"].update(gap_days=[0, 0, 0], min_gap_hours=0)
        self.assertEqual(decide(self.r)["codes"], ["DATE_OVERFLOW"])

    def test_wrong_types(self):
        for value in ("2", True, None):
            r = fixture()
            r["policy"]["max_touches"] = value
            with self.assertRaises(TypeError):
                decide(r)
        for value in (0, "false", None):
            r = fixture()
            r["lead"]["opted_out"] = value
            with self.assertRaises(TypeError):
                decide(r)
        for value in ([], (), object(), json.loads("1.5")):
            with self.assertRaises(TypeError):
                decide(value)

    def test_determinism_hash_and_immutability(self):
        before = copy.deepcopy(self.r)
        first = decide(self.r)
        self.assertEqual(decide(self.r), first)
        self.assertEqual(self.r, before)
        self.assertEqual(decide(dict(reversed(list(self.r.items())))), first)
        self.assertEqual(json.loads(canonical_json(first)), first)
        self.assertEqual(first["canonical_hash"], hashlib.sha256(canonical_json(
            {"engine_version": "1.0.0", "inputs": self.r}).encode("utf-8")).hexdigest())
        self.assertEqual(first["canonical_hash"], "d2bfc72e83f01648f623fe9dfbede9c36908cc6265515583f8fbcec45e97350f")
        for section, key, value in (("lead", "lost", True), ("policy", "min_gap_hours", 25),
                                    ("policy", "gap_days", [3, 4, 7])):
            r = fixture()
            r[section][key] = value
            self.assertNotEqual(decide(r)["canonical_hash"], first["canonical_hash"])
        r = fixture()
        r["history"][0]["outcome"] = "synthetic_changed"
        self.assertNotEqual(decide(r)["canonical_hash"], first["canonical_hash"])

    def test_nested_wrong_types(self):
        for path, value in ((("recipient_utc_offset_minutes",), True),
                            (("policy", "allowed_weekdays", 0), False),
                            (("policy", "holidays"), None),
                            (("policy", "quiet_hours", "start"), 900),
                            (("history", 0, "timestamp"), 0),
                            (("history", 0, "outcome"), None),
                            (("history",), ())):
            r = fixture()
            target = r
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            with self.subTest(path=path):
                with self.assertRaises(TypeError):
                    decide(r)

    def test_seeded_properties(self):
        rng = random.Random(1010)
        now = datetime(2026, 10, 5, 6, tzinfo=timezone.utc)
        for _ in range(250):
            r = fixture()
            r["recipient_utc_offset_minutes"] = rng.randrange(-840, 841)
            r["policy"].update(gap_days=[rng.randrange(8) for _ in range(3)],
                min_gap_hours=rng.randrange(73), allowed_weekdays=sorted(rng.sample(range(7), rng.randrange(1, 8))),
                holidays=[(now.date() + timedelta(days=d)).isoformat() for d in rng.sample(range(15), 4)])
            start, end = rng.randrange(1440), rng.randrange(1440)
            r["policy"]["quiet_hours"] = {"start": f"{start // 60:02d}:{start % 60:02d}",
                                           "end": f"{end // 60:02d}:{end % 60:02d}"}
            last = now - timedelta(hours=rng.randrange(1, 120))
            r["history"][0]["timestamp"] = iso(last)
            before = copy.deepcopy(r)
            q = decide(r)
            self.assertTrue("codes" not in q)
            self.assertEqual(r, before)
            self.assertEqual(q, decide(r))
            self.assertEqual(q["canonical_hash"], decide(r)["canonical_hash"])
            self.assertIn(q["action"], ("wait", "draft_followup"))
            eligible = datetime.fromisoformat(q["next_eligible_at"])
            self.assertGreaterEqual(eligible, max(now, last + timedelta(days=r["policy"]["gap_days"][0]),
                last + timedelta(hours=r["policy"]["min_gap_hours"])))
            local = eligible + timedelta(minutes=r["recipient_utc_offset_minutes"])
            minute = local.hour * 60 + local.minute
            quiet = start <= minute < end if start < end else (minute >= start or minute < end) if start > end else False
            self.assertFalse(quiet)
            self.assertIn(local.weekday(), r["policy"]["allowed_weekdays"])
            self.assertNotIn(local.date().isoformat(), r["policy"]["holidays"])
            self.assertEqual(q["action"], "draft_followup" if eligible == now else "wait")
            # Same touch number, later evidence of last outbound cannot go earlier.
            later = copy.deepcopy(r)
            later["history"][0]["timestamp"] = iso(min(last + timedelta(hours=1), now))
            q2 = decide(later)
            self.assertEqual(q2["touch_number"], q["touch_number"])
            self.assertGreaterEqual(q2["next_eligible_at"], q["next_eligible_at"])
            # More history at the same outbound count: inbound means takeover,
            # never an earlier scheduled draft (stop has no eligible time).
            added = copy.deepcopy(r)
            added["history"].append(dict(added["history"][0], direction="in"))
            self.assertEqual(decide(added)["reason_code"], "human_takeover")
            self.assertIsNone(decide(added)["next_eligible_at"])
            self.assertEqual(decide(added)["touch_number"], q["touch_number"])
            # Suppression must dominate arbitrary competing terminal/reply flags.
            flags = copy.deepcopy(r)
            flags["lead"] = {key: bool(rng.randrange(2)) for key in r["lead"]}
            flag = rng.choice(["do_not_contact", "opted_out", "bounced"])
            flags["lead"][flag] = True
            flags["history"].append(dict(flags["history"][0], direction="in"))
            flags["policy"].update(max_touches=0, gap_days=[])
            stopped = decide(flags)
            self.assertEqual(stopped["action"], "stop")
            self.assertIn(stopped["reason_code"], ("do_not_contact", "opted_out", "bounced"))
            self.assertIsNone(stopped["next_eligible_at"])
            takeover = copy.deepcopy(r)
            takeover["lead"].update(won=bool(rng.randrange(2)), lost=bool(rng.randrange(2)))
            takeover["history"].append(dict(takeover["history"][0], direction="in"))
            self.assertEqual(decide(takeover)["reason_code"], "human_takeover")
            closed = copy.deepcopy(r)
            flag = rng.choice(["won", "lost"])
            closed["lead"][flag] = True
            self.assertEqual(decide(closed)["reason_code"], flag)
            exhausted = copy.deepcopy(r)
            exhausted["history"] *= exhausted["policy"]["max_touches"]
            self.assertEqual(decide(exhausted)["reason_code"], "max_touches_reached")
