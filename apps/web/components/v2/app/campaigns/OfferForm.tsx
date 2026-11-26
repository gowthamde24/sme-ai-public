"use client";

import type { CampaignOut } from "@contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, primary, quiet } from "../visits/styles";
import { cardBox } from "../Card";

const LANGS = ["en", "te", "hi", "kn"] as const;
type Lang = (typeof LANGS)[number];
type Refused = { ok: false; error: string; mfa?: boolean };
export type OfferFormInput = { name: string; language: Lang; waTemplateId: string; messageText: string; offerLabel: string; weeklyCap: number; time: string };
export type OfferFormActions = { save: (id: string, input: OfferFormInput) => Promise<{ ok: true; campaignId: string; backToDraft: boolean } | Refused> };
export type OfferTemplate = { id: string; name: string; language: string; body: string };

/** The campaign's words are the template's words with our three merge fields (the database checks that they are the same). */
export const offerText = (body: string): string => body.replace(/\{\{1\}\}/g, "{{name}}").replace(/\{\{2\}\}/g, "{{business}}").replace(/\{\{3\}\}/g, "{{label}}");
const preview = (body: string, label: string, business: string): string => body.replace(/\{\{1\}\}/g, "Ravi").replace(/\{\{2\}\}/g, business).replace(/\{\{3\}\}/g, label || "…");

/**
 * Make or change an OFFER campaign (campaigns S4, behind OFFER_SCREENS). You pick one approved offer message (its words are fixed: the template's), type ONE short label that fills it (a collection or an occasion: no price, link or "off"),
 * choose the time of day and how many offers one customer may get in a week (1 to 3), and see the message as a customer will. Who gets it is the next step: the customers who said yes. Saving sends nothing; the Owner approves after.
 */
export function OfferForm(p: { base: string; campaignId: string; campaign: CampaignOut | null; templates: readonly OfferTemplate[]; business: string; words: TodayWords; actions: OfferFormActions; go?: (href: string) => void }) {
  const { words, campaign } = p;
  const router = useRouter();
  const go = p.go ?? ((href: string) => router.push(href));
  const [name, setName] = React.useState(campaign?.name ?? "");
  const [template, setTemplate] = React.useState(campaign?.wa_template_id ?? p.templates[0]?.id ?? "");
  const [offerLabel, setOfferLabel] = React.useState(campaign?.offer_label ?? "");
  const [cap, setCap] = React.useState(String(campaign?.weekly_cap ?? 1));
  const [time, setTime] = React.useState(campaign?.steps[0]?.time ?? "10:00");
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const chosen = p.templates.find((t) => t.id === template) ?? null;
  const tidy = offerLabel.replace(/\s+/g, " ").trim();

  async function save() {
    if (busy) return;
    setProblem(null);
    if (name.trim() === "") return setProblem({ text: say(words, "camp.err.name") });
    if (!chosen) return setProblem({ text: say(words, "of.err.template") });
    if (tidy.length < 2 || tidy.length > 30) return setProblem({ text: say(words, "of.err.label") });
    const language = (LANGS as readonly string[]).includes(chosen.language) ? (chosen.language as Lang) : "en";
    setBusy(true);
    const out = await p.actions.save(p.campaignId, { name: name.trim(), language, waTemplateId: chosen.id, messageText: offerText(chosen.body), offerLabel: tidy, weeklyCap: Number(cap), time });
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    go(`${p.base}/campaigns/${out.campaignId}${out.backToDraft ? "?back=1" : "?saved=1"}${campaign ? "" : "&tab=audience"}`);
  }

  return (
    <form data-screen="offer-form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className={`${cardBox} flex max-w-2xl flex-col gap-5`}>
      <div>
        <label htmlFor="of-name" className={label}>{say(words, "camp.field.name")}</label>
        <input id="of-name" value={name} maxLength={100} disabled={busy} onChange={(e) => setName(e.target.value)} className={field} />
        <p className={help}>{say(words, "of.name.help")}</p>
      </div>
      <div>
        <label htmlFor="of-template" className={label}>{say(words, "of.template")}</label>
        <select id="of-template" value={template} disabled={busy || p.templates.length === 0 || campaign !== null} onChange={(e) => setTemplate(e.target.value)} className={field}>
          {p.templates.length === 0 ? <option value="">{say(words, "of.template.none")}</option> : null}
          {p.templates.map((t) => (<option key={t.id} value={t.id}>{`${t.name} · ${say(words, `today.lang.${LANGS.includes(t.language as Lang) ? t.language : "en"}`)}`}</option>))}
        </select>
        <p className={help}>
          {p.templates.length === 0 ? say(words, "of.template.empty") : say(words, "of.template.help")}{" "}
          <Link href={`${p.base}/chats/templates`} className="font-semibold underline">{say(words, "camp.field.template.link")}</Link>
        </p>
      </div>
      <div>
        <label htmlFor="of-label" className={label}>{say(words, "of.label")}</label>
        <input id="of-label" value={offerLabel} maxLength={30} disabled={busy} onChange={(e) => setOfferLabel(e.target.value)} className={field} aria-describedby="of-label-h" />
        <p id="of-label-h" className={help}>{say(words, "of.label.help")}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
        <div>
          <label htmlFor="of-time" className={label}>{say(words, "of.time")}</label>
          <input id="of-time" type="time" value={time} disabled={busy} onChange={(e) => setTime(e.target.value)} className={field} />
          <p className={help}>{say(words, "of.time.help")}</p>
        </div>
        <div>
          <label htmlFor="of-cap" className={label}>{say(words, "of.cap")}</label>
          <select id="of-cap" value={cap} disabled={busy} onChange={(e) => setCap(e.target.value)} className={field}>
            {[1, 2, 3].map((n) => (<option key={n} value={n}>{say(words, "of.cap.n", { n })}</option>))}
          </select>
          <p className={help}>{say(words, "of.cap.help")}</p>
        </div>
      </div>
      {chosen ? (
        <section aria-labelledby="of-prev" data-part="offer-preview" className="flex flex-col gap-2">
          <h2 id="of-prev" className="font-display text-lg font-bold">{say(words, "of.preview")}</h2>
          <div className="max-w-md self-start whitespace-pre-wrap rounded-xl rounded-tl-sm bg-green-bg p-3 text-base text-ink shadow-sm [overflow-wrap:anywhere]">{preview(chosen.body, tidy, p.business)}</div>
          <p className={help}>{say(words, "of.preview.help")}</p>
        </section>
      ) : null}
      {problem ? (
        <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
          <p>{problem.text}</p>
          {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={primary} disabled={busy || p.templates.length === 0}>{busy ? say(words, "today.act.working") : say(words, "of.save")}</button>
        <Link href={campaign ? `${p.base}/campaigns/${campaign.id}` : `${p.base}/campaigns`} className={quiet}>{say(words, "today.act.cancel")}</Link>
      </div>
    </form>
  );
}
