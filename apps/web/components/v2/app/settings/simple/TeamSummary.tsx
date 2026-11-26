import type { ReactNode } from "react";

import type { Say } from "../../words";

type Person = { name: string | null; role: string; you: boolean };

const pill = (text: string): ReactNode => <b className="mx-0.5 inline-block rounded-md bg-brand-bg px-3 py-0.5 align-middle text-[15px] font-semibold leading-snug text-brand-text">{text}</b>;

/** The Team card of the Settings page under JOBS: who is on the team as plain sentences ("Ravi can run the business and the team."), read only. Adding and changing people is on the Team page. Drawn on the server (no script). */
export function TeamSummary({ t, people }: { t: Say; people: readonly Person[] }) {
  const line = (p: Person): ReactNode => {
    const name = p.name ?? t("jobs.set.team.unnamed");
    if (p.role === "owner") return p.you ? t("jobs.set.team.line.you_owner") : t("jobs.set.team.line.owner", { name });
    const role = t(`jobs.set.team.role.${p.role}`);
    const tpl = t(p.you ? "jobs.set.team.line.you_can" : "jobs.set.team.line.can", { name, role: "\u0000" });
    const [a, b] = tpl.split("\u0000");
    return (
      <>
        {a}
        {pill(role)}
        {b}
      </>
    );
  };
  return (
    <ul className="m-0 flex list-none flex-col p-0" data-part="team-sentences">
      {people.slice(0, 6).map((p, i) => (
        <li key={i} data-setting-line="member" className="m-0 py-0.5 text-[16px] leading-[2.1] text-ink">
          {line(p)}
        </li>
      ))}
    </ul>
  );
}
