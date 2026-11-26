"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { LocalTime } from "@/app/app/local-time";
import type { Member, NewInvitation } from "@/lib/api/team";

import { cardBox } from "../../Card";
import { FailureNote } from "../../cc/FailureNote";
import { card, h2, help, okLine, primary, quiet, secondary, danger, type Failed } from "../../cc/kit";
import { Choose } from "../../jobs/rules/parts";
import { PersonMark } from "../../mark/PersonMark";
import { InviteResult } from "../../team/InviteForm";
import { DAYS, REASONS, canRemove, changeableTo, invitableRoles, labelProblem, teamSentence } from "../../team/team-model";
import type { TeamActions } from "../../team/team-types";
import { makeT, type Words } from "../../words";
import { SelectField, TextField } from "./fields";
import { EffectBox, PillText, Sentence, Val } from "./parts";

/**
 * Team under JOBS (the simplicity pass): each person is ONE sentence with the choice inside ("Ramesh can [work with customers]. [Remove]"), the pending change said in a "What it will do:" line, and the same two actions as the old card (change the role, remove with a reason, or leave).
 * Nothing is lost: who may change whom (`changeableTo`), who may remove (`canRemove`), the second step, the sentence of every refusal and what is tidied when someone goes are the old card's.
 */
export function TeamMembersSimple({ words, members, myRole, actions, plain = false }: { words: Words; members: Member[]; myRole: string; actions: Pick<TeamActions, "changeRole" | "remove">; /** SETTINGS_OPEN: plain rows (name, a grey line, a role field), no sentences. */ plain?: boolean }) {
  const t = makeT(words);
  const router = useRouter();
  const id = useId();
  const [list, setList] = useState(members);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <section className={plain ? `${cardBox} flex flex-col gap-4` : card} aria-labelledby={`${id}-h`} data-team="members" data-simple="">
      <h2 id={`${id}-h`} className={h2}>
        {t("team.members.title")}
      </h2>
      <p className="m-0 text-[14px] text-muted">{t("jobs.set.team.help")}</p>
      {message ? (
        <p role="status" className={okLine}>
          {message}
        </p>
      ) : null}
      {list.length === 0 ? (
        <p className="text-base text-muted">{t("team.members.none")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {list.map((m) => (
            <MemberLine
              key={m.user_id}
              words={words}
              plain={plain}
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

function MemberLine({ words, member, myRole, actions, onRole, onGone, plain = false }: { plain?: boolean; words: Words; member: Member; myRole: string; actions: Pick<TeamActions, "changeRole" | "remove">; onRole: (role: Member["role"]) => void; onGone: (counts: { leads: number; opps: number; runs: number }) => void }) {
  const t = makeT(words);
  const roles = changeableTo(myRole, member);
  const removable = canRemove(myRole, member);
  const [role, setRole] = useState<string>(roles.includes(member.role as never) ? member.role : (roles[0] ?? member.role));
  const [panel, setPanel] = useState<"none" | "remove">("none");
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [busy, setBusy] = useState<"role" | "remove" | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const name = member.display_name ?? t("team.member.unnamed");
  const roleText = (r: string) => (r === "owner" ? t("team.role.owner") : t(`jobs.set.team.role.${r}`));

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
  const who = <b className="font-semibold">{name}</b>;
  const pill = roles.length > 0 ? <Choose aria={`${name}: ${t("team.role.label")}`} value={role} options={roles} text={roleText} disabled={busy !== null} onChange={setRole} /> : <Val>{roleText(member.role)}</Val>;

  return (
    <li className="flex flex-col gap-2 py-3" data-member={member.role}>
      <div className="flex items-start gap-3">
        <PersonMark userId={member.user_id} name={name} className="mt-0.5 size-10" />
        <div className="min-w-0 flex-1">
          {plain ? (
            <>
              <p data-setting-line="member" className="m-0 text-[17px] font-semibold text-ink">
                {name}
                {member.is_you ? <span className="font-normal text-muted"> · {t("set.f.you")}</span> : null}
              </p>
              {roles.length > 0 ? (
                <div className="mt-1.5 max-w-xs">
                  <SelectField label={`${name}: ${t("team.role.label")}`} value={role} options={roles.map((r) => ({ value: r, label: roleText(r) }))} onChange={setRole} disabled={busy !== null} />
                </div>
              ) : (
                <p className="m-0 text-[15px] text-muted">{roleText(member.role)}</p>
              )}
            </>
          ) : member.role === "owner" ? (
            member.is_you ? (
              <p data-setting-line="member" className="m-0 text-[16px] leading-[2.3] text-ink">{t("jobs.set.team.line.you_owner")}</p>
            ) : (
              <Sentence line="member" template={t("jobs.set.team.line.owner")} parts={{ name: () => who }} />
            )
          ) : member.is_you ? (
            <Sentence line="member" template={t("jobs.set.team.line.you_can")} parts={{ role: () => pill }} />
          ) : (
            <Sentence line="member" template={t("jobs.set.team.line.can")} parts={{ name: () => who, role: () => pill }} />
          )}
          <p className="m-0 text-sm text-muted">{member.joined_at ? <>{t("team.joined")} <LocalTime iso={member.joined_at} /></> : null}</p>
        </div>
      </div>
      {role !== member.role && roles.length > 0 ? (
        <div className="flex flex-col gap-2 pl-0 sm:pl-[52px]">
          {plain ? <p className="m-0 text-[14px] text-muted">{t("jobs.set.team.fx.change", { name, can: t(`jobs.set.team.can.${role}`) })}</p> : <EffectBox label={t("jobs.set.effect")} text={t("jobs.set.team.fx.change", { name, can: t(`jobs.set.team.can.${role}`) })} />}
          <div>
            <button type="button" onClick={saveRole} disabled={busy !== null} className={`${secondary} jb-press`}>
              {busy === "role" ? t("dta.btn.working") : t("team.role.save")}
            </button>
          </div>
        </div>
      ) : null}
      {removable && panel === "none" ? (
        <div className="pl-0 sm:pl-[52px]">
          <button type="button" onClick={() => setPanel("remove")} className={quiet}>
            {member.is_you ? t("team.leave") : t("team.remove")}
          </button>
        </div>
      ) : null}
      {panel === "remove" ? (
        <div className="flex flex-col gap-3 rounded-xl border border-red-text bg-red-bg p-4">
          <p className="m-0 text-base font-medium text-red-text">{member.is_you ? t("team.leave.sure") : t("team.remove.sure", { name })}</p>
          {member.is_you ? null : (
            <p className="m-0 text-[16px] leading-[2.3] text-ink" data-setting-line="reason">
              {t("team.reason.label")} <Choose aria={t("team.reason.label")} value={reason} options={REASONS} text={(r) => t(`team.reason.${r}`)} onChange={setReason} />
            </p>
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

/** Invite a person under JOBS: "Invite someone as [Sales]. The code works for [7 days]. I will remember it as [label]." and what the code will do; the same action, the same code shown once (`InviteResult`). */
export function InviteSimple({ words, myRole, workspaceName, actions, plain = false }: { words: Words; myRole: string; workspaceName: string; actions: Pick<TeamActions, "invite">; /** SETTINGS_OPEN: plain labelled fields (Their job, Code works for, a note), no sentences. */ plain?: boolean }) {
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
  if (roles.length === 0) return null;

  async function make() {
    if (labelProblem(label)) {
      setLabelBad(true);
      return;
    }
    setLabelBad(false);
    setBusy(true);
    setFailure(null);
    const r = await actions.invite(crypto.randomUUID(), role, days, label);
    setBusy(false);
    if (!r.ok) return setFailure(r);
    setFresh(r.data);
    setLabel("");
  }
  return (
    <section className={plain ? `${cardBox} flex flex-col gap-4` : card} aria-labelledby={`${id}-h`} data-team="invite" data-simple="">
      <h2 id={`${id}-h`} className={h2}>
        {t("team.invite.title")}
      </h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
      >
        {plain ? (
          <>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <SelectField label={t("set.f.job")} value={role} options={roles.map((r) => ({ value: r, label: t(`team.role.${r}`) }))} onChange={setRole} />
              <SelectField label={t("set.f.days")} value={String(days)} options={DAYS.map((d) => ({ value: String(d), label: t("team.invite.days_n", { n: d }) }))} onChange={(v) => setDays(Number(v))} />
            </div>
            <TextField label={t("set.f.note")} hint={t("team.invite.label_help")} value={label} onChange={setLabel} maxLength={60} />
            {labelBad ? (
              <p role="alert" className="m-0 text-sm font-medium text-red-text">
                {t("team.invite.label_bad")}
              </p>
            ) : null}
            <p className={help}>{t("jobs.set.inv.fx", { n: days, can: t(`jobs.set.team.can.${role}`) })}</p>
          </>
        ) : (
          <>
        <Sentence line="invite-role" template={t("jobs.set.inv.line.role")} parts={{ role: (aria) => <Choose aria={aria} value={role} options={roles} text={(r) => t(`team.role.${r}`)} onChange={setRole} /> }} />
        <Sentence line="invite-days" template={t("jobs.set.inv.line.days")} parts={{ days: (aria) => <Choose aria={aria} value={String(days)} options={DAYS.map(String)} text={(d) => t("team.invite.days_n", { n: d })} onChange={(d) => setDays(Number(d))} /> }} />
        <Sentence line="invite-label" template={t("jobs.set.inv.line.label")} parts={{ label: (aria) => <PillText aria={aria} value={label} onChange={setLabel} placeholder={t("jobs.set.inv.ph.label")} maxLength={60} /> }} />
        <p className={help}>{t("team.invite.label_help")}</p>
        {labelBad ? (
          <p role="alert" className="m-0 text-sm font-medium text-red-text">
            {t("team.invite.label_bad")}
          </p>
        ) : null}
        <EffectBox label={t("jobs.set.effect")} text={t("jobs.set.inv.fx", { n: days, can: t(`jobs.set.team.can.${role}`) })} />
          </>
        )}
        <p className={help}>{t("team.invite.mfa")}</p>
        <FailureNote failure={failure} words={words} own={(code) => teamSentence(code, t)} />
        <div>
          <button type="submit" disabled={busy} className={`${primary} jb-press`}>
            {busy ? t("dta.btn.working") : t("team.invite.make")}
          </button>
        </div>
      </form>
      {fresh ? <InviteResult key={fresh.id} words={words} fresh={fresh} workspaceName={workspaceName} /> : null}
    </section>
  );
}
