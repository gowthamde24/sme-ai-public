import { clockTime } from "@/lib/staff/format";

import { StaffSearch } from "./StaffSearch";

/** The title row: the page's name, the environment label ("Staging · test data"; nothing in production, where the API sends none), when the figures were read (India time) and the Cmd+K search. */
export function Topbar({ title, envLabel, generatedAt }: { title: string; envLabel: string; generatedAt: string }) {
  return (
    <div className="sc-top">
      <h1>{title}</h1>
      {envLabel ? <span className="sc-env">{envLabel}</span> : null}
      <span className="sc-asof">Updated {clockTime(generatedAt)} IST</span>
      <StaffSearch />
    </div>
  );
}
