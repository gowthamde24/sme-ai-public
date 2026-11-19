import { notFound, redirect } from "next/navigation";

import { DoNotCallList } from "@/components/v2/app/jobs/DoNotCallList";
import { PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { readDnc } from "@/lib/api/do-not-call";
import { requireUser } from "@/lib/auth/session";
import { jobsScreens } from "@/lib/screens/flag";

import { addDncAction, removeDncAction } from "./actions";

export const metadata = { title: `Do-Not-Call list · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined): string | null => (typeof v === "string" && v !== "" ? v : null);

/** /app/tenants/[tenantId]/do-not-call (JOBS, mock 08 part 2): the numbers the assistant never calls or messages. Not there (404) while JOBS is off. Everyone who may open the workspace reads it; the Owner and an Admin add a number; only the Owner removes one. */
export default async function DoNotCallRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/do-not-call">) {
  if (jobsScreens() === "off") notFound();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  const query = await searchParams;
  const user = await requireUser();
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    notFound();
  }
  const lang = await getLang();
  const words = wordsFor(lang, ["jobs.dnc.", "apierr."]);
  const q = (one(query.q) ?? "").slice(0, 40);
  const cursor = one(query.cursor);
  const showLifted = one(query.lifted) === "1";
  const found = await readDnc(user.accessToken, tenantId, { q, cursor: cursor && cursor.length <= 300 ? cursor : null });
  // a lifted number LEAVES the list: the list is only what is on it, and the ones that came off are asked for apart (`?include=lifted`) when the person wants to see them
  const page = found ? { ...found, items: found.items.filter((e) => e.state === "active") } : null;
  const liftedPage = page && showLifted ? await readDnc(user.accessToken, tenantId, { q, includeLifted: true }) : null;
  const lifted = liftedPage ? liftedPage.items.filter((e) => e.state === "lifted") : null;
  const base = `/app/tenants/${tenantId}`;
  const link = (extra: Record<string, string>) => `${base}/do-not-call?${new URLSearchParams({ ...(q ? { q } : {}), ...extra })}`.replace(/\?$/, "");
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["jobs.dnc.title"] ?? "Do-Not-Call list"} />
      {page ? (
        <div className="mt-4">
          <DoNotCallList
            // a new search or page is a new list: the component keeps its own copy while the person adds and removes
            key={`${q}|${cursor ?? ""}`}
            page={page}
            q={q}
            words={words}
            base={base}
            moreHref={page.nextCursor ? link({ cursor: page.nextCursor, ...(showLifted ? { lifted: "1" } : {}) }) : null}
            lifted={showLifted ? (lifted ?? []) : null}
            liftedHref={showLifted ? link({}) : link({ lifted: "1" })}
            actions={{
              add: role === "owner" || role === "admin" ? addDncAction.bind(null, tenantId) : null,
              remove: role === "owner" ? removeDncAction.bind(null, tenantId) : null,
            }}
          />
        </div>
      ) : (
        <p className="m-0 mt-4 text-muted">{words["jobs.dnc.na"]}</p>
      )}
    </main>
  );
}
