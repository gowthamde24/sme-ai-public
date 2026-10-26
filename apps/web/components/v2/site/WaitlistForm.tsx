"use client";

import { CheckCircle2 } from "lucide-react";
import { useState, useTransition } from "react";

import { btnPrimary } from "@/components/v2/site/ui";
import type { WaitlistLang, WaitlistResult } from "@/lib/waitlist/types";

export type WaitlistWords = {
  name: string; type: string; city: string; contact: string; language: string; marketing: string; notice: string; privacy: string; submit: string; thanksTitle: string; thanksBody: string;
  errName: string; errCity: string; errContact: string; errRate: string; errDown: string; errGeneric: string;
};

const field = "min-h-12 w-full rounded-lg border border-edge bg-surface px-3 text-base text-ink focus:border-brand-edge";
const label = "mb-1.5 block text-sm font-semibold";

/**
 * "Book a demo / join the waitlist" (job DQ): a name, the kind of business, a city, a phone number or an e-mail, the language, and a SEPARATE box for news and offers that is never ticked for the visitor. The server checks it all and
 * posts it to the API; this file holds no dictionary and names no business type (the words, the business types and the languages come from the server as props). A hidden field that only a script fills is the trap for bots.
 * After a good answer the form is replaced by the thank-you.
 */
export function WaitlistForm({ lang, types, langs, words, action, privacyHref, idPrefix = "wl" }: { lang: string; types: readonly { slug: string; name: string }[]; langs: readonly { code: WaitlistLang; name: string }[]; words: WaitlistWords; action: (input: unknown) => Promise<WaitlistResult>; privacyHref: string; idPrefix?: string }) {
  const [name, setName] = useState("");
  const [type, setType] = useState(types[0]?.slug ?? "other");
  const [city, setCity] = useState("");
  const [contact, setContact] = useState("");
  const [language, setLanguage] = useState<string>(langs.some((l) => l.code === lang) ? lang : "en");
  const [marketing, setMarketing] = useState(false);
  const [trap, setTrap] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const errors: Record<string, string> = { name: words.errName, city: words.errCity, contact: words.errContact, rate: words.errRate, down: words.errDown, invalid: words.errGeneric };
  if (done)
    return (
      <div role="status" className="flex max-w-xl items-start gap-3 rounded-xl border border-line bg-surface p-5" data-part="waitlist-thanks">
        <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-green-text" aria-hidden="true" />
        <div>
          <p className="font-display text-xl font-semibold">{words.thanksTitle}</p>
          <p className="mt-1 text-base text-muted">{words.thanksBody}</p>
        </div>
      </div>
    );
  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      data-part="waitlist"
      onSubmit={(e) => {
        e.preventDefault();
        setProblem(null);
        start(async () => {
          try {
            const out = await action({ name, businessType: type, city, contact, language, marketingOptIn: marketing, website: trap });
            if (out.ok) setDone(true);
            else setProblem(errors[out.error] ?? words.errGeneric);
          } catch {
            setProblem(words.errGeneric);
          }
        });
      }}
    >
      <div>
        <label htmlFor={`${idPrefix}-name`} className={label}>{words.name}</label>
        <input id={`${idPrefix}-name`} autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-type`} className={label}>{words.type}</label>
        <select id={`${idPrefix}-type`} value={type} onChange={(e) => setType(e.target.value)} className={field}>
          {types.map((t) => (
            <option key={t.slug} value={t.slug}>{t.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-city`} className={label}>{words.city}</label>
        <input id={`${idPrefix}-city`} autoComplete="address-level2" maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-contact`} className={label}>{words.contact}</label>
        <input id={`${idPrefix}-contact`} autoComplete="email tel" inputMode="email" maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-lang`} className={label}>{words.language}</label>
        <select id={`${idPrefix}-lang`} value={language} onChange={(e) => setLanguage(e.target.value)} className={field}>
          {langs.map((l) => (
            <option key={l.code} value={l.code}>{l.name}</option>
          ))}
        </select>
      </div>
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" name="website" value={trap} onChange={(e) => setTrap(e.target.value)} />
        </label>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5 size-6 shrink-0 accent-brand-text" data-part="marketing-optin" />
        <span>{words.marketing}</span>
      </label>
      <p className="text-sm text-muted">
        {words.notice}{" "}
        <a href={privacyHref} target="_blank" rel="noopener" className="font-semibold text-brand-text underline underline-offset-2">{words.privacy}</a>
      </p>
      {problem ? <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm font-medium text-danger-text">{problem}</p> : null}
      <button type="submit" disabled={pending} className={`${btnPrimary} self-start disabled:opacity-60`}>
        {words.submit}
      </button>
    </form>
  );
}
