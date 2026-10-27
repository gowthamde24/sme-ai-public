import { escalate } from "@/lib/api/failure";
import { notFound, redirect } from "next/navigation";

import { LazyImportScreen } from "@/components/v2/app/lead-desk/LazyImportScreen";
import { PageTop } from "@/components/v2/app/parts";
import { indiaClock, indiaDay } from "@/components/v2/app/today/time";
import { dataTable, dataTd, dataThCol, dataTr, mutedText, pageH2, pageMain, tableWrap } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { importMode, recentImports, sheetState } from "@/lib/lead-desk/imports/source";

import { createSheetLinkAction, importLeadsAction, previewLeadsAction, readLeadsAction, sheetLinkAction } from "../import-actions";
import { leadDeskContext } from "../lead-desk-prelude";

export const metadata = { title: `Add leads · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/import (night 4, Lead Desk, item 3; a tab of Customers): bring in a list of leads from an Excel or CSV file, a Google Sheet, a pasted list or a contacts file, check the columns, confirm consent and
 * see what will happen before anything is added. Owner, Admin and Sales (a Sales member cannot confirm consent, so nothing is sent to their leads); a Viewer gets "not found". Behind LEADS_SCREENS.
 */
export default async function ImportRoute({ params }: PageProps<"/app/tenants/[tenantId]/import">) {
  const { tenantId } = await params;
  const got = await leadDeskContext(tenantId, ["owner", "admin", "sales"]);
  if (!got.ok) return got.page;
  const { accessToken, role } = got.ctx;
  if (role !== "owner" && role !== "admin" && role !== "sales") notFound();
  const ctx = { token: accessToken, tenantId };
  const canConfirm = role === "owner" || role === "admin";
  let recent, sheets;
  try {
    [recent, sheets] = await Promise.all([recentImports(ctx), canConfirm ? sheetState(ctx) : Promise.resolve(null)]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const lang = await getLang();
  const words = wordsFor(lang, ["li."]);
  const base = `/app/tenants/${tenantId}`;
  const whenOf = (iso: string) => `${indiaDay(iso)} ${indiaClock(iso)}`;
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["li.title"] ?? "Add leads"} sub={words["li.sub"]} />
      <LazyImportScreen
        words={words}
        base={base}
        role={role}
        test={importMode() === "mock"}
        fileEndpoint={`${base}/import/send`}
        sheets={sheets?.mode === "ok" ? { access: sheets.access, links: sheets.links } : null}
        actions={{
          read: readLeadsAction.bind(null, tenantId),
          preview: previewLeadsAction.bind(null, tenantId),
          import: importLeadsAction.bind(null, tenantId),
          createLink: createSheetLinkAction.bind(null, tenantId),
          linkAct: sheetLinkAction.bind(null, tenantId),
        }}
      />
      {sheets && sheets.mode === "unavailable" ? <p className={mutedText}>{words["li.links.unavailable"]}</p> : null}
      <h2 className={pageH2}>{words["li.recent.title"]}</h2>
      {recent.mode === "unavailable" ? (
        <p className={mutedText}>{words["li.recent.unavailable"]}</p>
      ) : recent.mode === "ok" && recent.items.length > 0 ? (
        <div className={tableWrap}>
          <table className={dataTable}>
            <thead>
              <tr>
                {["when", "source", "rows", "added", "dups", "invalid", "by"].map((c) => (
                  <th key={c} scope="col" className={dataThCol}>
                    {words[`li.col.${c}`]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.items.map((i) => (
                <tr key={i.import_id} className={dataTr}>
                  <td className={dataTd} data-label={words["li.col.when"]}>
                    {whenOf(i.created_at)}
                  </td>
                  <td className={dataTd} data-label={words["li.col.source"]}>
                    {words[`li.tag.${i.source}`] ?? i.source}
                  </td>
                  <td className={dataTd} data-label={words["li.col.rows"]}>
                    {i.rows_read}
                  </td>
                  <td className={dataTd} data-label={words["li.col.added"]}>
                    {i.counts.ready}
                  </td>
                  <td className={dataTd} data-label={words["li.col.dups"]}>
                    {i.counts.duplicates_merged + i.counts.duplicates_in_file}
                  </td>
                  <td className={dataTd} data-label={words["li.col.invalid"]}>
                    {i.counts.invalid}
                  </td>
                  <td className={dataTd} data-label={words["li.col.by"]}>
                    {i.by ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={mutedText}>{words["li.recent.empty"]}</p>
      )}
    </main>
  );
}
