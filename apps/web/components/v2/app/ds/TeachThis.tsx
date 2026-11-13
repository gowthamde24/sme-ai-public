"use client";

import { Pencil } from "lucide-react";
import * as React from "react";

import { ANSWER_MAX, ANSWER_MIN, type Source } from "@/lib/corrections/limits";

import { btnMain, btnQuiet, fieldTextarea } from "../ui";
import { makeT, type Words } from "../words";

type Out = { ok: true; id: string } | { ok: false; error: string };
export type TeachActions = { save: (input: { source: Source; sourceId: string; lineIndex: number; answer: string }) => Promise<Out>; undo: (id: string) => Promise<{ ok: true } | { ok: false; error: string }> };

/**
 * "✎ Teach this" under a line the ASSISTANT said (calls, chats, practice; owner 13 Nov 2026): the owner writes what it should have said, it is saved into Knowledge ("Saved to Knowledge") and can be undone at once. The text starts as the line itself. Only the Owner and Admin are offered it (`actions` null = not drawn).
 */
export function TeachThis({ words, source, sourceId, lineIndex, line, actions }: { words?: Words; source: Source; sourceId: string; lineIndex: number; line: string; actions: TeachActions | null }) {
  const t = makeT(words);
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(line);
  const [busy, start] = React.useTransition();
  const [saved, setSaved] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  if (!actions) return null;
  const valid = text.trim().length >= ANSWER_MIN && text.length <= ANSWER_MAX && !/[<>]/.test(text);
  return (
    <div data-part="teach" className="mt-1">
      {saved !== null ? (
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm font-medium text-green-text">
          {t("dst.teach.saved")}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const r = await actions.undo(saved).catch(() => ({ ok: false as const, error: t("dst.teach.err.down") }));
                if (r.ok) {
                  setSaved(null);
                  setOpen(false);
                } else setError(r.error);
              })
            }
            className="font-semibold underline"
          >
            {t("dst.teach.undo")}
          </button>
        </p>
      ) : open ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`teach-${source}-${sourceId}-${lineIndex}`} className="text-sm font-semibold">
            {t("dst.teach.label")}
          </label>
          <textarea id={`teach-${source}-${sourceId}-${lineIndex}`} rows={3} maxLength={ANSWER_MAX} value={text} onChange={(e) => setText(e.target.value)} className={`${fieldTextarea} min-h-20`} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !valid}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await actions.save({ source, sourceId, lineIndex, answer: text.trim() }).catch(() => ({ ok: false as const, error: t("dst.teach.err.down") }));
                  if (r.ok) setSaved(r.id);
                  else setError(r.error);
                })
              }
              className={btnMain}
            >
              {t("dst.teach.save")}
            </button>
            <button type="button" disabled={busy} onClick={() => setOpen(false)} className={btnQuiet}>
              {t("dst.teach.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-brand-text hover:underline">
          <Pencil className="size-4" aria-hidden="true" />
          {t("dst.teach")}
        </button>
      )}
      {error ? (
        <p role="alert" className="mt-1 text-sm font-medium text-red-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
