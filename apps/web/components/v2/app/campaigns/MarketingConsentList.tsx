"use client";

import { personName } from "@/lib/api/marketing-consent";
import type { ConsentItemOut, ConsentListOut } from "@contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { NOTE_MAX, NOTE_MIN, tidyNote, type MarketingState } from "@/lib/api/marketing-consent";

import { btnMainLink, btnQuiet, fieldInput, mutedText, pillAmber, pillGreen, pillNeutral, surface } from "../ui";
import { makeT, type Words } from "../words";
import { cardBox } from "../Card";

type Result = { ok: true } | { ok: false; error: "stopped" | "invalid" | "forbidden" | "down" };
const day = (iso: string | null, lang: string): string => {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(lang === "en" ? "en-IN" : `${lang}-IN`, { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));
  } catch {
    return "";
  }
};

/**
 * "Who wants offers" (campaigns S4): the counts of the whole book, a search by name, a filter by state, and one row per customer with the state, how and when a yes was given, and the two buttons. A yes needs a short note (how it
 * was given); a no is one press. A customer who said STOP shows "Asked us to stop" and has no yes button. The list shows names, never numbers. The words of the consent lines are ours and stay English until a person reviews them.
 */
export function MarketingConsentList({ words, lang, base, q, state, list, after, actions }: { words: Words; lang: string; base: string; q: string; state: MarketingState | null; list: ConsentListOut; after: string | null; actions: { yes: (contactId: string, note: string) => Promise<Result>; no: (contactId: string) => Promise<Result> } }) {
  const t = makeT(words);
  const link = (over: { state?: MarketingState | null; after?: string | null }) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    const s = over.state === undefined ? state : over.state;
    if (s) p.set("state", s);
    if (over.after) p.set("after", over.after);
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  };
  return (
    <div data-part="marketing-consent" className="mt-5 flex flex-col gap-4">
      <ul data-part="mc-counts" className="flex flex-wrap gap-2">
        {(["granted", "unknown", "withdrawn"] as const).map((s) => (
          <li key={s} className={`${surface} !mt-0 min-w-[9rem]`}>
            <p className="m-0 font-display text-2xl font-bold">{list.counts[s]}</p>
            <p className={`${mutedText} !mt-0`}>{t(`mc.count.${s}`)}</p>
          </li>
        ))}
      </ul>
      <div data-part="mc-card" className={`${cardBox} flex flex-col gap-4`}>
      <form method="get" action={base} className="flex flex-wrap items-end gap-2" role="search">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("mc.search")}</span>
          <input type="search" name="q" defaultValue={q} maxLength={60} placeholder={t("mc.search")} className={fieldInput} />
        </label>
        {state ? <input type="hidden" name="state" value={state} /> : null}
        <button type="submit" className={btnMainLink}>
          {t("mc.search.go")}
        </button>
      </form>
      <nav aria-label={t("mc.filter")} className="flex flex-wrap gap-2" data-part="mc-filter">
        {([null, "granted", "unknown", "withdrawn"] as const).map((s) => (
          <Link key={s ?? "all"} href={link({ state: s })} aria-current={state === s ? "page" : undefined} className={state === s ? `${btnMainLink} !min-h-10` : `${btnQuiet} !min-h-10`}>
            {t(s === null ? "mc.filter.all" : `mc.state.${s}`)}
          </Link>
        ))}
      </nav>
      {list.items.length === 0 ? (
        <p className={mutedText} data-part="mc-empty">
          {t("mc.empty")}
        </p>
      ) : (
        <ul className="flex flex-col">
          {list.items.map((it) => (
            <Row key={it.contact_id} it={it} t={t} lang={lang} actions={actions} />
          ))}
        </ul>
      )}
      </div>
      {list.next_cursor ? (
        <div>
          <Link href={link({ after: list.next_cursor })} className={btnQuiet} data-part="mc-more">
            {t("mc.more")}
          </Link>
        </div>
      ) : null}
      {after ? (
        <div>
          <Link href={link({ after: null })} className={btnQuiet}>
            {t("mc.first")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function Row({ it, t, lang, actions }: { it: ConsentItemOut; t: ReturnType<typeof makeT>; lang: string; actions: { yes: (contactId: string, note: string) => Promise<Result>; no: (contactId: string) => Promise<Result> } }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pill = it.state === "granted" ? pillGreen : it.state === "withdrawn" ? pillAmber : pillNeutral;
  const run = async (go: () => Promise<Result>) => {
    setBusy(true);
    setError(null);
    const r = await go().catch((): Result => ({ ok: false, error: "down" }));
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setNote("");
      router.refresh();
    } else setError(r.error === "stopped" ? t("mc.err.stopped") : t("mc.err.generic"));
  };
  const given = it.state === "granted" ? [it.via ? t(`mc.via.${it.via}`) : null, it.at ? day(it.at, lang) : null, personName(it.by), it.note].filter((x): x is string => !!x && !x.startsWith("mc.via.")) : [];
  const short = tidyNote(note) === null;
  return (
    <li data-part="mc-row" data-state={it.state} className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 font-display text-lg font-bold">{it.name ?? t("mc.noname")}</p>
        <span className="flex flex-wrap gap-2">
          {it.stopped ? <span className={pillAmber}>{t("mc.stopped")}</span> : null}
          <span className={pill}>{t(`mc.state.${it.state}`)}</span>
        </span>
      </div>
      {given.length > 0 ? <p className={`${mutedText} !mt-0`}>{given.join(" · ")}</p> : null}
      {open ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!short) void run(() => actions.yes(it.contact_id, note));
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t("mc.note.label")}
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} className={fieldInput} autoFocus />
          </label>
          <p className={`${mutedText} !mt-0`}>{t("mc.note.hint").replace("{min}", String(NOTE_MIN)).replace("{max}", String(NOTE_MAX))}</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || short} className={btnMainLink}>
              {t("mc.note.save")}
            </button>
            <button type="button" disabled={busy} className={btnQuiet} onClick={() => setOpen(false)}>
              {t("mc.note.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {it.state !== "granted" && !it.stopped ? (
            <button type="button" className={btnQuiet} disabled={busy} onClick={() => setOpen(true)}>
              {t("mc.yes.button")}
            </button>
          ) : null}
          {it.state !== "withdrawn" ? (
            <button type="button" className={btnQuiet} disabled={busy} onClick={() => void run(() => actions.no(it.contact_id))}>
              {t("mc.no.button")}
            </button>
          ) : null}
        </div>
      )}
      {error ? (
        <p role="alert" className="m-0 text-sm font-medium text-red-text">
          {error}
        </p>
      ) : null}
    </li>
  );
}
