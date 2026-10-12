"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import type { PolicyKind, PolicyStatus } from "@/lib/api/policy";

import { FailureNote } from "../cc/FailureNote";
import { card, h2, okLine, primary, type Failed } from "../cc/kit";
import { makeT, type Words } from "../words";

export type AcceptResult = { ok: true; data: PolicyStatus } | Failed;

/**
 * Accept the Terms and the Privacy Policy again (job CC, screen 7): shown when a version changed. For each one that needs it: what the version is, a link to read it (a new tab), and a box the person ticks themselves;
 * the button sends only the versions that were shown. Nothing is ticked for them. If a version changed while the page was open, the page says so and reloads. The sentences are legal and stay English until a person reviews them.
 */
export function AcceptForm({ words, status, accept, next }: { words: Words; status: PolicyStatus; accept: (versions: { terms?: string; privacy?: string }) => Promise<AcceptResult>; next: string }) {
  const t = makeT(words);
  const id = useId();
  const router = useRouter();
  const kinds = (["terms", "privacy"] as PolicyKind[]).filter((k) => status.needs[k]);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [done, setDone] = useState(false);
  const all = kinds.every((k) => ticked[k]);

  async function send() {
    setBusy(true);
    setFailure(null);
    const r = await accept(Object.fromEntries(kinds.map((k) => [k, status.current[k].version])));
    setBusy(false);
    if (!r.ok) return setFailure(r);
    setDone(true);
    router.replace(next);
  }

  if (kinds.length === 0 || done)
    return (
      <section className={card} data-accept="done">
        <h1 className={h2}>{t("acpt.title")}</h1>
        <p role="status" className={okLine}>
          {t("acpt.nothing")}
        </p>
        <Link href={next} className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">
          {t("acpt.continue")}
        </Link>
      </section>
    );
  return (
    <section className={card} aria-labelledby={`${id}-h`} data-accept="form">
      <h1 id={`${id}-h`} className={h2}>
        {t("acpt.title")}
      </h1>
      <p className="text-base">{t("acpt.intro")}</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (all) void send();
        }}
      >
        {kinds.map((k) => (
          <div key={k} className="flex flex-col gap-1 rounded-xl border border-line p-3">
            <p className="text-base font-semibold">{t(`acpt.${k}`)}</p>
            <p className="text-sm text-muted">
              {t("acpt.version", { version: status.current[k].version })}
              {status.current[k].effective_from ? ` · ${t("acpt.from", { date: status.current[k].effective_from ?? "" })}` : ""}
            </p>
            <a href={k === "terms" ? "/terms" : "/privacy"} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">
              {t(`acpt.read.${k}`)}
            </a>
            <label className="flex min-h-11 items-center gap-3 text-base">
              <input type="checkbox" checked={ticked[k] ?? false} onChange={(e) => setTicked({ ...ticked, [k]: e.target.checked })} className="size-6 shrink-0 accent-brand-text" />
              {t(`acpt.agree.${k}`)}
            </label>
          </div>
        ))}
        <FailureNote failure={failure} words={words} own={(code) => (code === "policy_version_outdated" ? t("acpt.outdated") : null)} />
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy || !all} className={primary}>
            {busy ? t("dta.btn.working") : t("acpt.button")}
          </button>
          {failure?.code === "policy_version_outdated" ? (
            <button type="button" onClick={() => router.refresh()} className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">
              {t("acpt.reload")}
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
