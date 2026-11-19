"use client";

import * as React from "react";

import type { TalkTraining } from "@/lib/talk-training/types";
import { introduceProblem, type IntroduceAs } from "@/lib/talk-training/introduce";

import { IntroduceAsField } from "../assistant/IntroduceAsField";
import { alertBox, btnMain, okBox, surface } from "../ui";
import { makeT, type Words } from "../words";

/**
 * "Introduce as" for the owner's test calls, drawn on Place a test call (owner, 19 Nov 2026: it left the Voice & tone page, where it did nothing for customers). The setting and the way it is saved are the same as before: with "How your assistant speaks" it goes as `{ introduceAs }`
 * (the one thing changed), without it the whole Talk training document goes with the new "introduce as" (the API takes the document at once). Both need the Owner's second step; the answer is shown as it came back.
 */
export type IntroduceSave =
  | { kind: "speaks"; save: (change: { introduceAs: IntroduceAs }) => Promise<{ ok: true; data: { introduceAs: IntroduceAs & { ownerName: string | null } } } | { ok: false; error: string }> }
  | { kind: "training"; doc: TalkTraining; save: (doc: TalkTraining) => Promise<{ ok: true; data: { training: TalkTraining } } | { ok: false; error: string }> };

export function TestCallIntroduce({ words, initial, ownerName, business, via, securityHref }: { words?: Words; initial: IntroduceAs; ownerName?: string | null; business: string | null; via: IntroduceSave; securityHref: string }) {
  const t = makeT(words);
  const [saved, setSaved] = React.useState<IntroduceAs>({ kind: initial.kind, text: initial.text });
  const [value, setValue] = React.useState<IntroduceAs>({ kind: initial.kind, text: initial.text });
  const [owner, setOwner] = React.useState(ownerName);
  const [msg, setMsg] = React.useState<{ ok: true } | { ok: false; error: string } | null>(null);
  const [busy, start] = React.useTransition();
  const same = value.kind === saved.kind && (value.kind === "business" || (value.text ?? "").trim() === (saved.text ?? "").trim());
  const bad = introduceProblem({ kind: value.kind, text: value.kind === "business" ? null : value.text });
  const save = () => {
    if (same || bad) return;
    start(async () => {
      if (via.kind === "speaks") {
        const out = await via.save({ introduceAs: value });
        if (!out.ok) return setMsg(out);
        const ia = { kind: out.data.introduceAs.kind, text: out.data.introduceAs.text };
        setSaved(ia);
        setValue(ia);
        setOwner(out.data.introduceAs.ownerName);
      } else {
        const out = await via.save({ ...via.doc, introduceAs: value });
        if (!out.ok) return setMsg(out);
        const ia = out.data.training.introduceAs ?? value;
        setSaved({ kind: ia.kind, text: ia.text });
        setValue({ kind: ia.kind, text: ia.text });
      }
      setMsg({ ok: true });
    });
  };
  const err = msg && !msg.ok ? (msg.error === "introduce" ? t("tt.err.introduce_as") : t(`sp.err.${msg.error}`) !== `sp.err.${msg.error}` ? t(`sp.err.${msg.error}`) : t(`tt.err.${msg.error}` as "tt.err.down")) : null;
  return (
    <section className={`${surface} flex flex-col gap-3`} data-part="test-call-introduce-saved" aria-labelledby="tc-intro-card">
      <h2 id="tc-intro-card" className="m-0 font-display text-[18px] font-bold leading-tight md:text-xl">
        {t("vt.intro.card")}
      </h2>
      <IntroduceAsField t={t} value={value} off={busy} business={business} ownerName={owner} onChange={(v) => (setValue(v), setMsg(null))} />
      <div>
        <button type="button" className={btnMain} disabled={busy || same || bad !== null} onClick={save} data-part="tc-intro-save">
          {busy ? t("sp.saving") : t("sp.save")}
        </button>
      </div>
      {msg?.ok ? (
        <p role="status" className={`${okBox} m-0`}>
          {t("sp.saved")}
        </p>
      ) : null}
      {err ? (
        <p role="alert" className={`${alertBox} m-0`}>
          {err}
          {msg && !msg.ok && msg.error === "mfa" ? (
            <>
              {" "}
              <a href={securityHref} className="font-semibold underline">
                {t("today.err.mfa.link")}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
