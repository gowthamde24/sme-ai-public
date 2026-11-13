import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyNext } from "../ds/EmptyNext";
import { StatusPill } from "../ds/StatusPill";
import { surface } from "../ui";
import { makeT, type Words } from "../words";
import type { AssistantStatus, Missing } from "@/lib/assistant-status/types";
import { fixHref } from "./GoLiveButton";
import { tabHref } from "./tabs";

const REQUIRED: readonly Missing[] = ["business_name", "phone_number"];

/** The tone the state's chip takes (the status colours of design system v6: green is done, blue is under way, grey is not started). */
export const STATE_PILL = { live: "completed", in_training: "transferred", not_live: "no_answer" } as const;

/**
 * The "Go live" tab: where the assistant stands, the two things that are needed (a business name and a connected phone number, nothing else), what still runs on defaults (and that this is fine), and the Go live / Pause button again. A status that cannot be read is an empty state with its
 * next step, never a blank. `mock` says (in the owner's words, English only) that on staging going live changes the status and nothing else.
 */
export function GoLivePanel({ words, base, status, button, mock }: { words?: Words; base: string; status: AssistantStatus | null; button: ReactNode; mock: boolean }) {
  const t = makeT(words);
  if (!status) {
    return <EmptyNext title={t("mya.g.unavailable.t")} text={t("mya.g.unavailable.d")} action={{ href: `${base}/settings?section=business`, label: t("mya.g.unavailable.go") }} />;
  }
  return (
    <section data-part="mya-golive-tab" aria-labelledby="mya-g-h" className={`${surface} flex flex-col gap-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="mya-g-h" className="font-display text-xl font-semibold">
          {t("mya.g.title")}
        </h2>
        <StatusPill status={STATE_PILL[status.state]}>{t(`nav.assistant.${status.state}` as "nav.assistant.live")}</StatusPill>
      </div>
      <p className="m-0 text-base">{t(`mya.g.sub.${status.state}` as "mya.g.sub.live")}</p>
      <div>
        <p className="m-0 text-base font-semibold">{t("mya.g.need")}</p>
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0" data-part="mya-requirements">
          {REQUIRED.map((m) => {
            const missing = status.missing.includes(m);
            return (
              <li key={m} data-done={missing ? "false" : "true"} className="flex flex-wrap items-center gap-2 text-base">
                <span aria-hidden="true" className={missing ? "text-muted" : "text-green-text"}>
                  {missing ? "○" : "✓"}
                </span>
                <span>{t(`mya.missing.${m}` as "mya.missing.business_name")}</span>
                <span className="sr-only">{t(missing ? "mya.g.todo" : "mya.g.done")}</span>
                {missing ? (
                  <Link href={fixHref(base, m)} className="inline-flex min-h-11 items-center font-semibold text-brand-text underline underline-offset-2">
                    {t(`mya.missing.fix.${m}` as "mya.missing.fix.business_name")}
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="mt-1 text-sm text-muted">{t("mya.missing.only")}</p>
      </div>
      {status.usingDefaults.length > 0 ? (
        <div data-part="mya-defaults-list">
          <p className="m-0 text-base font-semibold">{t("mya.g.defaults")}</p>
          <ul className="m-0 mt-1 flex list-none flex-wrap gap-2 p-0">
            {status.usingDefaults.map((p) => (
              <li key={p}>
                <Link href={tabHref(base, p === "voice" ? "voice" : p === "rules" ? "rules" : "knowledge")} className="inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-4 text-sm font-semibold hover:bg-surface-2">
                  {t(`mya.tab.${p === "voice" ? "voice" : p === "rules" ? "rules" : "knowledge"}` as "mya.tab.voice")}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-sm text-muted">{t("mya.g.defaults.fine")}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-start gap-3">{button}</div>
      <p className="m-0 text-sm text-muted">{t("mya.g.note")}</p>
      {mock ? (
        <p role="note" className="m-0 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted" data-part="mya-mock">
          {t("mya.g.mock")}
        </p>
      ) : null}
    </section>
  );
}
