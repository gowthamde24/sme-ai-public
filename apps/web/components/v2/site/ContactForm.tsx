"use client";

import { MessageCircle } from "lucide-react";
import { useState, useTransition } from "react";

import { Turnstile } from "@/components/v2/controls/Turnstile";
import { btnPrimary } from "@/components/v2/site/ui";
import type { LeadResult } from "@/lib/site/lead";

export type ContactWords = { name: string; type: string; other: string; what: string; consent: string; privacy: string; submit: string; nosave: string; errConsent: string; errName: string; errRate: string; errGeneric: string; errCheck: string; unavailable: string };

const field = "min-h-12 w-full rounded-lg border border-edge bg-surface px-3 text-base text-ink focus:border-brand-edge";
const label = "mb-1.5 block text-sm font-semibold";

/**
 * The contact form (job CM): a name, the kind of business, an optional question and consent, then "Continue on WhatsApp". Nothing is stored: the server checks it, counts the try against the address's hourly limit and returns
 * our WhatsApp address with the message filled in, which opens in the visitor's own WhatsApp to send. The words and the business types come from the server as props (this file holds no dictionary and names no business type).
 */
export function ContactForm({ lang, types, words, action, privacyHref, chatAvailable, turnstile = null }: { /** The Turnstile site key when the check is on (the server decides): the form then needs its token. */ turnstile?: string | null; lang: string; types: readonly { slug: string; name: string }[]; words: ContactWords; action: (input: unknown) => Promise<LeadResult>; privacyHref: string; chatAvailable: boolean }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("other");
  const [question, setQuestion] = useState("");
  const [consent, setConsent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [chat, setChat] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [token, setToken] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  const errors: Record<string, string> = { consent: words.errConsent, name: words.errName, rate: words.errRate, unavailable: words.unavailable, invalid: words.errGeneric, check: words.errCheck };
  if (!chatAvailable) return <p className="text-base text-muted" data-part="contact-unavailable">{words.unavailable}</p>;
  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setProblem(null);
        start(async () => {
          try {
            const out = await action({ lang, name, type, question, consent, turnstileToken: token });
            if (out.ok) {
              setChat(out.url);
              window.location.assign(out.url);
            } else {
              setProblem(errors[out.error] ?? words.errGeneric);
              setAgain((n) => n + 1); // a token is good for one try
            }
          } catch {
            setProblem(words.errGeneric);
            setAgain((n) => n + 1);
          }
        });
      }}
    >
      <div>
        <label htmlFor="cf-name" className={label}>{words.name}</label>
        <input id="cf-name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor="cf-type" className={label}>{words.type}</label>
        <select id="cf-type" value={type} onChange={(e) => setType(e.target.value)} className={field}>
          {types.map((t) => (
            <option key={t.slug} value={t.slug}>{t.name}</option>
          ))}
          <option value="other">{words.other}</option>
        </select>
      </div>
      <div>
        <label htmlFor="cf-what" className={label}>{words.what}</label>
        <textarea id="cf-what" rows={3} maxLength={400} value={question} onChange={(e) => setQuestion(e.target.value)} className={`${field} py-2`} />
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-6 shrink-0 accent-brand-text" />
        <span>
          {words.consent} <a href={privacyHref} target="_blank" rel="noopener" className="font-semibold text-brand-text underline underline-offset-2">{words.privacy}</a>
        </span>
      </label>
      {problem ? <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm font-medium text-danger-text">{problem}</p> : null}
      {turnstile ? <Turnstile siteKey={turnstile} lang={lang} onToken={setToken} again={again} /> : null}
      <button type="submit" disabled={pending || (turnstile !== null && token === null)} className={`${btnPrimary} self-start disabled:opacity-60`}>
        <MessageCircle className="size-5" aria-hidden="true" />
        {words.submit}
      </button>
      {chat ? <a href={chat} className="text-sm font-semibold text-brand-text underline underline-offset-2">{words.submit}</a> : null}
      <p className="text-sm text-muted">{words.nosave}</p>
    </form>
  );
}
