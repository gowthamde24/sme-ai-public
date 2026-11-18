"""A fake Plivo that follows the DOCUMENTED REST API for numbers (planner, 18 Nov 2026), as an httpx MockTransport: the number routes are tested against it, never against the real account.

Endpoints (https://api.plivo.com/v1/Account/<auth_id>/...), as Plivo documents them:
  POST   Subaccount/                          -> {auth_id, auth_token}
  GET    PhoneNumber/Compliance/<id>/         -> {status}
  GET    PhoneNumber/?country_iso=IN&type=..&services=voice&limit=n[&pattern=..]  -> {objects: [{number}]}
  POST   PhoneNumber/<number>/ {subaccount, compliance_application_id}  -> 201 (the number is rented into the sub-account; 404 when it is not on offer, 400 when it is rented already)
  POST   Application/ {app_name, answer_url, hangup_url, ...} (sub-account credentials)  -> {app_id}
  POST   Number/<number>/ {app_id} (sub-account credentials) -> 202 (links the number to the Application)
  DELETE Number/<number>/                     -> 204 (unrent); 404 when THIS account does not hold it (a number rented into a sub-account is held by the sub-account)
  (set `fail_after_rent` to make the Application step answer 500, to test the clean-up)
The fake records every call so a test can say what happened and what was paid for (`rented`)."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
from typing import Any

import httpx


class FakePlivoNumbers:
    def __init__(self, *, compliance: str = "accepted", on_offer: tuple[str, ...] = ("918044440101", "918044440102", "918044440103")) -> None:
        self.compliance = compliance
        self.on_offer = list(on_offer)
        self.rented: dict[str, dict[str, Any]] = {}
        self.apps: dict[str, dict[str, Any]] = {}
        self.calls: list[tuple[str, str]] = []
        self.down = False
        self.fail_application = False

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=self.transport())

    def _handle(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            return httpx.Response(503)
        m = re.match(r"^/v1/Account/([^/]+)/(.*)$", request.url.path)
        if not m:
            return httpx.Response(404)
        auth_id, path = m.group(1), m.group(2)
        self.calls.append((request.method, path.split("?")[0]))
        body: dict[str, Any] = {}
        if request.content:
            try:
                body = json.loads(request.content)
            except ValueError:
                body = {}
        if request.method == "POST" and path == "Subaccount/":
            return httpx.Response(201, json={"auth_id": "SAFAKE00000001", "auth_token": "fake-sub-token"})
        if request.method == "GET" and path.startswith("PhoneNumber/Compliance/"):
            return httpx.Response(200, json={"status": self.compliance})
        if request.method == "GET" and path == "PhoneNumber/":
            pattern = request.url.params.get("pattern", "")
            objs = [{"number": n} for n in self.on_offer if pattern in n and n not in self.rented]
            return httpx.Response(200, json={"objects": objs[: int(request.url.params.get("limit", "5"))]})
        m2 = re.match(r"^PhoneNumber/([0-9]+)/$", path)
        if request.method == "POST" and m2:
            n = m2.group(1)
            if n in self.rented:
                return httpx.Response(400, json={"error": "number already rented"})
            if n not in self.on_offer:
                return httpx.Response(404, json={"error": "not found"})
            self.rented[n] = {"subaccount": body.get("subaccount"), "compliance": body.get("compliance_application_id"), "app_id": None, "by": auth_id}
            return httpx.Response(201, json={"status": "fulfilled"})
        if request.method == "POST" and path == "Application/":
            if self.fail_application:
                return httpx.Response(500)
            app_id = f"app{len(self.apps) + 1:06d}"
            self.apps[app_id] = {"answer_url": body.get("answer_url"), "hangup_url": body.get("hangup_url"), "by": auth_id}
            return httpx.Response(201, json={"app_id": app_id})
        m3 = re.match(r"^Number/([0-9]+)/$", path)
        if request.method == "POST" and m3:
            n = m3.group(1)
            if n not in self.rented or body.get("app_id") not in self.apps:
                return httpx.Response(404)
            self.rented[n]["app_id"] = body["app_id"]
            return httpx.Response(202, json={"message": "changed"})
        if request.method == "DELETE" and m3:
            n = m3.group(1)
            held = self.rented.get(n)
            if held is None or held["subaccount"] != auth_id and not (held["subaccount"] is None and auth_id.startswith("MA")):
                return httpx.Response(404)   # an account can only give back what IT holds: a number rented into a sub-account is the sub-account's
            self.rented.pop(n)
            self.on_offer.append(n) if n not in self.on_offer else None
            return httpx.Response(204)
        return httpx.Response(404)
