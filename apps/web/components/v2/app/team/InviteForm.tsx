"use client";

import { useId, useState } from "react";

import type { NewInvitation } from "@/lib/api/team";

import { FailureNote } from "../cc/FailureNote";
import { card, field, h2, h3, help, label as labelClass, monoBox, okLine, primary, secondary, selectClass, type Failed } from "../cc/kit";
import { makeT, type Words } from "../words";
import { DAYS, invitableRoles, labelProblem, mailShare, roleWord, shareText, teamSentence, whatsappShare } from "./team-model";
import type { TeamActions } from "./team-types";

/**
 * Invite a person (job CC, screen 4): a role (an Admin may invite Sales and Viewer only; nobody invites an Owner), how many days the code lasts, and a short label ("for the new cutter": no phone number or address). The
 * code is shown ONCE, with a copy button and two ways to pass it on by hand (WhatsApp, e-mail): nothing is sent from here. The join address carries the code after a "#", which a browser does not send to any server.
 * A code lost is a code revoked and made again. The second factor is needed (the API says so and the page says how).
 */
export function InviteForm({ words, myRole, workspaceName, actions }: { words: Words; myRole: string; workspaceName: string; actions: Pick<TeamActions, "invite"> }) {
  const t = makeT(words);
  const id = useId();
  const roles = invitableRoles(myRole);
  const [role, setRole] = useState<string>(roles[roles.length - 2] ?? roles[0] ?? "sales");
  const [days, setDays] = useState<number>(7);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [labelBad, setLabelBad] = useState(false);
  const [fresh, setFresh] = useState<NewInvitation | null>(null);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  if (roles.length === 0) return null;

  async function make() {
    if (labelProblem(label)) {
      setLabelBad(true);
      return;
    }
    setLabelBad(false);
    setBusy(true);
    setFailure(null);
    setCopied(null);
    const r = await actions.invite(crypto.randomUUID(), role, days, label);
    setBusy(false);
    if (!r.ok) return setFailure(r);
    setFresh(r.data);
    setLabel("");
  }
  const url = fresh?.code ? `${window.location.origin}/app/join#code=${fresh.code}` : "";
  const text = fresh?.code ? shareText(t, workspaceName, url, fresh.code) : "";

  return (
    <section className={card} aria-labelledby={`${id}-h`} data-team="invite">
      <h2 id={`${id}-h`} className={h2}>
        {t("team.invite.title")}
      </h2>
      <p className="text-base text-muted">{t("team.invite.intro")}</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-role`} className={labelClass}>
              {t("team.role.label")}
            </label>
            <select id={`${id}-role`} value={role} onChange={(e) => setRole(e.target.value)} className={selectClass}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {roleWord(r, t)}
                </option>
              ))}
            </select>
            <p className={help}>{t(`team.role.help.${role}`)}</p>
          </div>
          <div>
            <label htmlFor={`${id}-days`} className={labelClass}>
              {t("team.invite.days")}
            </label>
            <select id={`${id}-days`} value={days} onChange={(e) => setDays(Number(e.target.value))} className={selectClass}>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {t("team.invite.days_n", { n: d })}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-label`} className={labelClass}>
            {t("team.invite.label")}
          </label>
          <input id={`${id}-label`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} autoComplete="off" className={field} />
          <p className={help}>{t("team.invite.label_help")}</p>
          {labelBad ? (
            <p role="alert" className="mt-1 text-sm font-medium text-red-text">
              {t("team.invite.label_bad")}
            </p>
          ) : null}
        </div>
        <p className={help}>{t("team.invite.mfa")}</p>
        <FailureNote failure={failure} words={words} own={(code) => teamSentence(code, t)} />
        <div>
          <button type="submit" disabled={busy} className={primary}>
            {busy ? t("dta.btn.working") : t("team.invite.make")}
          </button>
        </div>
      </form>

      {fresh ? (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-text bg-amber-bg p-4" data-invite-result="">
          <h3 className={h3}>{t("team.invite.code_title")}</h3>
          {fresh.code ? (
            <>
              <p className="text-base font-medium text-amber-text">{t("team.invite.code_once", { days: Math.max(1, Math.round((Date.parse(fresh.expires_at) - Date.parse(fresh.created_at)) / 86_400_000)) })}</p>
              <p className={monoBox} data-invite-code="">
                {fresh.code}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className={secondary}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(fresh.code ?? "");
                      setCopied("yes");
                    } catch {
                      setCopied("no");
                    }
                  }}
                >
                  {copied === "yes" ? t("dta.btn.copied") : t("team.invite.copy")}
                </button>
                <a href={whatsappShare(text)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-4 text-base font-semibold text-ink hover:bg-surface-2">
                  {t("team.invite.whatsapp")}
                </a>
                <a href={mailShare(t("team.share.subject", { shop: workspaceName }), text)} className="inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-4 text-base font-semibold text-ink hover:bg-surface-2">
                  {t("team.invite.email")}
                </a>
              </div>
              {copied === "yes" ? (
                <p role="status" className={okLine}>
                  {t("dta.btn.copied")}
                </p>
              ) : null}
              {copied === "no" ? (
                <p role="alert" className="text-sm font-medium text-red-text">
                  {t("dta.cal.copy_failed")}
                </p>
              ) : null}
              <p className={help}>{t("team.invite.join_at")}</p>
              <p className={monoBox}>{url}</p>
              <p className={help}>{t("team.invite.nothing_sent")}</p>
            </>
          ) : (
            <p className="text-base font-medium text-amber-text">{t("team.invite.replayed")}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
