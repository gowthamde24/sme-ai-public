"use client";

import { useEffect, useId, useRef, useState } from "react";

import { LocalTime } from "@/app/app/local-time";
import type { DataExport } from "@/lib/api/privacy";

import { FailureNote } from "../cc/FailureNote";
import { card, h2, help, muted, okLine, pillClass, primary, secondary, type Failed } from "../cc/kit";
import { makeT, type Words } from "../words";
import { ACTIVE, exportStateWord, POLL_GIVE_UP_MS, POLL_MS, privacySentence } from "./privacy-model";
import type { PrivacyActions } from "./types";

/**
 * Settings > Privacy > "Download my data" (job CC, screen 2). The person asks for a file of what the system holds about them (the Owner can also ask for the whole workspace's data, which needs the second factor). The file
 * is made in the background: this part looks again every few seconds while it is being made (and stops after five minutes, or when the person leaves), then offers "Download". The link the API gives works for five minutes and
 * is opened at once; it is not shown, copied or kept. The file itself is removed after 24 hours.
 */
export function ExportMyData({ words, actions, initial, isOwner }: { words: Words; actions: Pick<PrivacyActions, "requestExport" | "getExport" | "openLink">; initial: DataExport[]; isOwner: boolean }) {
  const t = makeT(words);
  const id = useId();
  const [items, setItems] = useState<DataExport[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const alive = useRef(true);
  const started = useRef<Record<string, number>>({});

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // look again at every export that is being made
  const active = items.filter((x) => (ACTIVE as readonly string[]).includes(x.status)).map((x) => x.id);
  const key = active.join(",");
  useEffect(() => {
    if (active.length === 0) return;
    const timer = setInterval(async () => {
      for (const exportId of active) {
        started.current[exportId] ??= Date.now();
        if (Date.now() - started.current[exportId] > POLL_GIVE_UP_MS) continue;
        const r = await actions.getExport(exportId);
        if (!alive.current) return;
        if (r.ok) setItems((list) => list.map((x) => (x.id === exportId ? r.data : x)));
      }
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function ask(scope: "person" | "workspace") {
    setBusy(scope);
    setFailure(null);
    const r = await actions.requestExport(scope, crypto.randomUUID());
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setItems((list) => [r.data, ...list.filter((x) => x.id !== r.data.id)]);
  }
  async function download(exportId: string) {
    setBusy(exportId);
    setFailure(null);
    const r = await actions.openLink(exportId);
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setOpened(exportId);
    window.location.assign(r.data.url);
  }

  const making = active.length > 0;
  return (
    <section className={card} aria-labelledby={`${id}-h`} data-privacy="export">
      <h2 id={`${id}-h`} className={h2}>
        {t("prx.exp.title")}
      </h2>
      <p className="text-base text-muted">{t("prx.exp.intro")}</p>
      <p className={help}>{t("prx.exp.keep")}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => ask("person")} disabled={busy !== null || making} className={primary}>
          {busy === "person" ? t("dta.btn.working") : t("prx.exp.ask")}
        </button>
        {isOwner ? (
          <button type="button" onClick={() => ask("workspace")} disabled={busy !== null || making} className={secondary}>
            {busy === "workspace" ? t("dta.btn.working") : t("prx.exp.ask_workspace")}
          </button>
        ) : null}
      </div>
      {isOwner ? <p className={help}>{t("prx.exp.workspace_note")}</p> : null}
      <FailureNote failure={failure} words={words} own={(code) => privacySentence(code, t)} />
      {making ? (
        <p role="status" className={muted}>
          {t("prx.exp.making")}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-base text-muted">{t("prx.exp.none")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {items.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-base font-semibold">{x.scope === "workspace" ? t("prx.exp.scope.workspace") : t("prx.exp.scope.person")}</p>
                <p className="text-sm text-muted">
                  <LocalTime iso={x.requested_at} />
                  {x.size_bytes ? ` · ${Math.max(1, Math.round(x.size_bytes / 1000))} KB` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={pillClass(x.status === "ready" ? "green" : x.status === "failed" || x.status === "expired" ? "amber" : "neutral")}>{exportStateWord(x.status, x.error_code, t)}</span>
                {x.status === "ready" ? (
                  <button type="button" onClick={() => download(x.id)} disabled={busy !== null} className={secondary}>
                    {busy === x.id ? t("dta.btn.working") : t("prx.exp.download")}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {opened ? (
        <p role="status" className={okLine}>
          {t("prx.exp.opened")}
        </p>
      ) : null}
    </section>
  );
}
