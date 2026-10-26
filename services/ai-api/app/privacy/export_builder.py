"""The files of "download my data" (job BN, ADR 0075): a zip of plain JSON and a README, made from what the database hands the caller.

  person     what the account holds about the signed-in person (profile, workspaces and roles, the terms they accepted, the trail of their own actions, their own assistant chat, their exports and deletion requests)
  workspace  the business's records, table by table, read with the OWNER's own token so row-level security decides what is in the file (an Owner reads their whole business; nobody else's)

The zip is deterministic for the same data (sorted names, a fixed entry time = the generation time, JSON with sorted keys). A table that cannot be read is named in the manifest, never silently left out. Nothing
here logs a row: counts and sizes only.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import re
import uuid
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.privacy.repository import PrivacyRepository
from app.tenancy.repository import RepositoryError, TokenRejected

logger = logging.getLogger("app.privacy.export")

MAX_ZIP_BYTES = 50 * 1024 * 1024  # the Storage bucket's own limit (migration 20261116090000)
MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024
PAGE = 1000

# Every business table the Owner can read, in the order they appear in the file. The integration test `test_bn_privacy_rights` fails if a tenant table is in neither list, so a new table cannot be forgotten.
WORKSPACE_TABLES: tuple[str, ...] = (
    "companies", "contacts", "products", "leads", "opportunities", "lead_labels", "lead_touches", "consent_events",
    "enquiries", "requirements", "requirement_fields", "requirement_line_picks",
    "price_lists", "price_list_versions", "price_list_items", "price_list_breaks", "item_types",
    "quote_policy_versions", "quotes", "quote_lines", "order_policy_versions", "orders", "order_events",
    "followup_policy_versions", "followup_drafts", "question_drafts", "call_requests",
    "outbox_settings", "outbox_messages", "outbox_message_media", "outbox_events",
    "store_settings", "store_visits", "scheduler_settings", "scheduler_runs", "visit_reminders",
    "catalogue_items", "catalogue_photos", "custom_field_defs", "custom_field_values",
    "customer_sites", "ledger_accounts", "ledger_entries", "customer_credit_limits",
    "campaigns", "campaign_recipients", "campaign_steps", "call_list_items",
    "marks_send_log",
    "material_quote_policies", "material_quotes", "material_quote_lines",
    "delivery_trips", "delivery_trip_lines", "delivery_trip_events", "delivery_proofs",
    "call_settings", "call_handover_rules",
    "institution_profiles", "programmes", "programme_groups", "students", "admissions", "admission_events", "fee_plans", "fee_plan_lines", "fee_assignments",
    "voice_settings", "voice_choices", "campaign_voice", "voice_note_usage",
    "billing_subscriptions", "billing_events", "billing_usage_events", "billing_topups", "billing_notices", "billing_lapse_reminders", "billing_pending_reminders", "billing_trial_reminders",
    "outcomes", "assistant_settings",
    "evidence", "evidence_links", "claims", "claim_reviews", "icp_config_versions", "mapper_config_versions", "import_batches", "import_rows",
    "assistant_conversations", "assistant_messages", "assistant_reply_drafts",
    "own_voices",
    "speaking_styles",
    "agent_runs", "agent_run_steps", "agent_cost_reservations", "tenant_agent_settings", "tenant_data_policy",
    "data_exports", "erasure_requests", "memberships", "audit_events", "business_profile",
)  # fmt: skip
# the tables whose primary key is the workspace id itself (no `id` column)
ORDER_BY_TENANT = frozenset({"tenant_agent_settings", "tenant_data_policy", "outbox_settings", "store_settings", "scheduler_settings", "business_profile", "institution_profiles", "voice_settings", "billing_subscriptions", "assistant_settings"})
# the tables whose key is not `id`: the column that is unique within one workspace (job CV)
ORDER_BY_OTHER = {"voice_choices": "language", "voice_note_usage": "ref_id", "billing_events": "event_id", "billing_usage_events": "ref_id", "billing_notices": "at", "billing_lapse_reminders": "day", "billing_pending_reminders": "day", "billing_trial_reminders": "day"}


@dataclass(frozen=True)
class BuiltExport:
    content: bytes
    sha256: str
    manifest: dict[str, Any]

    @property
    def size(self) -> int:
        return len(self.content)


class ExportTooLarge(Exception):
    """The files would not fit in an export (the bucket's limit)."""


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=1, sort_keys=True, default=str) + "\n").encode("utf-8")


_NUMBER = re.compile(r"^[+-]?\d+(\.\d+)?$")


def _cell(value: Any) -> str:
    """One CSV cell. A spreadsheet reads a cell that starts with = + - @ as a formula, so such a text gets a leading apostrophe (a plain number is left as it is). Lists and objects are written as JSON."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, dict)):
        text = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
    else:
        text = str(value)
    if text[:1] in ("=", "+", "-", "@", "\t", "\r") and not _NUMBER.match(text):
        return "'" + text
    return text


def _csv_bytes(value: Any) -> bytes:
    """The same records as a CSV (job DQ, DPDP: a machine-readable copy that opens in a spreadsheet): the columns are the keys in the order they first appear; an object is one row."""
    rows = value if isinstance(value, list) else [value]
    rows = [r if isinstance(r, dict) else {"value": r} for r in rows]
    columns: list[str] = []
    for row in rows:
        for key in row:
            if key not in columns:
                columns.append(key)
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow([_cell(row.get(key)) for key in columns])
    return ("\ufeff" + out.getvalue()).encode("utf-8")  # a byte-order mark so a spreadsheet reads Telugu, Hindi and Kannada text correctly


def _zip(files: dict[str, bytes], generated_at: datetime) -> bytes:
    stamp = (max(generated_at.year, 1980), generated_at.month, generated_at.day, generated_at.hour, generated_at.minute, generated_at.second)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, date_time=stamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, files[name])
    return buffer.getvalue()


def _finish(files: dict[str, bytes], generated_at: datetime, manifest: dict[str, Any]) -> BuiltExport:
    if sum(len(v) for v in files.values()) > MAX_UNCOMPRESSED_BYTES:
        raise ExportTooLarge
    content = _zip(files, generated_at)
    if len(content) > MAX_ZIP_BYTES:
        raise ExportTooLarge
    return BuiltExport(content, hashlib.sha256(content).hexdigest(), manifest)


PERSON_README = """YOUR DATA (a copy of what this service holds about you)

Made on {generated_at} (UTC) at your request. The download link you were given worked for a few minutes and the file is deleted from our storage 24 hours after it was made.

What is in this file (plain JSON; open it with any text editor):
  profile.json            your account: name, e-mail, when it was made
  workspaces.json         the businesses you belong to and your role in each
  acceptances.json        the terms and privacy-notice versions you accepted, and when
  calendar_feeds.json     the calendar feeds you made (no secret link is stored; only dates)
  my_actions.json         the trail of your own actions in your businesses (when, what kind, which kind of record). It holds no customer details.
  my_assistant_chat.json  what you typed to the assistant and what it answered
  my_exports.json         your earlier data downloads
  my_deletion_requests.json  any request to delete your account
  consents.json           when you agreed to what (the service, marketing), under which notice, and when you withdrew
  manifest.json           the list of files and how many entries each holds
Every .json file also comes as a .csv with the same content, which opens in a spreadsheet (a text that starts with = + - or @ has an apostrophe put in front of it, so a spreadsheet does not run it as a formula).

What is NOT in this file: your business's own records (customers, quotes, orders). Those belong to the business; its Owner can download them from the workspace's privacy page. Backups are outside this file.

If something here is wrong, or you want it corrected or erased, tell the business's Owner or use the privacy request form in the app. The service replies within 30 days.
"""

WORKSPACE_README = """YOUR BUSINESS'S DATA (a copy of the records of {workspace})

Made on {generated_at} (UTC) at the Owner's request. The download link worked for a few minutes and the file is deleted from our storage 24 hours after it was made.

Each table in tables/ comes twice: as a JSON list (name.json) and as a spreadsheet file (name.csv), oldest first. In a .csv a text that starts with = + - or @ has an apostrophe put in front of it, so a spreadsheet does not run it as a formula. Names, phone numbers and e-mail addresses of your customers are in contacts.json, companies.json and the message tables: treat the file as private.
Where a record was erased on request or by your retention settings, its text reads erased:1 and the row, its dates and its numbers remain.
If your business keeps students (a school or college), students.json holds each student's first name or initials and admission number: they are children's data, so keep this file as private as you would the register itself.
manifest.json lists every table with its row count; a table marked "not_readable" could not be read with your permissions and is not in this file.

Not in this file: the secret keys the system uses to recognise customers who asked us to stop (they are a one-way code, not data about a person), the files of your catalogue photos (their names are in catalogue_photos.json), and backups.
"""


def build_person_export(data: dict[str, Any], generated_at: datetime) -> BuiltExport:
    parts = {
        "profile.json": data.get("account") or {},
        "workspaces.json": data.get("memberships") or [],
        "acceptances.json": {"terms_at_sign_up": data.get("terms_at_sign_up"), "policies": data.get("policy_acceptances") or []},
        "calendar_feeds.json": data.get("calendar_feeds") or [],
        "my_actions.json": data.get("my_actions") or [],
        "my_assistant_chat.json": data.get("my_assistant_chat") or [],
        "my_exports.json": data.get("my_exports") or [],
        "my_deletion_requests.json": data.get("my_deletion_requests") or [],
        "consents.json": data.get("consents") or [],
    }
    manifest = {
        "scope": "person",
        "generated_at": generated_at.isoformat(),
        "files": {name: (len(v) if isinstance(v, list) else 1) for name, v in sorted(parts.items())},
    }
    files = {name: _json_bytes(value) for name, value in parts.items()}
    files.update({name[: -len(".json")] + ".csv": _csv_bytes(value) for name, value in parts.items()})
    files["manifest.json"] = _json_bytes(manifest)
    files["README.txt"] = PERSON_README.format(generated_at=generated_at.strftime("%Y-%m-%d %H:%M")).encode("utf-8")
    return _finish(files, generated_at, manifest)


def build_workspace_export(
    repository: PrivacyRepository,
    token: str,
    tenant_id: uuid.UUID,
    tenant_name: str,
    generated_at: datetime,
    *,
    tables: tuple[str, ...] = WORKSPACE_TABLES,
    should_stop: Callable[[], bool] = lambda: False,
) -> BuiltExport:
    files: dict[str, bytes] = {}
    counts: dict[str, Any] = {}
    total = 0
    for table in tables:
        if should_stop():
            raise ExportTooLarge
        order = "tenant_id" if table in ORDER_BY_TENANT else ORDER_BY_OTHER.get(table, "id")
        rows: list[dict[str, Any]] = []
        try:
            offset = 0
            while True:
                page = repository.read_table_page(token, table, tenant_id, order, offset, PAGE)
                rows.extend(page)
                total += sum(len(json.dumps(r, default=str)) for r in page)
                if total > MAX_UNCOMPRESSED_BYTES:
                    raise ExportTooLarge
                if len(page) < PAGE:
                    break
                offset += PAGE
        except TokenRejected:
            raise
        except RepositoryError:
            counts[table] = "not_readable"
            logger.warning("export: a table could not be read: %s", table)
            continue
        counts[table] = len(rows)
        files[f"tables/{table}.json"] = _json_bytes(rows)
        files[f"tables/{table}.csv"] = _csv_bytes(rows)
    manifest = {"scope": "workspace", "workspace": tenant_name, "workspace_id": str(tenant_id), "generated_at": generated_at.isoformat(), "tables": dict(sorted(counts.items()))}
    files["manifest.json"] = _json_bytes(manifest)
    files["README.txt"] = WORKSPACE_README.format(workspace=tenant_name, generated_at=generated_at.strftime("%Y-%m-%d %H:%M")).encode("utf-8")
    return _finish(files, generated_at, manifest)
