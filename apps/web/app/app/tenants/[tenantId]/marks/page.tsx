import { notFound } from "next/navigation";

import { MarksSend } from "@/components/v2/app/education/MarksSend";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { getLang } from "@/i18n/get-lang";
import { readLog } from "@/lib/marks/source";
import { marksScreens } from "@/lib/screens/flag";

import { eduContext, eduWords } from "../education-kit";

export const metadata = { title: `Send marks to parents · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/marks: a school sends marks, or "the report card is ready", to parents (job DP; module `programmes`; C1's contract-marks-messages.md). OWNER DECISION: the platform never stores a child's marks: the file
 * is read for the preview and again for the send, and is gone; only a log of who was sent which message stays. Owner and Admin open it (Sales and Viewer get "not found"); only the Owner sends. Behind MARKS_SCREENS.
 */
export default async function MarksRoute({ params }: PageProps<"/app/tenants/[tenantId]/marks">) {
  const { tenantId } = await params;
  const mode = marksScreens();
  if (mode === "off") notFound();
  const got = await eduContext(tenantId);
  if (!got.ok) return got.page;
  const { accessToken, tenant } = got.ctx;
  if (tenant.role !== "owner" && tenant.role !== "admin") notFound();
  const lang = await getLang();
  const base = `/app/tenants/${tenantId}`;
  const log = await readLog({ token: accessToken, tenantId });
  return (
    <main className={pageMain} lang={lang}>
      <MarksSend base={base} words={eduWords(lang)} canSend={tenant.role === "owner"} mock={mode === "mock"} log={log} />
    </main>
  );
}
