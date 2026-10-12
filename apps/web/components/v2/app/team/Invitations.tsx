"use client";

import { useId, useState } from "react";

import { LocalTime } from "@/app/app/local-time";
import type { Invitation } from "@/lib/api/team";

import { FailureNote } from "../cc/FailureNote";
import { card, h2, pillClass, quiet, type Failed } from "../cc/kit";
import { makeT, type Words } from "../words";
import { dataTable, dataTd, dataThCol, dataTr } from "../ui";
import { roleWord, teamSentence } from "./team-model";
import type { TeamActions } from "./team-types";

/** The invitations of the business (job CC, screen 4): who they are for (the label), the role, whether still waiting, when they end. A waiting one can be revoked (second factor). Never a code: it was shown once, when it was made. */
export function Invitations({ words, items, myRole, actions }: { words: Words; items: Invitation[]; myRole: string; actions: Pick<TeamActions, "revoke"> }) {
  const t = makeT(words);
  const id = useId();
  const [list, setList] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);

  async function revoke(invitationId: string) {
    setBusy(invitationId);
    setFailure(null);
    const r = await actions.revoke(invitationId);
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setList((l) => l.map((x) => (x.id === invitationId ? { ...x, status: r.data.status, revoked_at: r.data.revoked_at } : x)));
  }
  const tone = { pending: "amber", accepted: "green", revoked: "neutral", expired: "neutral" } as const;
  // an Admin may revoke only the Sales and Viewer invitations
  const mayRevoke = (i: Invitation) => i.status === "pending" && (myRole === "owner" || (myRole === "admin" && i.role !== "admin"));

  return (
    <section className={card} aria-labelledby={`${id}-h`} data-team="invitations">
      <h2 id={`${id}-h`} className={h2}>
        {t("team.inv.title")}
      </h2>
      {list.length === 0 ? (
        <p className="text-base text-muted">{t("team.inv.none")}</p>
      ) : (
        <table className={dataTable}>
          <thead>
            <tr>
              {["team.inv.col.for", "team.role.label", "team.inv.col.status", "team.inv.col.ends"].map((k) => (
                <th key={k} scope="col" className={dataThCol}>
                  {t(k)}
                </th>
              ))}
              <th scope="col" className={dataThCol}>
                <span className="sr-only">{t("team.inv.col.action")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.id} className={dataTr}>
                <td data-label={t("team.inv.col.for")} className={`${dataTd} break-words`}>
                  {i.label ?? t("team.inv.nolabel")}
                  {i.created_by_name ? <span className="block text-sm text-muted">{t("team.inv.by", { name: i.created_by_name })}</span> : null}
                </td>
                <td data-label={t("team.role.label")} className={dataTd}>
                  {roleWord(i.role, t)}
                </td>
                <td data-label={t("team.inv.col.status")} className={dataTd}>
                  <span className={pillClass(tone[i.status])}>{t(`team.inv.status.${i.status}`)}</span>
                </td>
                <td data-label={t("team.inv.col.ends")} className={dataTd}>
                  <LocalTime iso={i.expires_at} />
                </td>
                <td data-label="" className={dataTd}>
                  {mayRevoke(i) ? (
                    <button type="button" onClick={() => revoke(i.id)} disabled={busy !== null} className={quiet} aria-label={`${t("team.inv.revoke")} ${i.label ?? ""}`.trim()}>
                      {busy === i.id ? t("dta.btn.working") : t("team.inv.revoke")}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <FailureNote failure={failure} words={words} own={(code) => teamSentence(code, t)} />
    </section>
  );
}
