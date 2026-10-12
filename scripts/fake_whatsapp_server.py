#!/usr/bin/env python3
"""A local stand-in for WhatsApp's Cloud API and for Meta's webhook (job BR, docs/runbooks/whatsapp-local.md). It sends nothing to anyone and needs no account, key or money.

  python3 scripts/fake_whatsapp_server.py --port 8791 --webhook-url http://127.0.0.1:8001/v1/webhooks/whatsapp --app-secret local-app-secret --phone-number-id 100000000000001

It answers Meta's send API (POST /v25.0/<phone number id>/messages, bearer token `fake-token`) and pushes SIGNED webhooks to the API:
  POST /_fake/inbound  {"from": "919876543210", "text": "hello", "name": "Ravi", "kind": "text"}     the "customer" writes: opens their 24-hour window and pushes the message
  POST /_fake/status   {"wamid": "...", "status": "delivered", "to": "919876543210", "error_code": null, "callback": "<outbox message id>"}
  POST /_fake/approve_template  {"name": "...", "language": "te"}
  POST /_fake/fail     {"to": "919876543210", "status": 400, "code": 131026, "times": 1}
  GET  /_fake/sent     everything accepted so far (the texts are visible here: this is a test tool)
With --auto-status every accepted message is followed by `sent`, `delivered` and `read` statuses pushed to the webhook (with the callback data the API put in the send).
Run it from services/ai-api so that `app` is importable (make dev-whatsapp-fake does).
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))

from app.whatsapp import payloads, webhook  # noqa: E402
from app.whatsapp.fake_graph import FakeGraph  # noqa: E402


def push(url: str, secret: str, payload: dict) -> int:
    body = payloads.raw(payload)
    request = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json", "X-Hub-Signature-256": webhook.sign(body, secret)})  # noqa: S310 - a URL the developer passed
    try:
        with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
            return int(response.status)
    except urllib.error.HTTPError as exc:
        return int(exc.code)
    except OSError:
        return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8791)
    parser.add_argument("--webhook-url", required=True)
    parser.add_argument("--app-secret", required=True)
    parser.add_argument("--phone-number-id", default="100000000000001")
    parser.add_argument("--token", default="fake-token")
    parser.add_argument("--auto-status", action="store_true")
    args = parser.parse_args()
    graph = FakeGraph({args.token})
    counter = {"n": 0}

    class Handler(BaseHTTPRequestHandler):
        def _reply(self, status: int, body: dict | list) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_: object) -> None:  # numbers and texts stay out of the log
            return

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/_fake/sent":
                self._reply(200, graph.sent)
            else:
                self._reply(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            if self.path.startswith("/_fake/"):
                self._admin(self.path, json.loads(body or b"{}"))
                return
            status, answer = graph.handle("POST", self.path, {k.lower(): v for k, v in self.headers.items()}, body)
            self._reply(status, answer)
            if status == 200 and args.auto_status:
                sent = graph.sent[-1]
                callback = sent["payload"].get("biz_opaque_callback_data")
                threading.Thread(target=self._statuses, args=(sent["wamid"], sent["to"], callback), daemon=True).start()

        def _statuses(self, wamid: str, to: str, callback: str | None) -> None:
            for state in ("sent", "delivered", "read"):
                push(args.webhook_url, args.app_secret, payloads.status(args.phone_number_id, wamid, state, to, callback=callback))

        def _admin(self, path: str, data: dict) -> None:
            if path == "/_fake/inbound":
                counter["n"] += 1
                sender = str(data["from"])
                graph.inbound_from(sender)
                wamid = f"wamid.INBOUND{counter['n']:06d}"
                status = push(args.webhook_url, args.app_secret, payloads.inbound(args.phone_number_id, sender, wamid, text=data.get("text", "hello"), kind=data.get("kind", "text"), name=data.get("name", "Local Customer")))
                self._reply(200, {"wamid": wamid, "webhook_status": status})
            elif path == "/_fake/status":
                status = push(args.webhook_url, args.app_secret, payloads.status(args.phone_number_id, data["wamid"], data["status"], str(data.get("to", "")), error_code=data.get("error_code"), callback=data.get("callback")))
                self._reply(200, {"webhook_status": status})
            elif path == "/_fake/approve_template":
                graph.approve_template(data["name"], data["language"])
                self._reply(200, {"ok": True})
            elif path == "/_fake/fail":
                graph.fail(str(data["to"]), int(data.get("status", 400)), int(data["code"]), int(data.get("times", 1)))
                self._reply(200, {"ok": True})
            else:
                self._reply(404, {"error": "not found"})

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"fake WhatsApp on http://127.0.0.1:{args.port} (token '{args.token}'), webhook -> {args.webhook_url}")  # noqa: T201
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
