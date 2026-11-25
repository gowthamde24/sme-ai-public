import { describe, expect, it } from "vitest";

import { ApiRequestError } from "./client";
import { hookFailOf, parseActivity, parseActivityUsage, parseDeliveries, parseNewEndpoint } from "./webhooks-out";

describe("outbound webhooks: C1's answers, checked", () => {
  const ep = { id: "11111111-1111-4111-8111-111111111111", url: "https://a.example.com/h", events: ["lead.created"], send_transcript: false, active: true, secret_last4: "abcd", created_at: "2026-11-25T10:00:00Z", rotated_at: null, health: { status: "failing", failing_since: "2026-11-25T11:00:00Z", dead_letters_7d: 2, last_delivered_at: null } };
  it("a new endpoint carries its secret once; a secret of the wrong shape is refused", () => {
    expect(parseNewEndpoint({ webhook: ep, secret: "whsec_x" }).webhook.failing).toBe(true);
    expect(() => parseNewEndpoint({ webhook: ep, secret: "sk_live_x" })).toThrow();
  });
  it("the log keeps only closed words (an unknown error word is dropped, an unknown status leaves the row out)", () => {
    const d = parseDeliveries({ items: [{ id: "22222222-2222-4222-8222-222222222222", event: "call.completed", status: "retrying", attempts: 2, last_status_code: 503, last_error: "weird", next_attempt_at: "2026-11-25T12:00:00Z", created_at: "2026-11-25T10:00:00Z", delivered_at: null }, { id: "33333333-3333-4333-8333-333333333333", event: "x.y", status: "new", attempts: 0, created_at: "2026-11-25T10:00:00Z" }], next_before: null });
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ error: null, code: 503, status: "retrying" });
  });
  it("usage and activity", () => {
    expect(parseActivityUsage({ today: { requests: 1, errors: 0 }, month: { requests: 2, errors: 1 }, limits: { requests_per_minute: 60, calls_per_minute: 10, campaigns_per_minute: 5, concurrent_calls: 10 } }).limits?.concurrentCalls).toBe(10);
    expect(parseActivity({ items: [{ id: "a", key_name: "K", method: "GET", route: "/api/v1/me", status: 200, latency_ms: 5, at: "2026-11-25T10:00:00Z" }], next_before: null }).items[0].route).toBe("/api/v1/me");
  });
  it("refusals are closed words", () => {
    expect(hookFailOf(new ApiRequestError(422, "webhook_url_invalid", "x", "private"))).toEqual({ ok: false, error: "url", reason: "private" });
    expect(hookFailOf(new ApiRequestError(409, "too_many_webhooks", "x"))).toEqual({ ok: false, error: "too_many" });
    expect(hookFailOf(new ApiRequestError(403, "mfa_required", "x"))).toEqual({ ok: false, error: "mfa" });
    expect(hookFailOf(new ApiRequestError(503, "webhooks_out_unavailable", "x"))).toEqual({ ok: false, error: "unavailable" });
  });
});
