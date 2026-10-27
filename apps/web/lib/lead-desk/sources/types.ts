import { PORTALS, isUuid, parseConsent, MAX_COST_PAISE, type Consent, type Failure, type Out, type Portal, type SourceTag } from "../imports/types";

export type { Consent, Failure, Out, Portal, SourceTag };

/**
 * The live lead sources (night 4, Lead Desk, item 4; contract-lead-sources.md, section 2): where leads arrive by themselves. Each has an address that works like a password: the API shows it ONCE (at creation and after a
 * rotate) and keeps only a hash. Pure types and checks: the client components import the types only.
 */
export const SOURCE_KINDS = ["website_form", "webhook", "email_forward", "meta_lead_ads", "indiamart"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type SourceStatus = "active" | "paused";
export type LiveSource = { id: string; kind: SourceKind; tag: SourceTag; label: string; status: SourceStatus; created_at: string; last_received_at: string | null; received_count: number; token_hint: string | null; cost_per_lead_paise: number | null; consent_confirmed: boolean; available: boolean };
/** The secret part of an answer: it lives only in the response of that one action and in the component that shows it. Never stored, never logged. */
export type Secret = { shown_once: true; url: string | null; email_address: string | null; snippet_html: string | null; meta_callback_url: string | null; meta_verify_token: string | null };
export type SourceWithSecret = LiveSource & { secret: Secret | null };
export type Unparsed = { id: string; source_id: string; received_at: string; subject: string | null; preview: string };
export type PullResult = { fetched: number; created: number; merged: number; invalid: number; existing: number; window_start: string; window_end: string };
export type SourceCreateBody = { source_id: string; kind: SourceKind; label: string; portal: Portal | null; consent: Consent | null; cost_per_lead_paise: number | null };

export type SourcesRead = { mode: "off" } | { mode: "unavailable" } | { mode: "ok"; sources: LiveSource[]; unparsed: Unparsed[]; test: boolean };

export type SourceChecked = { ok: true; value: SourceCreateBody } | { ok: false; error: "invalid" };
export function checkSourceCreate(v: unknown): SourceChecked {
  const bad = { ok: false, error: "invalid" } as const;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return bad;
  const r = v as Record<string, unknown>;
  if (!isUuid(r.source_id) || !(SOURCE_KINDS as readonly unknown[]).includes(r.kind)) return bad;
  const label = typeof r.label === "string" ? r.label.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  if (label.length < 1 || label.length > 80) return bad;
  const kind = r.kind as SourceKind;
  const portal = r.portal === null || r.portal === undefined ? null : r.portal;
  if (portal !== null && (kind !== "email_forward" || !(PORTALS as readonly unknown[]).includes(portal))) return bad;
  const consent = parseConsent(r.consent);
  if (consent === "bad") return bad;
  const cost = r.cost_per_lead_paise === null || r.cost_per_lead_paise === undefined ? null : r.cost_per_lead_paise;
  if (cost !== null && (typeof cost !== "number" || !Number.isInteger(cost) || cost < 0 || cost > MAX_COST_PAISE)) return bad;
  return { ok: true, value: { source_id: r.source_id, kind, label, portal: portal as Portal | null, consent, cost_per_lead_paise: cost } };
}
