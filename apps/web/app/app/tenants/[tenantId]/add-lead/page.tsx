import { notFound } from "next/navigation";

import { LazyImportScreen } from "@/components/v2/app/lead-desk/LazyImportScreen";
import { PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { importMode } from "@/lib/lead-desk/imports/source";

import { createSheetLinkAction, importLeadsAction, previewLeadsAction, readLeadsAction, sheetLinkAction } from "../import-actions";
import { leadDeskContext } from "../lead-desk-prelude";

export const metadata = { title: `Add a lead · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/add-lead (owner, 9 Nov 2026): the quick way to add ONE lead, from Customers and from ⌘K. A phone number (and, if the Owner likes, a name and a one-line note), then the very same steps as Add leads: read,
 * the consent confirmation (Owner and Admin; a Sales member's lead is stored and nothing is sent to it), what will happen, add. No API of its own: the one lead goes as a file of one line through the same read, preview and import.
 * Owner, Admin and Sales; a Viewer gets "not found". Behind LEADS_SCREENS like Add leads.
 */
export default async function AddLeadRoute({ params }: PageProps<"/app/tenants/[tenantId]/add-lead">) {
  const { tenantId } = await params;
  const got = await leadDeskContext(tenantId, ["owner", "admin", "sales"]);
  if (!got.ok) return got.page;
  const { role } = got.ctx;
  if (role !== "owner" && role !== "admin" && role !== "sales") notFound();
  const lang = await getLang();
  const words = wordsFor(lang, ["li."]);
  const base = `/app/tenants/${tenantId}`;
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["li.one.title"] ?? "Add a lead"} sub={words["li.one.sub"]} />
      <LazyImportScreen
        one
        words={words}
        base={base}
        role={role}
        test={importMode() === "mock"}
        fileEndpoint={`${base}/import/send`}
        sheets={null}
        actions={{
          read: readLeadsAction.bind(null, tenantId),
          preview: previewLeadsAction.bind(null, tenantId),
          import: importLeadsAction.bind(null, tenantId),
          createLink: createSheetLinkAction.bind(null, tenantId),
          linkAct: sheetLinkAction.bind(null, tenantId),
        }}
      />
    </main>
  );
}
