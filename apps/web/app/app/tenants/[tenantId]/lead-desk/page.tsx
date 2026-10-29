import Link from "next/link";

import { AssignSelect } from "@/components/v2/app/lead-desk/AssignSelect";
import { ProfileLine } from "@/components/v2/app/lead-desk/ProfileLine";
import { PageTop } from "@/components/v2/app/parts";
import { btnMain, btnQuiet, fieldInput, fieldLabel, leadRow, mutedText, pageMain, pillAmber, pillBrand, pillGreen, pillNeutral, surface } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { fetchMembers } from "@/lib/api/orders";
import { applyFilter, filterHref, LEAD_STATUSES, NO_FILTER, parseFilter } from "@/lib/lead-desk/leads";
import { URGENCIES } from "@/lib/lead-desk/profile";
import { readDeskLeads } from "@/lib/lead-desk/leads-source";
import { readHandoffs } from "@/lib/outreach/source";
import { sourceNames } from "@/lib/outreach/words";
import { leadsScreens, outreachScreens } from "@/lib/screens/flag";
import { SOURCE_TAGS } from "@/lib/outreach/types";

import { leadContext } from "../lead-context";
import { assignLeadAction } from "../lead-desk-actions";

export const metadata = { title: `Lead Desk · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const statusPill = (s: string) => (s === "qualified" ? pillGreen : s === "contacted" ? pillBrand : s === "disqualified" ? pillNeutral : pillAmber);

/**
 * /app/tenants/[tenantId]/lead-desk (night 4, part A6; a tab of Customers): the leads that arrive, with where each came from, its state, who it is handed to and a HOT badge (somebody showed interest and nobody has called back). Filter by
 * source, state, "mine" and "hot". Everybody in the workspace reads it (a Viewer too); the Owner and Admin hand leads to a team member. The name opens the lead (its history, calls and WhatsApp).
 */
export default async function LeadDeskPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/lead-desk">) {
  const { tenantId } = await params;
  const query = await searchParams;
  const got = await leadContext(tenantId, { roles: ["owner", "admin", "sales", "viewer"], on: leadsScreens() !== "off" });
  if (!got.ok) return got.page;
  const { accessToken, userId, tenant } = got.ctx;
  const lang = await getLang();
  const words = wordsFor(lang, ["ld.desk.", "ld.source.", "ld.status.", "ol.hot.", "lp."]);
  const base = `/app/tenants/${tenantId}`;
  const filter = parseFilter(query);
  const cursor = Array.isArray(query.after) ? query.after[0] : query.after;
  const after = typeof cursor === "string" && cursor.length > 0 && cursor.length <= 300 ? cursor : null; // the API checks it
  const ctx = { token: accessToken, tenantId, userId };
  const canSeeHot = tenant.role !== "viewer" && outreachScreens() !== "off";
  const handoffs = canSeeHot ? await readHandoffs(ctx, true) : null;
  const [page, members] = await Promise.all([readDeskLeads(ctx, handoffs, after, new Date(), filter), fetchMembers(accessToken, tenantId).catch(() => [])]);
  const sn = sourceNames(words);
  const team = members.map((m) => ({ id: m.user_id, name: m.display_name ?? words["ld.desk.member"] ?? "Member" }));
  const shown = page ? applyFilter(page.leads, filter, userId) : [];
  const decider = tenant.role === "owner" || tenant.role === "admin";
  const date = (iso: string) => (iso ? new Date(iso).toLocaleDateString(lang, { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) : "");
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["ld.desk.title"] ?? "Lead Desk"} sub={words["ld.desk.sub"] ?? ""} />
      {leadsScreens() === "mock" ? (
        <p role="note" className="mt-3 text-sm text-muted">
          {words["ld.desk.mock"]}
        </p>
      ) : null}
      {decider ? (
        <p className="mt-3">
          <Link href={`${base}/lead-setup`} className="font-semibold text-brand-text underline">
            {words["ld.desk.setup"]}
          </Link>
        </p>
      ) : null}
      <form method="get" action={`${base}/lead-desk`} className={`${surface} mt-4 flex flex-wrap items-end gap-3`}>
        <div className="min-w-40 flex-1">
          <label htmlFor="ldf-source" className={fieldLabel}>
            {words["ld.desk.f.source"]}
          </label>
          <select id="ldf-source" name="source" className={fieldInput} defaultValue={filter.source ?? ""}>
            <option value="">{words["ld.desk.f.any"]}</option>
            {SOURCE_TAGS.map((s) => (
              <option key={s} value={s}>
                {sn[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-40 flex-1">
          <label htmlFor="ldf-status" className={fieldLabel}>
            {words["ld.desk.f.status"]}
          </label>
          <select id="ldf-status" name="status" className={fieldInput} defaultValue={filter.status ?? ""}>
            <option value="">{words["ld.desk.f.any"]}</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {words[`ld.status.${s}`]}
              </option>
            ))}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" name="mine" value="1" defaultChecked={filter.mine} className="size-6 accent-brand-text" />
          {words["ld.desk.f.mine"]}
        </label>
        {canSeeHot ? (
          <label className="flex min-h-11 items-center gap-2 text-base">
            <input type="checkbox" name="hot" value="1" defaultChecked={filter.hot} className="size-6 accent-brand-text" />
            {words["ld.desk.f.hot"]}
          </label>
        ) : null}
        <div className="min-w-40 flex-1">
          <label htmlFor="ldf-urgency" className={fieldLabel}>
            {words["lp.f.urgency"]}
          </label>
          <select id="ldf-urgency" name="urgency" className={fieldInput} defaultValue={filter.urgency ?? ""}>
            <option value="">{words["ld.desk.f.any"]}</option>
            {URGENCIES.map((u) => (
              <option key={u} value={u}>
                {words[`lp.urgency.${u}`]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-40 flex-1">
          <label htmlFor="ldf-q" className={fieldLabel}>
            {words["lp.f.q"]}
          </label>
          <input id="ldf-q" name="q" type="search" maxLength={80} defaultValue={filter.q} className={fieldInput} />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" name="junk" value="1" defaultChecked={filter.junk} className="size-6 accent-brand-text" />
          {words["lp.f.junk"]}
        </label>
        <button type="submit" className={btnMain}>
          {words["ld.desk.f.apply"]}
        </button>
        {filter.source || filter.status || filter.mine || filter.hot || filter.urgency || filter.junk || filter.q ? (
          <Link href={filterHref(base, NO_FILTER)} className={btnQuiet}>
            {words["ld.desk.f.clear"]}
          </Link>
        ) : null}
      </form>

      {page === null ? (
        <p className={mutedText}>{words["ld.desk.na"]}</p>
      ) : shown.length === 0 ? (
        <p className={mutedText}>{words[page.leads.length === 0 ? "ld.desk.none" : "ld.desk.none.filter"]}</p>
      ) : (
        <ul data-part="leads" className="mt-4 flex flex-col gap-3">
          {shown.map((l) => (
            <li key={l.id} data-lead={l.id} className={`${surface} ${leadRow}`}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`${base}/leads/${l.id}`} className="break-words font-display text-lg font-bold text-brand-text hover:underline">
                    {l.name || words["ld.desk.noname"]}
                  </Link>
                  {l.isNew ? <span className={pillBrand}>{words["lp.new"]}</span> : null}
                  {l.hot ? <span className={pillAmber}>{words["ld.desk.hot"]}</span> : null}
                  {l.profile?.junk ? <span className={pillNeutral}>{words[`lp.junk.${l.profile.junk}`]}</span> : null}
                  <span className={statusPill(l.status)}>{words[`ld.status.${l.status}`]}</span>
                </div>
                {l.profile ? <ProfileLine p={l.profile} words={words} /> : null}
                <p className={`${mutedText} !mt-1`}>
                  {l.source ? (sn[l.source] ?? l.source) : words["ld.desk.nosource"]} · {date(l.createdAt)}
                </p>
              </div>
              <div className="flex flex-col gap-1 sm:items-end">
                <span className="text-sm font-semibold text-muted">{words["ld.desk.assigned"]}</span>
                <AssignSelect words={words} leadId={l.id} current={l.ownerUserId} members={team} canEdit={decider} assign={assignLeadAction.bind(null, tenantId)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {page?.nextCursor ? (
        <p className="mt-4">
          <Link href={`${filterHref(base, filter)}${filterHref(base, filter).includes("?") ? "&" : "?"}${new URLSearchParams({ after: page.nextCursor })}`} className={btnQuiet}>
            {words["ld.desk.more"]}
          </Link>
        </p>
      ) : null}
    </main>
  );
}
