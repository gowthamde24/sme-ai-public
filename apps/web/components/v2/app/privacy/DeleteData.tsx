"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { LocalTime } from "@/app/app/local-time";
import type { Deletion } from "@/lib/api/privacy";

import { FailureNote } from "../cc/FailureNote";
import { card, danger, field, h2, h3, help, label as labelClass, okLine, secondary, type Failed } from "../cc/kit";
import { makeT, type Words } from "../words";
import { confirms, passed, privacySentence } from "./privacy-model";
import type { PrivacyActions } from "./types";

type Which = "account" | "workspace";

/**
 * Settings > Privacy > delete my account, and (the Owner) delete this workspace (job CC, screen 2). Both are typed confirmations: the person's own e-mail address, the workspace's name. Neither happens at once: there are 14 days
 * to change one's mind and a "Cancel" until the day. A workspace is erased only after those days, when the Owner (with the second factor) presses "Delete now" and types the name again. The sentences about what goes and what
 * stays are ours and stay in English until a person reviews them (they are legal statements). A refusal keeps what was typed.
 */
export function DeleteData({ words, actions, email, workspaceName, isOwner, accountDeletion, workspaceDeletion, now }: { words: Words; actions: Pick<PrivacyActions, "requestAccountDeletion" | "cancelAccountDeletion" | "requestWorkspaceDeletion" | "cancelWorkspaceDeletion" | "executeWorkspaceDeletion">; email: string; workspaceName: string; isOwner: boolean; accountDeletion: Deletion | null; workspaceDeletion: Deletion | null; now: number }) {
  const t = makeT(words);
  return (
    <div className="flex flex-col gap-5" data-privacy="delete">
      <DeleteOne which="account" words={words} t={t} actions={actions} expected={email} current={accountDeletion} now={now} />
      {isOwner ? <DeleteOne which="workspace" words={words} t={t} actions={actions} expected={workspaceName} current={workspaceDeletion} now={now} /> : null}
    </div>
  );
}

function DeleteOne({ which, words, t, actions, expected, current, now }: { which: Which; words: Words; t: ReturnType<typeof makeT>; actions: Parameters<typeof DeleteData>[0]["actions"]; expected: string; current: Deletion | null; now: number }) {
  const id = useId();
  const [deletion, setDeletion] = useState<Deletion | null>(current && current.status === "scheduled" ? current : current && current.status === "blocked" ? current : current && current.status === "executed" ? current : null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<"ask" | "cancel" | "run" | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const caseInsensitive = which === "account";
  const matches = confirms(typed, expected, caseInsensitive);

  async function ask() {
    setBusy("ask");
    setFailure(null);
    const r = await (which === "account" ? actions.requestAccountDeletion(crypto.randomUUID(), typed.trim()) : actions.requestWorkspaceDeletion(crypto.randomUUID(), typed.trim()));
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setDeletion(r.data);
    setTyped("");
    setSaid(t(`prx.del.${which}.asked`));
  }
  async function cancel() {
    if (!deletion) return;
    setBusy("cancel");
    setFailure(null);
    const r = await (which === "account" ? actions.cancelAccountDeletion(deletion.id) : actions.cancelWorkspaceDeletion(deletion.id));
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setDeletion(null);
    setSaid(t("prx.del.cancelled"));
  }
  async function run() {
    if (!deletion || which !== "workspace") return;
    setBusy("run");
    setFailure(null);
    const r = await actions.executeWorkspaceDeletion(deletion.id);
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setDeletion(r.data);
    setTyped("");
    setSaid(t("prx.del.workspace.done"));
  }

  const scheduled = deletion?.status === "scheduled" ? deletion : null;
  const due = scheduled ? passed(scheduled.execute_after, now) : false;
  return (
    <section className={card} aria-labelledby={`${id}-h`} data-privacy={`delete-${which}`}>
      <h2 id={`${id}-h`} className={h2}>
        {t(`prx.del.${which}.title`)}
      </h2>
      <p className="text-base">{t(`prx.del.${which}.what`)}</p>
      <p className={help}>{t("prx.del.days")}</p>

      {deletion?.status === "executed" ? (
        <p role="status" className={okLine}>
          {t(`prx.del.${which}.executed`)}
        </p>
      ) : null}
      {deletion?.status === "blocked" ? (
        <p role="alert" className="rounded-lg border border-amber-text bg-amber-bg px-3 py-2 text-base font-medium text-amber-text">
          {deletion.blocked_reason === "sole_owner" ? t("prx.err.sole_owner") : t("prx.del.blocked")}
        </p>
      ) : null}

      {scheduled ? (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-text bg-amber-bg p-4">
          <h3 className={h3}>{t("prx.del.scheduled")}</h3>
          <p className="text-base font-medium text-amber-text">
            {t(`prx.del.${which}.on`)} <LocalTime iso={scheduled.execute_after} />
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={cancel} disabled={busy !== null} className={secondary}>
              {busy === "cancel" ? t("dta.btn.working") : t("prx.del.cancel")}
            </button>
          </div>
          {which === "workspace" ? (
            due ? (
              <div className="flex flex-col gap-2">
                <p className="text-base font-medium">{t("prx.del.workspace.ready")}</p>
                <label htmlFor={`${id}-run`} className={labelClass}>
                  {t("prx.del.workspace.type", { name: expected })}
                </label>
                <input id={`${id}-run`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className={field} />
                <div>
                  <button type="button" onClick={run} disabled={busy !== null || !matches} className={danger}>
                    {busy === "run" ? t("dta.btn.working") : t("prx.del.workspace.now")}
                  </button>
                </div>
                <p className={help}>{t("prx.del.mfa")}</p>
              </div>
            ) : (
              <p className={help}>{t("prx.del.workspace.wait")}</p>
            )
          ) : null}
        </div>
      ) : deletion?.status === "executed" ? null : (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-type`} className={labelClass}>
            {t(`prx.del.${which}.type`, { name: expected })}
          </label>
          <input id={`${id}-type`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className={field} />
          <p className={help}>{t("prx.del.mfa")}</p>
          <div>
            <button type="button" onClick={ask} disabled={busy !== null || !matches} className={danger}>
              {busy === "ask" ? t("dta.btn.working") : t(`prx.del.${which}.button`)}
            </button>
          </div>
        </div>
      )}
      <FailureNote failure={failure} words={words} own={(code) => privacySentence(code, t)} />
      {said ? (
        <p role="status" className={okLine}>
          {said}
        </p>
      ) : null}
      {which === "workspace" ? (
        <p className={help}>
          {t("prx.del.workspace.also")}{" "}
          <Link href="/app" className="font-semibold text-brand-text underline">
            {t("prx.del.workspace.back")}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
