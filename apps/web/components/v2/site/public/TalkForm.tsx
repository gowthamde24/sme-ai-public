"use client";

import { useState, useTransition } from "react";

import { Turnstile } from "@/components/v2/controls/Turnstile";
import { btnPrimary } from "@/components/v2/site/ui";
import type { TalkAction } from "@/lib/public/demo";

export type TalkWords = {
  name: string; contact: string; type: string; choose: string; time: string; what: string; consent: string; privacy: string; submit: string; note: string;
  okTitle: string; okBody: string; errName: string; errContact: string; errConsent: string; errRate: string; errCheck: string; errGeneric: string;
  types: readonly { id: string; label: string }[]; times: readonly { id: string; label: string }[];
};

const field = "min-h-12 w-full rounded-lg border border-edge bg-bg px-3 text-base text-ink focus:border-brand-edge";
const label = "mb-1.5 block text-sm font-semibold";

/**
 * Talk to us / Book a demo (the approved mock): name, phone or e-mail, kind of business, a good time, what you sell (optional), and the consent box. Plain labelled fields on a flat page, one button. The action stores nothing for now
 * (lib/public/demo.ts); a hidden field only a script fills is the honeypot. The words come from the server as props.
 */
export function TalkForm({ lang, words, action, privacyHref, turnstile = null }: { lang: string; words: TalkWords; action: TalkAction; privacyHref: string; turnstile?: string | null }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [type, setType] = useState("");
  const [time, setTime] = useState(words.times[0]?.id ?? "morning");
  const [what, setWhat] = useState("");
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const [token, setToken] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  const errors: Record<string, string> = { name: words.errName, contact: words.errContact, consent: words.errConsent, rate: words.errRate, check: words.errCheck, invalid: words.errGeneric };
  if (done) {
    return (
      <div role="status" className="max-w-xl border-y border-line py-5" data-part="talk-done">
        <p className="flex items-center gap-3 text-lg font-bold text-ink">
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-green-text" />
          {words.okTitle}
        </p>
        <p className="mt-2 text-base text-muted">{words.okBody}</p>
      </div>
    );
  }
  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setProblem(null);
        start(async () => {
          try {
            const out = await action({ lang, name, contact, type: type || "other", time, what, consent, website: trap, turnstileToken: token });
            if (out.ok) setDone(true);
            else {
              setProblem(errors[out.error] ?? words.errGeneric);
              setAgain((n) => n + 1);
            }
          } catch {
            setProblem(words.errGeneric);
            setAgain((n) => n + 1);
          }
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="tk-name" className={label}>{words.name}</label>
          <input id="tk-name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="tk-contact" className={label}>{words.contact}</label>
          <input id="tk-contact" autoComplete="tel" inputMode="text" maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} className={field} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="tk-type" className={label}>{words.type}</label>
          <select id="tk-type" value={type} onChange={(e) => setType(e.target.value)} className={field}>
            <option value="">{words.choose}</option>
            {words.types.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tk-time" className={label}>{words.time}</label>
          <select id="tk-time" value={time} onChange={(e) => setTime(e.target.value)} className={field}>
            {words.times.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="tk-what" className={label}>{words.what}</label>
        <input id="tk-what" maxLength={200} value={what} onChange={(e) => setWhat(e.target.value)} className={field} />
      </div>
      <div aria-hidden="true" className="sr-only">
        <input tabIndex={-1} autoComplete="off" name="website" value={trap} onChange={(e) => setTrap(e.target.value)} />
      </div>
      <label className="flex items-start gap-3 border-t border-line pt-4 text-base">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-6 shrink-0 accent-brand-text" />
        <span>
          {words.consent}{" "}
          <a href={privacyHref} target="_blank" rel="noopener" className="font-semibold text-brand-text underline underline-offset-2">{words.privacy}</a>
        </span>
      </label>
      {problem ? <p role="alert" className="flex items-center gap-3 text-base font-medium text-ink"><span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-[#c2410c]" />{problem}</p> : null}
      {turnstile ? <Turnstile siteKey={turnstile} lang={lang} onToken={setToken} again={again} /> : null}
      <button type="submit" disabled={pending || (turnstile !== null && token === null)} className={`${btnPrimary} self-start disabled:opacity-60 max-sm:w-full`}>
        {words.submit}
      </button>
      <p className="text-sm text-muted">{words.note}</p>
    </form>
  );
}
