"""A fake VoiceLink reseller API for LOCAL runs only (run-local-api.sh starts it). No network, no money, no real number.

It answers the calls `app/telephony/voicelink_api.py` makes, with the shapes that file reads, so the number picker, the per-client business KYC and the outbound dialer can be tried end to end on a laptop.
State is in memory and starts again with the process. Behaviour that mirrors the real one, on purpose:
  * a number bought for a client whose KYC is not complete is refused at `map-did` (the "buy first, verify after" path);
  * a KYC that was submitted is approved by `FAKE_VOICELINK_APPROVE_S` seconds later (default 20), or at once by `POST /_fake/approve/{client_id}`;
  * PAN "MISMATCH" in the holder name answers `pan_match_status` 2; a GST number that is not 15 characters is refused;
  * the number list is made from a fixed pattern, so a search by digits always finds something;
  * the KYC steps need only the client: no number has to be bought first (the order the planner chose, 26 Nov 2026: verify first, then buy); `POST /_fake/reset` forgets everything.
`GET /_fake/state` shows what it holds. Run alone: `python scripts/fake_voicelink.py [port]` (default 8099).
"""

# ruff: noqa: E501

from __future__ import annotations

import os
import sys
import threading
import time
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

APPROVE_S = float(os.environ.get("FAKE_VOICELINK_APPROVE_S", "20"))
OUR_CLIENT_ID = 1   # PICKER_CLIENT_ID in the local run: our own client, KYC complete
app = FastAPI(title="fake-voicelink", docs_url=None, redoc_url=None)
_lock = threading.Lock()
_next = {"client": 100, "order": 5000, "routing": 700, "queue": 9000}
CLIENTS: dict[int, dict[str, Any]] = {OUR_CLIENT_ID: {"email": "ours@fake.invalid", "username": "ours", "kyc_done": True, "docs": {}, "submitted_at": None, "steps": []}}
DIDS: dict[int, dict[str, Any]] = {}
ORDERS: dict[int, dict[str, Any]] = {}
ROUTINGS: list[dict[str, Any]] = []
LEADS: list[dict[str, Any]] = []
WALLET = {"balance": 25000.0}
for i in range(40):   # numbers for sale: 9xxxx for mobile (type 2), 40xx for landline (type 3); the rate is a plain Rs 300 / Rs 400
    mobile = i < 30
    digits = f"91{9000000000 + 1234500 + i * 111}" if mobile else f"91{4000000000 + 2345600 + i * 101}"
    DIDS[200 + i] = {"id": 200 + i, "did_number": digits, "type": 2 if mobile else 3, "type_label": "Mobile" if mobile else "Landline", "monthly_rate": 300.0 if mobile else 400.0, "owner": None, "locked": False, "client_id": None}


def ok(data: Any = None) -> JSONResponse:
    return JSONResponse({"status": True, "message": "ok", "data": data})


def refuse(status: int, data: dict[str, Any] | None = None, message: str = "refused") -> JSONResponse:
    return JSONResponse({"status": False, "message": message, "data": data or {}}, status_code=status)


def _kyc_complete(client_id: int) -> bool:
    c = CLIENTS.get(client_id)
    if not c:
        return False
    if c["kyc_done"]:
        return True
    at = c["submitted_at"]
    if at is not None and time.time() - at >= APPROVE_S:
        c["kyc_done"] = True
    return bool(c["kyc_done"])


@app.post("/auth/login")
async def login() -> JSONResponse:
    return ok({"access_token": "fake-token", "token_type": "bearer"})


@app.get("/reseller/profile")
async def profile() -> JSONResponse:
    return ok({"currency": "INR", "wallet": {"balance": WALLET["balance"], "currency": "INR"}})


@app.get("/reseller/did/purchased")
async def purchased() -> JSONResponse:
    rows = [{"did_number": d["did_number"], "type_label": d["type_label"], "expiry_date": "2099-01-01", "is_expired": 0, "client_id": d["client_id"], "call_recording": 0} for d in DIDS.values() if d["owner"] == "us"]
    return ok({"data": rows})


@app.get("/reseller/did-types")
async def did_types() -> JSONResponse:
    return ok([{"id": 2, "name": "Mobile", "requires_request": 0}, {"id": 3, "name": "Landline", "requires_request": 0}, {"id": 14, "name": "140 series", "requires_request": 1}])


@app.get("/reseller/purchase/dids")
async def for_sale(request: Request) -> JSONResponse:
    q = request.query_params
    want = int(q.get("type") or 2)
    prefix = "".join(ch for ch in (q.get("number") or "") if ch.isdigit())
    per_page = max(1, min(int(q.get("per_page") or 20), 100))
    rows = [d for d in DIDS.values() if d["owner"] is None and not d["locked"] and d["type"] == want and (not prefix or prefix in d["did_number"])]
    return ok({"data": [{"id": d["id"], "did_number": d["did_number"], "type_label": d["type_label"], "monthly_rate": d["monthly_rate"]} for d in rows[:per_page]], "total": len(rows)})


@app.get("/websocket-bot/list")
async def bots() -> JSONResponse:
    return ok({"data": [{"id": 1, "bot_name": "stack19-local", "status": 1, "websocket_url": "ws://localhost:8000/v1/telephony/voicelink/ws/fake", "webhook_url": "http://localhost:8000/v1/telephony/voicelink/webhook/fake"}]})


@app.get("/call-routing/list")
async def routings() -> JSONResponse:
    return ok(ROUTINGS)


@app.post("/reseller/purchase/lock-did")
async def lock(request: Request) -> JSONResponse:
    body = await request.json()
    with _lock:
        locked = []
        for did_id in body.get("did_ids") or []:
            d = DIDS.get(int(did_id))
            if d is None or d["owner"] is not None or d["locked"]:
                return refuse(422, {"error": "number no longer available"})
            locked.append(d)
        _next["order"] += 1
        oid = _next["order"]
        for d in locked:
            d["locked"] = True
        ORDERS[oid] = {"dids": [d["id"] for d in locked], "months": int(body.get("months") or 1), "paid": False}
        return ok({"order_id": oid, "locked_dids": [{"did_id": d["id"], "total_price": d["monthly_rate"] * int(body.get("months") or 1)} for d in locked]})


@app.get("/reseller/purchase/summary/{order_id}")
async def summary(order_id: int) -> JSONResponse:
    o = ORDERS.get(order_id)
    if o is None:
        return refuse(404)
    total = sum(DIDS[i]["monthly_rate"] for i in o["dids"]) * o["months"]
    return ok({"total": total, "did_count": len(o["dids"]), "channel_count": 0, "wallet_balance": WALLET["balance"]})


@app.post("/reseller/purchase/confirm")
async def confirm(request: Request) -> JSONResponse:
    body = await request.json()
    o = ORDERS.get(int(body.get("order_id") or 0))
    if o is None or o["paid"]:
        return refuse(422)
    total = sum(DIDS[i]["monthly_rate"] for i in o["dids"]) * o["months"]
    if total > WALLET["balance"]:
        return refuse(422, {"error": "wallet low"})
    with _lock:
        WALLET["balance"] -= total
        o["paid"] = True
        for i in o["dids"]:
            DIDS[i]["owner"] = "us"
            DIDS[i]["locked"] = False
    return ok({"order_number": f"FAKE-{int(body['order_id'])}"})


@app.post("/reseller/client/map-did")
async def map_did(request: Request) -> JSONResponse:
    body = await request.json()
    d = DIDS.get(int(body.get("did_id") or 0))
    cid = int(body.get("client_id") or 0)
    if d is None or d["owner"] != "us" or cid not in CLIENTS:
        return refuse(422)
    if not _kyc_complete(cid):
        return refuse(422, {"error": "KYC is not complete for this client", "kyc_required": True})
    d["client_id"] = cid
    return ok({"did_id": d["id"], "client_id": cid})


@app.post("/reseller/client/create")
async def create_client(request: Request) -> JSONResponse:
    body = await request.json()
    email = str(body.get("email") or "").lower()
    if not email or any(c["email"] == email for c in CLIENTS.values()):
        return refuse(422, {"error": "email already used"})
    with _lock:
        _next["client"] += 1
        cid = _next["client"]
        CLIENTS[cid] = {"email": email, "username": body.get("username"), "kyc_done": False, "docs": {}, "submitted_at": None, "steps": []}
    return ok({"client_id": cid})


def _client(body_or_params: Any) -> dict[str, Any] | None:
    try:
        return CLIENTS.get(int(body_or_params.get("client_id")))
    except (TypeError, ValueError):
        return None


def _multipart_fields(content_type: str, body: bytes) -> dict[str, str]:
    from email.parser import BytesParser
    from email.policy import default

    msg = BytesParser(policy=default).parsebytes(b"Content-Type: " + content_type.encode() + b"\r\n\r\n" + body)
    out: dict[str, str] = {}
    for part in msg.iter_parts() if msg.is_multipart() else []:
        name = part.get_param("name", header="content-disposition")
        if name and not part.get_filename():
            out[str(name)] = str(part.get_content()).strip()
    return out


@app.get("/reseller/kyc/status")
async def kyc_status(request: Request) -> JSONResponse:
    c = _client(request.query_params)
    if c is None:
        return refuse(404)
    done = _kyc_complete(int(request.query_params["client_id"]))
    docs = {k: {"uploaded": True} for k in c["docs"]}
    step = "complete" if done else ("review" if c["submitted_at"] else (c["steps"][-1] if c["steps"] else "details"))
    return ok({"is_complete": done, "kyc_status": 1 if done else 0, "current_step": step, "documents": docs})


async def _step(request: Request, name: str, extra: dict[str, Any] | None = None) -> JSONResponse:
    body = await request.json()
    c = _client(body)
    if c is None:
        return refuse(404)
    c["steps"].append(name)
    return ok({"step": name, **(extra or {})})


@app.post("/reseller/kyc/step-1-register-details")
async def step1(request: Request) -> JSONResponse:
    return await _step(request, "details")


@app.post("/reseller/kyc/step-2-pan-verify")
async def step2(request: Request) -> JSONResponse:
    body = await request.json()
    c = _client(body)
    if c is None:
        return refuse(404)
    pan = str(body.get("pan_number") or "")
    if len(pan) != 10:
        return refuse(422, {"error": "pan invalid"})
    if "MISMATCH" in str(body.get("pan_holder_name") or "").upper():
        return refuse(422, {"pan_match_status": 2})
    c["steps"].append("pan")
    return ok({"pan_match_status": 1})


@app.post("/reseller/kyc/step-3-aadhaar-init")
async def step3(request: Request) -> JSONResponse:
    return await _step(request, "aadhaar", {"redirect_url": "https://digilocker.fake.invalid/consent?ref=local"})


@app.post("/reseller/kyc/step-4-gst-verify")
async def step4(request: Request) -> JSONResponse:
    body = await request.json()
    if len(str(body.get("gst_number") or "")) != 15:
        return refuse(422, {"error": "gst invalid"})
    return await _step(request, "gst")


@app.post("/reseller/kyc/upload-document")
async def upload(request: Request) -> JSONResponse:
    form = _multipart_fields(request.headers.get("content-type", ""), await request.body())   # no python-multipart in the image: a plain parse of the text fields
    c = _client(form)
    kind = str(form.get("document_type") or "")
    if c is None or kind not in ("pan", "aadhaar", "gst"):
        return refuse(422)
    c["docs"][kind] = True
    return ok({"document_type": kind, "uploaded": True})


@app.post("/reseller/kyc/final-submit")
async def final_submit(request: Request) -> JSONResponse:
    body = await request.json()
    c = _client(body)
    if c is None:
        return refuse(404)
    missing = [k for k in ("pan", "aadhaar") if k not in c["docs"]]
    if missing:
        return refuse(422, {"missing_documents": missing})
    c["submitted_at"] = time.time()
    return ok({"submitted": True})


@app.post("/_fake/reset")
async def reset() -> JSONResponse:
    """Forget every client, purchase and routing (our own client 1 stays): a smoke run that deleted its staging rows starts again from nothing."""
    with _lock:
        for cid in [c for c in CLIENTS if c != OUR_CLIENT_ID]:
            del CLIENTS[cid]
        for d in DIDS.values():
            d.update(owner=None, locked=False, client_id=None)
        ORDERS.clear()
        ROUTINGS.clear()
        LEADS.clear()
        WALLET["balance"] = 25000.0
    return ok({"reset": True})


@app.post("/_fake/approve/{client_id}")
async def approve(client_id: int) -> JSONResponse:
    if client_id not in CLIENTS:
        return refuse(404)
    CLIENTS[client_id]["kyc_done"] = True
    return ok({"client_id": client_id, "kyc": "complete"})


@app.post("/call-routing/create")
async def routing(request: Request) -> JSONResponse:
    body = await request.json()
    with _lock:
        _next["routing"] += 1
        row = {"id": _next["routing"], "did_id": int(body.get("did_id") or 0), "status": 1, "for_inbound_call": 3, "for_outbound_call": 3, "did_number": (DIDS.get(int(body.get("did_id") or 0)) or {}).get("did_number")}
        ROUTINGS.append(row)
    return ok({"id": row["id"]})


@app.get("/call-log/details")
async def call_details(request: Request) -> JSONResponse:
    return ok({"call_id": request.query_params.get("call_id"), "status": "completed", "duration": 0})


@app.post("/add_lead")
async def add_lead(request: Request) -> JSONResponse:
    body = await request.json()
    with _lock:
        _next["queue"] += 1
        LEADS.append({"queue_id": _next["queue"], "did": body.get("did_number"), "to_last4": str(body.get("customer_number") or "")[-4:]})
    return ok({"outbound_queue_id": _next["queue"]})


@app.get("/_fake/state")
async def state() -> JSONResponse:
    return JSONResponse({"wallet": WALLET, "bought": [d["did_number"] for d in DIDS.values() if d["owner"] == "us"], "clients": {str(k): {"kyc_done": _kyc_complete(k), "docs": sorted(v["docs"])} for k, v in CLIENTS.items()}, "routings": len(ROUTINGS), "leads": LEADS[-10:]})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[1]) if len(sys.argv) > 1 else 8099, log_level="warning")
