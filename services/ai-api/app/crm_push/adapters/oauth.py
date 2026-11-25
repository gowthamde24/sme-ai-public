"""Zoho CRM and Salesforce: OAuth tools. The adapters are written and tested against fakes; they are NOT connectable until the owner registers our client with each vendor (docs/contracts/crm-push.md, "Owner steps") and the connect redirect is built.
So the app says 'Needs setup by us' and the save route refuses (409 needs_setup_by_us). What the adapters expect in the workspace's stored secret (JSON): refresh_token, and for Zoho accounts_server and api_domain, for Salesforce instance_url and login_host.

An access token is asked for from the refresh token when needed and kept in memory for its life (Zoho allows few access tokens per refresh token), never logged."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import re
import time
from typing import Any

from app.crm_push.adapters.base import (
    Adapter,
    Outcome,
    Spec,
    default_note_mapping,
    dig,
    done,
    failed,
    first_id,
    host_ok,
)
from app.crm_push.fields import Record, has_note, mapped_fields, note_text, phone_ten, split_name
from app.crm_push.transport import Http

ZOHO_ACCOUNTS = ("accounts.zoho.com", "accounts.zoho.in", "accounts.zoho.eu", "accounts.zoho.com.au", "accounts.zoho.jp", "accounts.zohocloud.ca", "accounts.zoho.com.cn", "accounts.zoho.sa", "accounts.zoho.uk")
ZOHO_API_SUFFIXES = (".zohoapis.com", ".zohoapis.in", ".zohoapis.eu", ".zohoapis.com.au", ".zohoapis.jp", ".zohoapis.ca", ".zohoapis.com.cn", ".zohoapis.sa", ".zohoapis.uk")
SF_VERSION = "v68.0"
_SF_HOST = re.compile(r"[a-z0-9-]+(\.[a-z0-9-]+)*\.(salesforce|force)\.com")
_cache: dict[str, tuple[str, float]] = {}


def _cached(key: str, now: float) -> str | None:
    hit = _cache.get(hashlib.sha256(key.encode()).hexdigest())
    return hit[0] if hit and hit[1] > now else None


def _remember(key: str, token: str, ttl: float, now: float) -> None:
    if len(_cache) > 500:
        _cache.clear()
    _cache[hashlib.sha256(key.encode()).hexdigest()] = (token, now + max(ttl - 120, 30))


class ZohoCrm(Adapter):
    def __init__(self, client_id: str | None = None, client_secret: str | None = None, *, clock: Any = time.monotonic) -> None:
        self._id, self._secret, self._clock = client_id, client_secret, clock
        self.spec = Spec(
            key="zoho_crm", label="Zoho CRM", kind="oauth", credentials=(),
            targets=(("Last_Name", "Last name"), ("First_Name", "First name"), ("Phone", "Phone"), ("Mobile", "Mobile"), ("Email", "Email"), ("Lead_Source", "Lead source"), ("Description", "Description")),
            default_mapping=default_note_mapping({"name": "Last_Name", "phone": "Phone", "email": "Email", "source": "Lead_Source"}),
            docs=("https://www.zoho.com/crm/developer/docs/api/v6/register-client.html", "https://www.zoho.com/crm/developer/docs/api/v6/auth-request.html", "https://www.zoho.com/crm/developer/docs/api/v6/access-refresh.html",
                  "https://www.zoho.com/crm/developer/docs/api/v6/refresh.html", "https://www.zoho.com/crm/developer/docs/api/v6/upsert-records.html", "https://www.zoho.com/crm/developer/docs/api/v6/create-notes.html", "https://www.zoho.com/crm/developer/docs/api/v6/multi-dc.html"),
            verify=("whether one client works in every data centre", "the 204 answer of an empty module", "which fields are unique in the customer's org (duplicate_check_fields)", "whether Zoho asks for app verification"),
            needs_setup="We still need to register Stack19 with Zoho (one time, by us). Until then this cannot be connected.",
        )

    def _access(self, http: Http, creds: dict[str, str]) -> str | Outcome:
        server = creds.get("accounts_server", "")
        if server not in ZOHO_ACCOUNTS or not self._id or not self._secret or not creds.get("refresh_token"):
            return Outcome(False, "config")
        now = self._clock()
        key = f"zoho:{server}:{creds['refresh_token']}"
        got = _cached(key, now)
        if got:
            return got
        a = http.request("POST", f"https://{server}/oauth/v2/token", form={"grant_type": "refresh_token", "refresh_token": creds["refresh_token"], "client_id": self._id, "client_secret": self._secret})
        token = dig(a.body, "access_token")
        if not a.ok or not isinstance(token, str):
            return failed(a) if not a.ok else Outcome(False, "auth", a.status)
        ttl = dig(a.body, "expires_in")
        _remember(key, token, float(ttl) if isinstance(ttl, int | float) else 3600.0, now)
        return token

    @staticmethod
    def _api(creds: dict[str, str]) -> str | None:
        host = creds.get("api_domain", "").removeprefix("https://").rstrip("/")
        return f"https://{host}/crm/v6" if host_ok(host, ZOHO_API_SUFFIXES) else None

    def test(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str]) -> Outcome:
        token, api = self._access(http, creds), self._api(creds)
        if isinstance(token, Outcome) or api is None:
            return token if isinstance(token, Outcome) else Outcome(False, "config")
        a = http.request("GET", f"{api}/Leads", headers={"Authorization": f"Zoho-oauthtoken {token}"}, query={"fields": "Last_Name", "per_page": "1"})
        return done("skipped", a.status) if a.ok or a.status == 204 else failed(a)

    def push(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str], rec: Record) -> Outcome:
        if not rec.phone and not rec.email:
            return done("skipped")
        token, api = self._access(http, creds), self._api(creds)
        if isinstance(token, Outcome) or api is None:
            return token if isinstance(token, Outcome) else Outcome(False, "config")
        h = {"Authorization": f"Zoho-oauthtoken {token}"}
        record: dict[str, object] = dict(mapped_fields(rec, mapping))
        if mapping.get("name") == "Last_Name" and rec.name:
            first, last = split_name(rec.name)
            record["Last_Name"] = last or first
            if last:
                record["First_Name"] = first
        record.setdefault("Last_Name", rec.phone or rec.email)   # Last_Name is required on a lead
        a = http.request("POST", f"{api}/Leads/upsert", headers=h, json_body={"data": [record], "duplicate_check_fields": ["Email"] if rec.email else ["Phone"], "trigger": []})
        if not a.ok:
            return failed(a)
        row = dig(a.body, "data", 0)
        if dig(row, "code") != "SUCCESS":
            return Outcome(False, "rejected", a.status)
        lead = first_id(dig(row, "details", "id"))
        if not lead:
            return Outcome(False, "bad_answer", a.status)
        word = "created" if dig(row, "action") == "insert" else "updated"
        if has_note(rec, mapping):
            n = http.request("POST", f"{api}/Leads/{lead}/Notes", headers=h, json_body={"data": [{"Note_Title": "Stack19", "Note_Content": note_text(rec, mapping)}]})
            if not n.ok:
                return failed(n)
            word = "noted"
        return done(word, a.status)


class Salesforce(Adapter):
    def __init__(self, client_id: str | None = None, client_secret: str | None = None, *, clock: Any = time.monotonic) -> None:
        self._id, self._secret, self._clock = client_id, client_secret, clock
        self.spec = Spec(
            key="salesforce", label="Salesforce", kind="oauth", credentials=(),
            targets=(("LastName", "Last name"), ("FirstName", "First name"), ("Company", "Company"), ("Phone", "Phone"), ("MobilePhone", "Mobile"), ("Email", "Email"), ("LeadSource", "Lead source"), ("Description", "Description")),
            default_mapping=default_note_mapping({"name": "LastName", "phone": "Phone", "email": "Email", "source": "LeadSource"}),
            docs=("https://help.salesforce.com/s/articleView?id=xcloud.remoteaccess_oauth_web_server_flow.htm", "https://help.salesforce.com/s/articleView?id=xcloud.remoteaccess_oauth_refresh_token_flow.htm",
                  "https://developer.salesforce.com/docs/platform/api-rest/guide/resources-list.html", "https://developer.salesforce.com/docs/platform/api-rest/guide/resources-query.html", "https://developer.salesforce.com/docs/platform/api-rest/guide/errorcodes.html"),
            verify=("whether one app registered by us can be used by other companies' orgs without a package or an admin install", "the status of DUPLICATES_DETECTED", "that the Task (not a Note) is what companies want"),
            needs_setup="We still need to register Stack19 with Salesforce (one time, by us). Until then this cannot be connected.",
        )

    def _access(self, http: Http, creds: dict[str, str]) -> str | Outcome:
        login = creds.get("login_host", "login.salesforce.com")
        if login not in ("login.salesforce.com", "test.salesforce.com") and not _SF_HOST.fullmatch(login) or not self._id or not self._secret or not creds.get("refresh_token"):
            return Outcome(False, "config")
        now = self._clock()
        key = f"sf:{login}:{creds['refresh_token']}"
        got = _cached(key, now)
        if got:
            return got
        a = http.request("POST", f"https://{login}/services/oauth2/token", form={"grant_type": "refresh_token", "refresh_token": creds["refresh_token"], "client_id": self._id, "client_secret": self._secret})
        token = dig(a.body, "access_token")
        if not a.ok or not isinstance(token, str):
            return failed(a) if not a.ok else Outcome(False, "auth", a.status)
        _remember(key, token, 1800.0, now)   # the session lifetime is the org's setting: a safe half hour; a 401 below drops it
        return token

    @staticmethod
    def _api(creds: dict[str, str]) -> str | None:
        host = creds.get("instance_url", "").removeprefix("https://").rstrip("/")
        return f"https://{host}/services/data/{SF_VERSION}" if _SF_HOST.fullmatch(host) else None

    def test(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str]) -> Outcome:
        token, api = self._access(http, creds), self._api(creds)
        if isinstance(token, Outcome) or api is None:
            return token if isinstance(token, Outcome) else Outcome(False, "config")
        a = http.request("GET", f"{api}/limits", headers={"Authorization": f"Bearer {token}"})
        return done("skipped", a.status) if a.ok else failed(a)

    def push(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str], rec: Record) -> Outcome:
        if not rec.phone and not rec.email:
            return done("skipped")
        token, api = self._access(http, creds), self._api(creds)
        if isinstance(token, Outcome) or api is None:
            return token if isinstance(token, Outcome) else Outcome(False, "config")
        h = {"Authorization": f"Bearer {token}"}
        fields: dict[str, object] = dict(mapped_fields(rec, mapping))
        if mapping.get("name") == "LastName" and rec.name:
            first, last = split_name(rec.name)
            fields["LastName"] = last or first
            if last:
                fields["FirstName"] = first
        fields.setdefault("LastName", rec.phone or rec.email)
        fields.setdefault("Company", "[not provided]")   # required on a lead by default
        clause = f"Email = '{_soql(rec.email)}'" if rec.email else f"Phone = '{_soql(rec.phone)}'"
        soql = f"SELECT Id FROM Lead WHERE {clause} LIMIT 1"   # noqa: S608 - the value is cleaned by _soql, and this is a REST query string, not a database
        q = http.request("GET", f"{api}/query", headers=h, query={"q": soql})
        if not q.ok:
            return failed(q)
        lead = first_id(dig(q.body, "records", 0, "Id"))
        if lead:
            a = http.request("PATCH", f"{api}/sobjects/Lead/{lead}", headers=h, json_body={k: v for k, v in fields.items() if k != "Company"})
            word = "updated"
        else:
            a = http.request("POST", f"{api}/sobjects/Lead", headers=h, json_body=fields)
            word = "created"
            lead = first_id(dig(a.body, "id")) if a.ok else None
        if not a.ok:
            return failed(a)
        if not lead:
            return Outcome(False, "bad_answer", a.status)
        if has_note(rec, mapping):
            n = http.request("POST", f"{api}/sobjects/Task", headers=h, json_body={"WhoId": lead, "Subject": "Stack19 call", "Description": note_text(rec, mapping), "Status": "Completed"})
            if not n.ok:
                return failed(n)
            word = "noted"
        return done(word, a.status)


def _soql(text: str) -> str:
    """A value inside a SOQL string: backslash and quote escaped, anything but plain characters dropped."""
    return re.sub(r"[^A-Za-z0-9@.+_\- ]", "", text)


_ = phone_ten
