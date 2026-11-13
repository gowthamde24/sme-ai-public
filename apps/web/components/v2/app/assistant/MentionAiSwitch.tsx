"use client";

import * as React from "react";

import { btnQuiet, fieldHelp, warnBox } from "../ui";
import { makeT, type Words } from "../words";

const WARNED = "sme-opening-ai-warned";

/**
 * "Mention that I'm an AI assistant in the greeting" (owner 13 Nov 2026: the greeting lives in Talk training; this switch moved under it from Settings > Opening line). It saves at once (the workspace-level setting of `PUT /opening-line`, which C1 keeps), on by default. Off, the greeting is exactly
 * the owner's words, and the assistant still answers honestly if it is asked: the first time it is turned off in this browser a note says so, and that some regulators expect AI calls to be disclosed. Only the Owner changes it.
 */
export function MentionAiSwitch({ words, value, canEdit, save }: { words?: Words; value: boolean; canEdit: boolean; save: (mention: boolean) => Promise<{ ok: true } | { ok: false; error: string }> }) {
  const t = makeT(words);
  const [on, setOn] = React.useState(value);
  const [busy, start] = React.useTransition();
  const [warn, setWarn] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; key: "tt.ai.saved" | "tt.ai.err" } | null>(null);

  const turn = (next: boolean) => {
    const before = on;
    setOn(next);
    setMessage(null);
    if (next) setWarn(false);
    else {
      try {
        if (!localStorage.getItem(WARNED)) {
          localStorage.setItem(WARNED, "1");
          setWarn(true);
        }
      } catch {
        setWarn(true);
      }
    }
    start(async () => {
      const out = await save(next).catch(() => ({ ok: false as const, error: "down" }));
      if (out.ok) setMessage({ ok: true, key: "tt.ai.saved" });
      else {
        setOn(before);
        setMessage({ ok: false, key: "tt.ai.err" });
      }
    });
  };

  return (
    <div data-part="mention-ai">
      <label className="flex min-h-11 items-center gap-3 text-base font-semibold">
        <input type="checkbox" role="switch" checked={on} disabled={!canEdit || busy} onChange={(e) => turn(e.target.checked)} className="size-6 shrink-0 accent-brand-text" />
        {t("ope.ai.label")}
      </label>
      <p className={fieldHelp}>{t("ope.ai.help")}</p>
      {warn ? (
        <div role="note" className={warnBox} data-part="ai-warning">
          <p>{t("ope.ai.warn")}</p>
          <button type="button" onClick={() => setWarn(false)} className={`${btnQuiet} mt-2`}>
            {t("ope.ai.ok")}
          </button>
        </div>
      ) : null}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "mt-1.5 text-sm font-medium text-muted" : "mt-1.5 text-sm font-medium text-red-text"}>
          {t(message.key)}
        </p>
      ) : null}
    </div>
  );
}
