"use client";

import * as React from "react";

import { fixtureTransport } from "@/lib/assistant-work/client";
import { CANT_DO_JSON, CATALOGUE_PREVIEW_JSON, HOURS_PLAN_JSON, IMPORT_PLAN_JSON, MULTI_PLAN_JSON, NOT_YET_JSON, PREVIEW_JSON, SECRET_JSON, SETUP_EMAIL_JSON, SETUP_FORM_JSON, SETUP_HOURS_JSON, SETUP_INDIAMART_ID, SETUP_INDIAMART_JSON, STAFF_PLAN_JSON, planCardJson } from "@/lib/assistant-work/fixtures";
import { parseWorkCard, type WorkCard } from "@/lib/assistant-work/types";

import { makeT, type Words } from "../../../words";
import { useChatWork } from "./use-chat-work";
import { WorkCards } from "./WorkCards";
import type { WorkRole } from "./work-env";

const PLANS = [IMPORT_PLAN_JSON, HOURS_PLAN_JSON, STAFF_PLAN_JSON, MULTI_PLAN_JSON, CATALOGUE_PREVIEW_JSON.plan];
const CARDS = [PREVIEW_JSON, CATALOGUE_PREVIEW_JSON, planCardJson(MULTI_PLAN_JSON), planCardJson(STAFF_PLAN_JSON), planCardJson(HOURS_PLAN_JSON), SECRET_JSON, SETUP_INDIAMART_JSON, SETUP_EMAIL_JSON, SETUP_FORM_JSON, SETUP_HOURS_JSON, CANT_DO_JSON, NOT_YET_JSON];

/**
 * The fixture-only preview of the work cards (ASSISTANT_WORK_SCREENS=mock, not linked from any menu): every card with made-up data, as the Owner or as Staff, and the composer's file chips, so the
 * screens can be looked at and photographed before C1's API exists. Nothing on it is saved or sent: the answers are made in this page (one multi-step plan fails a step on purpose, IndiaMART's test fails).
 */
export function WorkPreview({ words, base }: { words: Words; base: string }) {
  const t = React.useMemo(() => makeT(words), [words]);
  const [role, setRole] = React.useState<WorkRole>("owner");
  const transport = React.useMemo(() => fixtureTransport({ delay: 400, failTools: ["auto_reply.sunday_off"], failTests: { [SETUP_INDIAMART_ID]: "key_rejected" } }, PLANS), []);
  const [text, setText] = React.useState("");
  const work = useChatWork({ mode: "mock", role }, base, words, setText, transport);
  const cards = React.useMemo(() => CARDS.map((c) => parseWorkCard(c, base)).filter((c): c is WorkCard => c !== null), [base]);
  return (
    <div className="flex flex-col gap-6">
      <p role="note" className="rounded-lg border border-line bg-info-bg p-3 text-sm font-medium text-info-text">
        {t("awp.note")}
      </p>
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="mb-1 text-sm font-semibold">{t("awp.role")}</legend>
        {(["owner", "sales"] as const).map((r) => (
          <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)} className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${role === r ? "border-brand-edge bg-brand-bg text-brand-text" : "border-edge bg-surface text-ink hover:bg-surface-2"}`}>
            {t(`awp.role.${r}`)}
          </button>
        ))}
      </fieldset>
      <section aria-label={t("awp.composer")} className="max-w-[440px]">
        <h2 className="mb-2 font-display text-lg font-semibold">{t("awp.composer")}</h2>
        <form data-chat="form" className="flex min-w-0 flex-col gap-1 rounded-[16px] border border-edge bg-surface p-2.5 focus-within:border-brand-edge" {...work.dropProps} onSubmit={(e) => e.preventDefault()}>
          {work.chips}
          {work.input}
          <label htmlFor="preview-input" className="sr-only">
            {t("bv.bar.placeholder")}
          </label>
          <textarea id="preview-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("bv.bar.placeholder")} className="block min-h-11 w-full resize-none bg-transparent px-1 py-2 text-base text-ink outline-none placeholder:text-muted" />
          <div className="flex items-center gap-1">{work.menuItem(() => undefined)}</div>
        </form>
      </section>
      <section aria-label={t("awp.cards")} className="max-w-[440px]">
        <h2 className="mb-2 font-display text-lg font-semibold">{t("awp.cards")}</h2>
        {/* the same bubble as the chat's answer */}
        <div className="rounded-2xl bg-surface-2 px-3.5 py-2.5">{work.env ? <WorkCards key={role} cards={cards} env={work.env} /> : null}</div>
      </section>
    </div>
  );
}
