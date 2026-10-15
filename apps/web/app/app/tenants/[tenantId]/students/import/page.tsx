import Link from "next/link";
import { redirect } from "next/navigation";

import { DataImport } from "@/components/v2/app/data/DataImport";
import { backLink, pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";

import { eduContext, eduWords } from "../../education-kit";

export const metadata = { title: "Import students · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/students/import: bring in the students and their parents from a spreadsheet (job CS; Owner and Admin). The same guarded import as Settings > Data: pick the file, say which column is which, see what would happen
 * to every row (a class or section the school does not have is "needs review", never invented), then import with the authenticator code. The preview and the result name the PARENT, never the child. No more than the minimum is read.
 */
export default async function ImportStudentsRoute({ params }: PageProps<"/app/tenants/[tenantId]/students/import">) {
  const { tenantId } = await params;
  const got = await eduContext(tenantId);
  if (!got.ok) return got.page;
  const base = `/app/tenants/${tenantId}`;
  if (got.ctx.tenant.role !== "owner" && got.ctx.tenant.role !== "admin") redirect(`${base}/students`);
  const lang = await getLang();
  const words = eduWords(lang);
  return (
    <main className={pageMain} lang={lang}>
      <p><Link href={`${base}/students`} className={backLink}>{words["edu.back"]}</Link></p>
      <div className="mt-3 flex max-w-3xl flex-col gap-4">
        <DataImport tenantId={tenantId} words={words} kinds={["students"]} />
        <p className="text-sm text-muted">{words["edu.imp.note"]}</p>
      </div>
    </main>
  );
}
