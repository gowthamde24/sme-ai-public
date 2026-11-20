"use client";

import { MessageCircle, Phone } from "lucide-react";
import { useState } from "react";

import { testWord, type TestChannel } from "@/lib/jobs/detail";

import type { Say } from "../../words";
import { jobBtnQuiet, jobCard } from "./types";

/** "Try it": a test call or message to the OWNER's own phone, never to a customer. In test mode nothing is called and the answer says so. */
export function TryCard({ channel, t, onTest }: { channel: TestChannel; t: Say; onTest: () => Promise<{ ok: boolean; text: string; quiet?: boolean }> }) {
  const [busy, setBusy] = useState(false);
  // outside 9 am to 9 pm a test is refused (`409 quiet_hours`): the button stays off from then on
  const [quiet, setQuiet] = useState(false);
  const [answer, setAnswer] = useState<{ ok: boolean; text: string } | null>(null);
  const Icon = channel === "call" ? Phone : MessageCircle;
  const word = testWord(channel);
  return (
    <section data-part="job-try" className={jobCard}>
      <p className="m-0 text-xs font-bold uppercase tracking-wider text-muted">{t("jobs.job.try")}</p>
      <p className="m-0 mt-1.5 text-[15px] leading-snug text-ink">{t(`jobs.job.try_text.${word}`)}</p>
      <button
        type="button"
        disabled={busy || quiet}
        onClick={async () => {
          setBusy(true);
          const r = await onTest();
          setAnswer(r);
          if (r.quiet) setQuiet(true);
          setBusy(false);
        }}
        className={`${jobBtnQuiet} mt-3 min-h-12 w-full`}
      >
        <Icon aria-hidden="true" className="size-[18px]" />
        {t(`jobs.job.test.${word}`)}
      </button>
      {answer ? (
        <p role={answer.ok ? "status" : "alert"} className={`m-0 mt-2 text-sm leading-snug ${answer.ok ? "text-ink" : "text-red-text"}`}>
          {answer.text}
        </p>
      ) : null}
    </section>
  );
}
