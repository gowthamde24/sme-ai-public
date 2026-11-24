import { notFound, redirect } from "next/navigation";

import { DevelopersView, TABS, type Tab } from "@/components/v2/app/developers/DevelopersView";
import { DeveloperKeysCard } from "@/components/v2/app/settings/LazyDeveloperKeys";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { readDeveloper } from "@/lib/developer/source";
import { isLang } from "@/lib/developer/overview";
import { requireUser } from "@/lib/auth/session";

import { createKeyAction, revokeKeyAction, rotateKeyAction } from "../settings/developer-actions";

export const metadata = { title: `Developers · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const isTab = (v: unknown): v is Tab => typeof v === "string" && (TABS as readonly string[]).includes(v);

/** /app/tenants/[tenantId]/developers (Owner and Admin): Overview, API keys (the existing test-key card) and the tabs C1's developer API has not opened yet (they say so plainly). */
export default async function DevelopersPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/developers">) {
  const { tenantId } = await params;
  const sp = await searchParams;
  if (!isCanonicalUuid(tenantId)) notFound();
  const user = await requireUser();
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    notFound();
  }
  if (role !== "owner" && role !== "admin") notFound();
  const tab: Tab = isTab(sp.tab) ? sp.tab : "overview";
  const ui = await getLang();
  const words = wordsFor(ui, ["dvp.", "sv6.dev.", "dev.", "dta.btn."]);
  const dev = tab === "keys" ? await readDeveloper(user.accessToken, tenantId) : null;
  const keys =
    dev && dev.mode === "ok" ? (
      <>
        <p className="m-0 text-[15px] text-muted">{words["dvp.test"]}</p>
        <DeveloperKeysCard words={words} lang={ui} keys={dev.keys} usage={dev.usage} mock={dev.mock} actions={{ create: createKeyAction.bind(null, tenantId), rotate: rotateKeyAction.bind(null, tenantId), revoke: revokeKeyAction.bind(null, tenantId) }} simple />
      </>
    ) : (
      <p role="note" className="m-0 border-y border-line py-3 text-[15px] text-muted">
        {words["dvp.keys.off"]}
      </p>
    );
  return <DevelopersView words={words} ui={ui} base={`/app/tenants/${tenantId}/developers`} tab={tab} lang={isLang(sp.lang) ? sp.lang : "curl"} keys={keys} />;
}
