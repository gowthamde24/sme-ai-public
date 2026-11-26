"use client";

import * as React from "react";

import type { Done, Refusal } from "@/lib/employees/types";
import type { EmployeePreview } from "@/lib/api/employees";

import type { WizardLang } from "./draft";

/**
 * "Play sample": the employee's own line in its own voice (the API's preview), played from a blob: address (the page's media rule allows only this app and blob:). One sound at a time; nothing plays by itself.
 * `before` runs first (it saves the voice that was just picked) and may answer a refusal.
 */
export function useSamplePlayer(preview: (language: WizardLang) => Promise<Done<EmployeePreview>>) {
  const [playing, setPlaying] = React.useState<WizardLang | null>(null);
  const [loading, setLoading] = React.useState<WizardLang | null>(null);
  const [error, setError] = React.useState<Refusal | null>(null);
  const [said, setSaid] = React.useState<Partial<Record<WizardLang, string>>>({});
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const turn = React.useRef(0);
  const stop = React.useCallback(() => {
    turn.current += 1;
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
    setLoading(null);
  }, []);
  React.useEffect(() => stop, [stop]);

  const toggle = React.useCallback(
    async (language: WizardLang, before?: () => Promise<Refusal | null>) => {
      if (playing === language || loading === language) return stop();
      stop();
      setError(null);
      const mark = turn.current;
      setLoading(language);
      const early = before ? await before() : null;
      if (turn.current !== mark) return;
      if (early) {
        setLoading(null);
        return setError(early);
      }
      const out = await preview(language).catch(() => ({ ok: false as const, error: "unavailable" as Refusal }));
      if (turn.current !== mark) return;
      if (!out.ok) {
        setLoading(null);
        return setError(out.error);
      }
      setSaid((s) => ({ ...s, [language]: out.data.spokenText }));
      let url: string;
      try {
        url = URL.createObjectURL(new Blob([Uint8Array.from(atob(out.data.base64), (c) => c.charCodeAt(0))], { type: out.data.mime }));
      } catch {
        setLoading(null);
        return setError("unavailable");
      }
      const a = new Audio(url);
      audio.current = a;
      const done = () => {
        URL.revokeObjectURL(url);
        if (turn.current === mark) setPlaying(null);
      };
      a.onended = done;
      a.onerror = () => {
        done();
        if (turn.current === mark) setError("unavailable");
      };
      setLoading(null);
      setPlaying(language);
      a.play().catch(() => {
        done();
        if (turn.current === mark) setError("unavailable");
      });
    },
    [loading, playing, preview, stop],
  );
  return { playing, loading, error, said, toggle, stop };
}
