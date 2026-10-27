import { randomBytes } from "node:crypto";

import type { SourceTag } from "../imports/types";
import type { LiveSource, Secret, SourceCreateBody, SourceKind } from "./types";

/**
 * TEST MODE of the lead sources (LEADS_SCREENS=mock): what is kept in the one small cookie, and the FAKE secret that is shown once. Nothing is received from anywhere. The secret is made fresh for each create and rotate, handed to
 * the screen in that one answer, and never kept: the cookie holds only the last four letters (the hint). SERVER ONLY.
 */
export type MockSource = { id: string; kind: SourceKind; tag: SourceTag; label: string; status: "active" | "paused"; at: string; hint: string; cost: number | null; consent: boolean };

const TAG_OF: Record<Exclude<SourceKind, "email_forward">, SourceTag> = { website_form: "website_form", webhook: "webhook", meta_lead_ads: "meta_lead_ads", indiamart: "indiamart" };
export const tagFor = (body: Pick<SourceCreateBody, "kind" | "portal">): SourceTag => (body.kind === "email_forward" ? (body.portal ?? "webhook") : TAG_OF[body.kind]);

export function fakeSecret(kind: SourceKind): { secret: Secret | null; hint: string } {
  const token = randomBytes(18).toString("base64url");
  const hint = token.slice(-4);
  if (kind === "indiamart") return { secret: null, hint: "key" };
  const url = `https://api.example.test/v1/lead-intake/${token}`;
  const snippet = `<form method="post" action="${url}">\n  <input name="name" placeholder="Your name" required>\n  <input name="phone" placeholder="Phone" required>\n  <input name="message" placeholder="How can we help?">\n  <p hidden><input name="_hp" tabindex="-1" autocomplete="off"></p>\n  <button type="submit">Send</button>\n</form>`;
  return {
    hint,
    secret: {
      shown_once: true,
      url: kind === "meta_lead_ads" ? null : url,
      email_address: kind === "email_forward" ? `leads+${token}@inbound.example.test` : null,
      snippet_html: kind === "website_form" ? snippet : null,
      meta_callback_url: kind === "meta_lead_ads" ? `https://api.example.test/v1/lead-intake/meta/${token}` : null,
      meta_verify_token: kind === "meta_lead_ads" ? token : null,
    },
  };
}

/** A made-up arrival count that grows with the minutes since the source was made (one lead about every 5 minutes, up to 40), so the cards show something to look at. */
export function asLiveSource(s: MockSource, now: Date): LiveSource {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(s.at)) / 60_000));
  const count = s.status === "paused" ? 0 : Math.min(40, Math.floor(minutes / 5));
  return {
    id: s.id,
    kind: s.kind,
    tag: s.tag,
    label: s.label,
    status: s.status,
    created_at: s.at,
    last_received_at: count > 0 ? new Date(Date.parse(s.at) + count * 5 * 60_000).toISOString() : null,
    received_count: count,
    token_hint: s.hint === "key" ? null : s.hint,
    cost_per_lead_paise: s.cost,
    consent_confirmed: s.consent,
    available: s.kind !== "meta_lead_ads",
  };
}
