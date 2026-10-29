"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import type { FixResult } from "@/lib/lead-desk/leads-source";
import { URGENCIES, type FixField, type LeadProfile } from "@/lib/lead-desk/profile";

import { btnMain, fieldInput, pillAmber, pillNeutral } from "../ui";
import { makeT, type Words } from "../words";

const ROWS: readonly FixField[] = ["need", "quantity", "area", "city", "budget", "timeline", "urgency"];

/**
 * What this lead wants, as the assistant understood it (job context-and-easy-sources B3). A guessed field carries a small "?" and two taps: "That is right" (keeps the value for good) or "Change" (type the right one, or pick the urgency).
 * A fixed field is never marked and a later guess never overwrites it. The words the customer wrote stay one tap away.
 */
export function LeadProfileCard({ words, leadId, profile, canEdit, fix }: { words: Words; leadId: string; profile: LeadProfile; canEdit: boolean; fix: (leadId: string, field: string, value: string | null) => Promise<FixResult> }) {
  const t = makeT(words);
  const router = useRouter();
  const [editing, setEditing] = React.useState<FixField | null>(null);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);
  const shown = ROWS.filter((f) => profile[f] !== null);
  if (shown.length === 0 && !profile.originalText) return null;
  const save = async (field: FixField, value: string) => {
    setBusy(true);
    setError(false);
    const out = await fix(leadId, field, value).catch((): FixResult => ({ ok: false, error: "down" }));
    setBusy(false);
    if (out.ok) {
      setEditing(null);
      router.refresh();
    } else setError(true);
  };
  return (
    <section aria-labelledby="lp-card-h" data-part="lead-profile" className="mt-4 flex flex-col gap-2">
      <h2 id="lp-card-h" className="text-lg font-semibold text-ink">
        {t("lp.card.title")}
      </h2>
      <ul className="flex flex-col gap-2">
        {shown.map((f) => {
          const value = profile[f] as string;
          const guessed = profile.guessed.includes(f);
          return (
            <li key={f} data-field={f} data-guessed={guessed ? "1" : "0"} className="flex flex-col gap-1 rounded-xl border border-line px-3 py-2">
              <span className="text-sm text-muted">{t(`lp.f.${f}`)}</span>
              {editing === f ? (
                <span className="flex flex-wrap items-center gap-2">
                  {f === "urgency" ? (
                    <select aria-label={t(`lp.f.${f}`)} className={`${fieldInput} !min-h-11`} value={draft} onChange={(e) => setDraft(e.target.value)}>
                      {URGENCIES.map((u) => (
                        <option key={u} value={u}>
                          {t(`lp.urgency.${u}`)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input aria-label={t(`lp.f.${f}`)} className={`${fieldInput} !min-h-11`} value={draft} maxLength={200} onChange={(e) => setDraft(e.target.value)} />
                  )}
                  <button type="button" disabled={busy || draft.trim() === ""} onClick={() => save(f, draft)} className={btnMain}>
                    {t("lp.card.save")}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setEditing(null)} className="min-h-11 px-3 text-sm text-muted">
                    {t("lp.card.cancel")}
                  </button>
                </span>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base text-ink">{f === "urgency" ? <span className={value === "high" ? pillAmber : pillNeutral}>{t(`lp.urgency.${value}`)}</span> : value}</span>
                  {guessed ? (
                    <span className="font-semibold text-amber-text" title={t("lp.guess")} aria-label={t("lp.guess")}>
                      ?
                    </span>
                  ) : null}
                  {canEdit && guessed ? (
                    <button type="button" data-act="confirm" disabled={busy} onClick={() => save(f, value)} className="min-h-11 rounded-full border border-line px-3 text-sm font-semibold text-ink">
                      {t("lp.card.right")}
                    </button>
                  ) : null}
                  {canEdit ? (
                    <button
                      type="button"
                      data-act="change"
                      disabled={busy}
                      onClick={() => {
                        setDraft(value);
                        setError(false);
                        setEditing(f);
                      }}
                      className="min-h-11 px-3 text-sm text-muted underline"
                    >
                      {t("lp.card.change")}
                    </button>
                  ) : null}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-text">
          {t("lp.card.err")}
        </p>
      ) : null}
      {profile.originalText ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">{t("lp.original")}</summary>
          <p className="mt-1 whitespace-pre-wrap break-words text-ink">{profile.originalText}</p>
        </details>
      ) : null}
    </section>
  );
}
