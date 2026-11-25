"""Google Sheets through an Apps Script web app the business pastes (no Google sign-in needed). We POST one row as JSON; the script appends it. The script text is given as data (SCRIPT) for the business to copy.

A POST to a web app's /exec address is answered with a 302 to script.googleusercontent.com; the script has run by then. The guarded client never follows a redirect; this adapter makes ONE follow-up GET to the
address the 302 names (only when it is on script.googleusercontent.com and short enough to be checked again) to read the script's own answer {ok: true|false}; when that is not possible the 302 alone counts as sent.
A row is never written twice: the script looks for the event's Ref in the last 500 rows first. Verify with a real account (docs/contracts/crm-push.md)."""

# ruff: noqa: E501

from __future__ import annotations

import re
from urllib.parse import urlsplit

from app.crm_push.adapters.base import Adapter, Outcome, Setting, Spec, dig, done, failed
from app.crm_push.fields import ROW_FIELDS, Record
from app.crm_push.transport import Answer, Http
from app.webhooks_out import ssrf

_PATH = re.compile(r"/macros/s/[A-Za-z0-9_-]{20,200}/exec")
_ECHO_HOST = "script.googleusercontent.com"

SCRIPT = """// Stack19 results into this sheet. In the sheet: Extensions > Apps Script. Replace the code with this, change WORD, then Deploy > New deployment > Web app:
// Execute as: Me, Who has access: Anyone. Copy the web app address into Stack19.
const WORD = "change-this-word";   // any word you choose; paste the same word into Stack19 ("Shared word")
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.token !== WORD) return out({ ok: false, error: "word" });
    if (data.test) return out({ ok: true, test: true });
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    const wanted = Object.keys(data.values);
    let header = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
    wanted.forEach(function (name) {
      if (header.indexOf(name) < 0) { header.push(name); sheet.getRange(1, header.length).setValue(name); }
    });
    const refCol = header.indexOf(data.refColumn) + 1;
    if (refCol > 0 && data.ref && sheet.getLastRow() > 1) {
      const first = Math.max(2, sheet.getLastRow() - 499);
      const seen = sheet.getRange(first, refCol, sheet.getLastRow() - first + 1, 1).getValues();
      for (let i = 0; i < seen.length; i++) if (seen[i][0] === data.ref) return out({ ok: true, duplicate: true });
    }
    sheet.appendRow(header.map(function (name) { return data.values[name] === undefined ? "" : data.values[name]; }));
    return out({ ok: true });
  } finally { lock.releaseLock(); }
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
"""

COLUMNS = {"name": "Name", "phone": "Phone", "email": "Email", "source": "Source", "outcome": "Result", "summary": "Summary", "captured": "Details", "duration": "Duration (seconds)", "call_id": "Call", "event": "Event", "ref": "Stack19 ref"}


class GoogleSheets(Adapter):
    spec = Spec(
        key="google_sheets", label="Google Sheets", kind="key",
        credentials=(Setting("script_url", "Web app address", secret=True, help="The address Google gives when you deploy the script.", example="https://script.google.com/macros/s/.../exec"),
                     Setting("word", "Shared word", secret=True, help="The word you put in the script (WORD).")),
        targets=tuple((v, v) for v in COLUMNS.values()),
        our_fields=ROW_FIELDS,
        default_mapping=dict(COLUMNS),
        notes=False,
        docs=("https://developers.google.com/apps-script/guides/web", "https://developers.google.com/apps-script/guides/services/quotas", "https://dev.to/googleworkspace/youre-probably-using-curl-wrong-with-your-google-apps-script-web-app-1ed8"),
        verify=("that the script has run when the 302 arrives (add a test row and count)", "the request size limit of a web app (not documented; rows are a few KB)", "the 'Anyone' access label"),
        setup_steps=("Open your Google Sheet, then Extensions, Apps Script.", "Paste the script we show, change the word in the first line, then Deploy, New deployment, Web app: run as Me, access Anyone.", "Copy the web app address and the word here."),
    )
    script = SCRIPT

    def check(self, creds: dict[str, str], config: dict[str, str]) -> str | None:
        url = creds.get("script_url", "").strip()
        try:
            ssrf.check_url(url)
            parts = urlsplit(url)
        except (ssrf.UnsafeUrl, ValueError):
            return "config"
        return None if parts.hostname == "script.google.com" and _PATH.fullmatch(parts.path) and not parts.query else "config"

    def _send(self, http: Http, creds: dict[str, str], payload: dict[str, object]) -> Outcome:
        a = http.request("POST", creds["script_url"].strip(), json_body={**payload, "token": creds.get("word", "")})
        if a.status in (301, 302, 303):
            return self._follow(http, a)
        if a.ok:
            return self._read(a)
        return failed(a)

    @staticmethod
    def _read(a: Answer) -> Outcome:
        ok = dig(a.body, "ok")
        if ok is True:
            return Outcome(True, "skipped" if dig(a.body, "duplicate") else "appended", a.status)
        if ok is False:
            return Outcome(False, "auth" if dig(a.body, "error") == "word" else "rejected", a.status)
        return Outcome(False, "bad_answer", a.status)

    def _follow(self, http: Http, first: Answer) -> Outcome:
        where = first.location or ""
        try:
            host = urlsplit(where).hostname
        except ValueError:
            host = None
        if host != _ECHO_HOST:
            return Outcome(False, "redirect", first.status)
        if len(where) > ssrf.MAX_URL:
            return done("appended", first.status)   # the documented redirect: the script has run, the row is counted as sent
        b = http.request("GET", where)
        if b.ok:
            return self._read(b)
        return done("appended", first.status) if b.status and 300 <= b.status < 400 else failed(b)

    def test(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str]) -> Outcome:
        out = self._send(http, creds, {"test": True})
        return done("skipped", out.status) if out.ok else out

    def push(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str], rec: Record) -> Outcome:
        values = {col: rec.value(key) for key in ROW_FIELDS if (col := mapping.get(key)) and rec.value(key)}
        if not values or not any(rec.value(k) for k in ("name", "phone", "email")):
            return done("skipped")
        return self._send(http, creds, {"values": values, "ref": rec.event_id, "refColumn": mapping.get("ref", ""), "event": rec.event})
