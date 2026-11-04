"use client";

import { Check, CircleAlert, Copy } from "lucide-react";
import * as React from "react";

import type { SetupCard } from "@/lib/assistant-work/types";

import { SecretBox } from "./SecretBox";
import { btnSmall, cardBox, type WorkEnv } from "./work-env";
import { useCardState } from "./work-store";

function CopyRow({ label, value, code, t }: { label: string; value: string; code: boolean; t: WorkEnv["t"] }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div data-work="copy-row" className="mt-2">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <div className="mt-1 flex flex-wrap items-start gap-2">
        <p className={`min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2.5 py-2 text-sm [overflow-wrap:anywhere] ${code ? "font-mono" : ""}`}>{value}</p>
        <button type="button" data-work="copy" onClick={() => void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined)} className={btnSmall}>
          <Copy className="mr-1 size-4" aria-hidden="true" />
          {copied ? t("bv.work.setup.copied") : t("bv.work.setup.copy")}
        </button>
      </div>
    </div>
  );
}

/**
 * A guided setup as a step card (IndiaMART key, forwarding address and per-portal steps, website snippet, Google Sheet, voice and language, calling hours, follow-up rules, team invite): numbered steps,
 * the values to copy, a key box when the setup needs one, and a LIVE test ("Send a test lead", "Pull now") whose result says in words whether it works and, if not, why.
 */
export function SetupSteps({ card, env }: { card: SetupCard; env: WorkEnv }) {
  const { t } = env;
  const result = useCardState(env.store, card.id)?.test ?? card.lastTest;
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const runTest = async () => {
    if (!card.test) return;
    setBusy(true);
    setProblem(null);
    const out = await env.transport.liveTest(card.id, card.test);
    setBusy(false);
    if (out.ok) env.store.set(card.id, { test: out.result });
    else setProblem(out.error === "forbidden" ? "bv.chat.err.forbidden" : "bv.work.setup.test.err");
  };
  return (
    <article data-work="setup" data-setup={card.setup} aria-label={card.title} className={cardBox}>
      <h3 className="text-base font-semibold [overflow-wrap:anywhere]">{card.title}</h3>
      {card.steps.length > 0 ? (
        <ol data-work="setup-steps" className="mt-2 flex flex-col gap-1.5">
          {card.steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span aria-hidden="true" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-bg text-xs font-bold text-brand-text">
                {i + 1}
              </span>
              <span className="min-w-0 pt-0.5 [overflow-wrap:anywhere]">{s}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {card.copy.map((c, i) => (
        <CopyRow key={i} label={c.label} value={c.value} code={c.code} t={t} />
      ))}
      {card.portals.length > 0 ? (
        <div className="mt-3">
          <p className="text-sm font-semibold">{t("bv.work.setup.portals")}</p>
          <ul className="mt-1 flex flex-col gap-1.5">
            {card.portals.map((p) => (
              <li key={p.name}>
                <details className="rounded-lg border border-line bg-surface-2 px-2.5">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{p.name}</summary>
                  <ol className="list-decimal pb-2 pl-5 text-sm [overflow-wrap:anywhere]">
                    {p.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </details>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {card.secret ? <SecretBox card={card.secret} env={env} inline /> : null}
      {card.test ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" data-work="test" data-write disabled={busy} onClick={() => void runTest()} className={btnSmall}>
            {busy ? t("bv.work.setup.testing") : t(`bv.work.setup.test.${card.test}`)}
          </button>
          {card.screen ? (
            <a href={card.screen.href} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline underline-offset-2">
              {t("bv.work.open", { label: card.screen.label })}
            </a>
          ) : null}
        </div>
      ) : card.screen ? (
        <a href={card.screen.href} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline underline-offset-2">
          {t("bv.work.open", { label: card.screen.label })}
        </a>
      ) : null}
      {result && !busy ? (
        <div data-work="test-result" data-ok={result.ok} role="status" className={`mt-2 rounded-lg border p-2.5 text-sm font-medium ${result.ok ? "border-green-text bg-green-bg text-green-text" : "border-red-text bg-red-bg text-red-text"}`}>
          <p className="flex items-start gap-1.5">
            {result.ok ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            <span>{result.ok ? t("bv.work.setup.ok") : t("bv.work.setup.fail", { reason: t(`bv.work.setup.reason.${result.reason ?? "other"}`) })}</span>
          </p>
          {result.detail ? <p className="mt-1 text-xs [overflow-wrap:anywhere]">{result.detail}</p> : null}
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-2 text-sm font-medium text-red-text">
          {t(problem)}
        </p>
      ) : null}
    </article>
  );
}
