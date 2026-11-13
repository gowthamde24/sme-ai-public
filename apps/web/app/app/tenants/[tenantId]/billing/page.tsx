import { notFound, redirect } from "next/navigation";

import { BillingV6 } from "@/components/v2/app/billing/BillingV6";
import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { ApiDownV2, NotShownV2 } from "@/components/v2/app/parts";
import { appT } from "@/i18n/app";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { readBillingBalance, readInvoices, readPricing } from "@/lib/billing-v6/source";
import { TOPUP_CHOICES } from "@/lib/billing-v6/mock-state";
import { formatRupeesShort } from "@/lib/money";
import { balanceScreens, designV6 } from "@/lib/screens/flag";

import { freeStartAction, topupAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/billing (DESIGN_V6; Owner and Admin): the plan (name and price from `GET /v1/pricing`), the balance in rupees (`GET /billing/balance`) with the free start and Add money, and the invoices. Choosing or changing a plan is the plan picker's page
 * (/plans, with the Razorpay checkout). Top-up and invoices are TEST data until C1's Razorpay routes exist. A plain 404 where DESIGN_V6 is off.
 */
export default async function BillingPage({ params }: PageProps<"/app/tenants/[tenantId]/billing">) {
  const { tenantId } = await params;
  if (!designV6() || !isCanonicalUuid(tenantId)) notFound();
  const user = await requireUser();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  const t = appT(lang);
  if (tenant.role !== "owner" && tenant.role !== "admin") return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={t("bv6.title")} message={t("int.admins_only")} />;
  const base = `/app/tenants/${tenantId}`;
  const [balance, pricing, invoices] = await Promise.all([readBillingBalance(user.accessToken, tenantId), readPricing(user.accessToken), readInvoices()]);
  return (
    <BillingV6
      words={wordsFor(lang, ["bv6."])}
      lang={lang}
      base={base}
      help={helpTipFor(lang, base, "billing", true)}
      balance={balance}
      pricing={pricing}
      invoices={invoices}
      owner={tenant.role === "owner"}
      topupAmounts={TOPUP_CHOICES.map((paise) => ({ paise, text: formatRupeesShort(paise) }))}
      actions={{ freeStart: freeStartAction.bind(null, tenantId), topup: topupAction.bind(null, tenantId) }}
      mock={balanceScreens() === "mock"}
    />
  );
}
