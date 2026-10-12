"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { LocalTime } from "@/app/app/local-time";
import type { Member } from "@/lib/api/team";

import { FailureNote } from "../cc/FailureNote";
import { card, danger, h2, help, label as labelClass, okLine, pillClass, primary, quiet, secondary, selectClass, type Failed } from "../cc/kit";
import { OwlSvg } from "../owl/OwlSvg";
import { makeT, type Words } from "../words";
import { canRemove, changeableTo, owlOf, REASONS, roleWord, teamSentence } from "./team-model";
import type { TeamActions } from "./team-types";

/**
 * The people in the business (job CC, screen 4): each with their own owl, their role in words, "you" on one's own row and, for the Owner and Admin, what they may do about that person: change the role, or remove them (with a
 * reason from a short list). Anyone but an Owner can leave. Changing and removing need the second factor (the API says so, and the page says how to give it). What is tidied when someone goes is said in counts. Owners are
 * added by the operator, not here.
 */
export function TeamMembers({ words, members, myRole, actions }: { words: Words; members: Member[]; myRole: string; actions: Pick<TeamActions, "changeRole" | "remove"> }) {
  const t = makeT(words);
  const router = useRouter();
  const id = useId();
  const [list, setList] = useState(members);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <section className={card} aria-labelledby={`${id}-h`} data-team="members">
      <h2 id={`${id}-h`} className={h2}>
        {t("team.members.title")}
      </h2>
      {message ? (
        <p role="status" className={okLine}>
          {message}
        </p>
      ) : null}
      {list.length === 0 ? (
        <p className="text-base text-muted">{t("team.members.none")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {list.map((m) => (
            <MemberRow
              key={m.user_id}
              words={words}
              member={m}
              myRole={myRole}
              actions={actions}
              onRole={(role) => {
                setList((l) => l.map((x) => (x.user_id === m.user_id ? { ...x, role } : x)));
                setMessage(t("team.role.changed"));
              }}
              onGone={(counts) => {
                setList((l) => l.filter((x) => x.user_id !== m.user_id));
                setMessage(m.is_you ? t("team.left") : t("team.removed", { leads: counts.leads, opps: counts.opps, runs: counts.runs }));
                if (m.is_you) router.push("/app");
              }}
            />
          ))}
        </ul>
      )}
      <p className={help}>{t("team.owners_note")}</p>
    </section>
  );
}

function MemberRow({ words, member, myRole, actions, onRole, onGone }: { words: Words; member: Member; myRole: string; actions: Pick<TeamActions, "changeRole" | "remove">; onRole: (role: Member["role"]) => void; onGone: (counts: { leads: number; opps: number; runs: number }) => void }) {
  const t = makeT(words);
  const id = useId();
  const roles = changeableTo(myRole, member);
  const removable = canRemove(myRole, member);
  const [role, setRole] = useState<string>(roles.includes(member.role as never) ? member.role : (roles[0] ?? member.role));
  const [panel, setPanel] = useState<"none" | "remove">("none");
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [busy, setBusy] = useState<"role" | "remove" | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const name = member.display_name ?? t("team.member.unnamed");

  async function saveRole() {
    setBusy("role");
    setFailure(null);
    const r = await actions.changeRole(member.user_id, role);
    setBusy(null);
    if (!r.ok) return setFailure(r);
    onRole(r.data.role);
  }
  async function remove() {
    setBusy("remove");
    setFailure(null);
    const r = await actions.remove(member.user_id, member.is_you ? "left" : reason);
    setBusy(null);
    if (!r.ok) return setFailure(r);
    onGone({ leads: r.data.leads_unassigned, opps: r.data.opportunities_unassigned, runs: r.data.runs_cancelled });
  }

  return (
    <li className="flex flex-col gap-3 py-4" data-member={member.role}>
      <div className="flex items-center gap-3">
        <OwlSvg agent={owlOf(member.user_id)} mood="idle" still className="size-12" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">
            {name}
            {member.is_you ? <span className="ml-2 text-sm font-normal text-muted">({t("team.you")})</span> : null}
          </p>
          <p className="text-sm text-muted">{member.joined_at ? <>{t("team.joined")} <LocalTime iso={member.joined_at} /></> : null}</p>
        </div>
        <span className={pillClass(member.role === "owner" ? "brand" : "neutral")}>{roleWord(member.role, t)}</span>
      </div>
      {roles.length > 0 || removable ? (
        <div className="flex flex-wrap items-end gap-3 pl-0 sm:pl-15">
          {roles.length > 0 ? (
            <>
              <div className="min-w-40">
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
              </div>
              <button type="button" onClick={saveRole} disabled={busy !== null || role === member.role} className={secondary}>
                {busy === "role" ? t("dta.btn.working") : t("team.role.save")}
              </button>
            </>
          ) : null}
          {removable && panel === "none" ? (
            <button type="button" onClick={() => setPanel("remove")} className={quiet}>
              {member.is_you ? t("team.leave") : t("team.remove")}
            </button>
          ) : null}
        </div>
      ) : null}
      {panel === "remove" ? (
        <div className="flex flex-col gap-3 rounded-xl border border-red-text bg-red-bg p-4">
          <p className="text-base font-medium text-red-text">{member.is_you ? t("team.leave.sure") : t("team.remove.sure", { name })}</p>
          {member.is_you ? null : (
            <div>
              <label htmlFor={`${id}-reason`} className={labelClass}>
                {t("team.reason.label")}
              </label>
              <select id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} className={selectClass}>
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`team.reason.${r}`)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className={help}>{t("team.remove.tidy")}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={remove} disabled={busy !== null} className={danger}>
              {busy === "remove" ? t("dta.btn.working") : member.is_you ? t("team.leave.yes") : t("team.remove.yes")}
            </button>
            <button type="button" onClick={() => setPanel("none")} disabled={busy !== null} className={primary}>
              {t("team.keep")}
            </button>
          </div>
        </div>
      ) : null}
      <FailureNote failure={failure} words={words} own={(code) => teamSentence(code, t)} />
    </li>
  );
}
