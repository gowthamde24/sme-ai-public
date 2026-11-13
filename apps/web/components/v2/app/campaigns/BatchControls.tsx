"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { btnQuiet } from "../ui";
import { makeT, type Words } from "../words";

type Moved = { ok: true } | { ok: false; error: string };

/**
 * Pause and Undo for a running list (design system v6): "Pause" stops the calls at once; once paused (by the owner) the same place offers "Undo", which resumes it. A list a limit paused (calls, minutes, billing) is not undone from here: it says so. The change is
 * the page's own server action (`batchControlAction`, the Owner and Admin only: the API decides); the page then reads again.
 */
export function BatchControls({ words, state, pausedBy, control }: { words: Words; state: "running" | "paused"; pausedBy: "owner" | "limit" | null; control: (action: "pause" | "resume") => Promise<Moved> }) {
  const t = makeT(words);
  const router = useRouter();
  const [busy, start] = React.useTransition();
  const [note, setNote] = React.useState<string | null>(null);
  const move = (action: "pause" | "resume") =>
    start(async () => {
      setNote(null);
      const out = await control(action).catch((): Moved => ({ ok: false, error: "down" }));
      if (out.ok) router.refresh();
      else setNote(t("cv6.err.generic"));
    });
  return (
    <div className="flex flex-wrap items-center gap-2" data-part="batch-controls">
      {state === "running" ? (
        <button type="button" disabled={busy} onClick={() => move("pause")} className={btnQuiet}>
          {t("cv6.pause")}
        </button>
      ) : pausedBy === "limit" ? (
        <p className="text-sm text-muted">{t("cv6.paused.limit")}</p>
      ) : (
        <button type="button" disabled={busy} onClick={() => move("resume")} className={btnQuiet}>
          {t("cv6.undo")}
        </button>
      )}
      {note ? (
        <p role="alert" className="text-sm font-semibold text-red-text">
          {note}
        </p>
      ) : null}
    </div>
  );
}
