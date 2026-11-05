"use client";

import { Check, LockKeyhole } from "lucide-react";
import * as React from "react";

import type { SecretCard } from "@/lib/assistant-work/types";

import { btnDo, cardBox, type WorkEnv } from "./work-env";
import { useCardState } from "./work-store";

/**
 * The secure box for a key or password the assistant needs (IndiaMART key, a token...). The value lives ONLY in the masked input (uncontrolled: no React state ever holds it) until Save; then it is
 * read once, the box is emptied, and it goes to its own call (`transport.saveSecret`, then the route, then the API's secret store). It is never put into the conversation, never sent to the model,
 * never logged; after the save the chat shows "Saved · ••••1234" (the last four only when the API returns them) or "Saved". Only the Owner may save one.
 */
export function SecretBox({ card, env, inline = false }: { card: SecretCard; env: WorkEnv; inline?: boolean }) {
  const { t } = env;
  const saved = useCardState(env.store, card.id)?.secret ?? card.saved;
  const field = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const inputId = `secret-${card.id}`;
  const label = card.secret === "other" ? card.title : t(`bv.work.secret.kind.${card.secret}`);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const el = field.current;
    if (!el || busy) return;
    const value = el.value; // read once, here only
    el.value = "";
    if (value.trim() === "") return setProblem("bv.work.secret.err.empty");
    setBusy(true);
    setProblem(null);
    const out = await env.transport.saveSecret(card.requestId, value);
    setBusy(false);
    if (out.ok) env.store.set(card.id, { secret: { last4: out.last4 } });
    else setProblem(`bv.work.secret.err.${out.error}`);
  };
  const body = saved ? (
    <p data-work="secret-saved" role="status" className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-text">
      <Check className="size-4" aria-hidden="true" />
      {saved.last4 ? t("bv.work.secret.saved", { last4: saved.last4 }) : t("bv.work.secret.saved.plain")}
    </p>
  ) : env.role !== "owner" ? (
    <p data-work="owner-only" role="note" className="text-sm font-semibold text-amber-text">
      {t("bv.work.secret.err.forbidden")}
    </p>
  ) : (
    <form data-work="secret-form" onSubmit={(e) => void submit(e)} className="flex flex-col gap-2" autoComplete="off">
      <label htmlFor={inputId} className="text-sm font-semibold">
        {label}
      </label>
      <input
        ref={field}
        id={inputId}
        type="password"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        aria-describedby={`${inputId}-note`}
        disabled={busy}
        className="min-h-12 w-full min-w-0 rounded-lg border border-edge bg-surface px-3 text-base text-ink focus:border-brand-edge"
      />
      {card.hint ? <p className="text-xs text-muted [overflow-wrap:anywhere]">{card.hint}</p> : null}
      <button type="submit" data-work="secret-save" data-write disabled={busy} className={btnDo}>
        {busy ? t("bv.work.secret.saving") : t("bv.work.secret.save")}
      </button>
    </form>
  );
  return (
    <article data-work="secret" aria-label={t("bv.work.secret.label")} className={inline ? "mt-3 rounded-lg border border-line bg-surface-2 p-3" : cardBox}>
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <LockKeyhole className="size-4 shrink-0 text-brand-text" aria-hidden="true" />
        {t("bv.work.secret.label")}
      </h3>
      <p id={`${inputId}-note`} className="mb-2 mt-1 text-xs text-muted">
        {t("bv.work.secret.note")}
      </p>
      {body}
      {problem ? (
        <p role="alert" className="mt-2 text-sm font-medium text-red-text">
          {t(problem)}
        </p>
      ) : null}
    </article>
  );
}
