"use client";

import { Undo2 } from "lucide-react";
import * as React from "react";

import type { TalkPrefsCard as Card } from "@/lib/assistant-work/types";

import { btnSmall, type WorkEnv } from "./work-env";
import { useCardState } from "./work-store";

/**
 * "How it talks to you" changed by talking ("speak slower"): the sentence the assistant wrote in the conversation's language (the API's), what changed in our words, and Undo (15 minutes). A change that was already
 * undone shows no button; one whose 15 minutes ran out is told so when Undo is tried (the API knows the time, a browser clock does not). The choices are the person's own, never the business's.
 */
export function TalkPrefsView({ card, env }: { card: Card; env: WorkEnv }) {
  const { t } = env;
  const state = useCardState(env.store, card.id);
  const [busy, setBusy] = React.useState(false);
  const [fail, setFail] = React.useState<"expired" | "changed" | "down" | null>(null);
  const undone = state?.talkUndone === true || card.undo.state === "done";
  const open = !undone && fail !== "expired" && card.undo.state === "available" && card.undo.token !== null;
  const undo = async () => {
    if (!card.undo.token || busy) return;
    setBusy(true);
    setFail(null);
    const out = await env.transport.undoTalkPrefs(card.undo.token).catch(() => ({ ok: false as const, error: "down" as const }));
    setBusy(false);
    if (out.ok) env.store.set(card.id, { talkUndone: true });
    else setFail(out.error);
  };
  return (
    <article data-work="talk-prefs" data-undone={undone ? "true" : "false"} className="mt-2 rounded-xl border border-line bg-surface p-3">
      <p className="m-0 text-sm font-semibold text-muted">{t("bv.work.talk.t")}</p>
      <p className="m-0 mt-1 text-base [overflow-wrap:anywhere]">{card.summary}</p>
      {card.changed.length ? (
        <p className="m-0 mt-1 text-sm text-muted" data-part="talk-prefs-changed">
          {card.changed.map((f) => (/^(voice|style|address|words|speed)$/.test(f) ? t(`bv.work.talk.f.${f}` as "bv.work.talk.f.voice") : f)).join(" · ")}
        </p>
      ) : null}
      {undone ? (
        <p role="status" className="m-0 mt-2 text-sm font-semibold text-green-text">
          {t("bv.work.talk.undone")}
        </p>
      ) : open ? (
        <button type="button" disabled={busy} data-undo-talk onClick={() => void undo()} className={`${btnSmall} mt-2 gap-1.5`}>
          <Undo2 className="size-4" aria-hidden="true" />
          {t("bv.work.talk.undo")}
        </button>
      ) : null}
      {fail ? (
        <p role="alert" className="m-0 mt-2 text-sm font-semibold text-red-text">
          {t(`bv.work.talk.err.${fail}` as "bv.work.talk.err.down")}
        </p>
      ) : null}
    </article>
  );
}
