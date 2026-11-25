import { notFound, redirect } from "next/navigation";

import { BillingV2 } from "@/components/v2/app/billing/v2/BillingV2";
import { CreditsPage } from "@/components/v2/app/credits/CreditsPage";
import { BillingV6 } from "@/components/v2/app/billing/BillingV6";
import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { ApiDownV2, NotShownV2, PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { appT } from "@/i18n/app";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { readWallet } from "@/lib/api/wallet";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { readBillingBalance, readInvoices, readPricing } from "@/lib/billing-v6/source";
import { TOPUP_CHOICES } from "@/lib/billing-v6/mock-state";
import { formatRupeesShort } from "@/lib/money";
import { getBalance, getOptions, getStatement, listTopups } from "@/lib/api/credits";
import { CallBillingFacts } from "@/components/v2/app/calls/panel/CallBillingFacts";
import { balanceScreens, billingV2, callsPanel, creditsScreens, designV6, earlyAccess } from "@/lib/screens/flag";

import { freeStartAction, setLimitAction, topupAction } from "./actions";
import { confirmTopupAction, createTopupAction, failTopupAction, loadStatementAction } from "./credits-actions";

export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/billing (DESIGN_V6; Owner and Admin): the plan (name and price from `GET /v1/pricing`), the balance in rupees (`GET /billing/balance`) with the free start and Add money, and the invoices. Choosing or changing a plan is the plan picker's page
 * (/plans, with the Razorpay checkout). Top-up and invoices are TEST data until C1's Razorpay routes exist. A plain 404 where DESIGN_V6 is off.
 */
export default async function BillingPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/billing">) {
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
  // free early access (EARLY_ACCESS=1): nothing to pay, no balance, no top-up, no plan to pick; a link that still points here says so
  if (earlyAccess()) return (<main className={pageMain} lang={lang}><PageTop title={t("ea.title")} sub={t("ea.body")} /></main>);
  const base = `/app/tenants/${tenantId}`;
  // CALLS_PANEL: "How calls are billed" (rows tagged Draft until the owner confirms them)
  const facts = callsPanel() ? <CallBillingFacts words={wordsFor(lang, ["cpn.bill."])} /> : null;
  // CREDITS_SCREENS (29 Nov 2026): the balance, Add credits (Razorpay Checkout), the low-balance line, the statement and the GST invoices, on C1's credits routes (a part that cannot be read is left out, never filled in)
  if (creditsScreens()) {
    const [read, options, topups, statement] = await Promise.all([
      getBalance(user.accessToken, tenantId).catch((error) => (error instanceof ApiAuthError ? redirect("/login") : null)),
      getOptions(user.accessToken, tenantId).catch((error) => (error instanceof ApiAuthError ? redirect("/login") : null)),
      listTopups(user.accessToken, tenantId).catch((error) => (error instanceof ApiAuthError ? redirect("/login") : null)),
      getStatement(user.accessToken, tenantId, null).catch((error) => (error instanceof ApiAuthError ? redirect("/login") : null)),
    ]);
    return (
      <CreditsPage
        words={wordsFor(lang, ["cr."])}
        lang={lang}
        base={base}
        help={helpTipFor(lang, base, "billing", true)}
        balance={read?.balance ?? null}
        debtPaise={read?.debtPaise ?? null}
        options={options}
        topups={topups}
        statement={statement}
        owner={tenant.role === "owner"}
        facts={facts}
        actions={{ create: createTopupAction.bind(null, tenantId), confirm: confirmTopupAction.bind(null, tenantId), fail: failTopupAction.bind(null, tenantId), statement: loadStatementAction.bind(null, tenantId) }}
      />
    );
  }
  // BILLING_V2 (owner's final pricing): ONE ₹ wallet with a usage line per feature, limits, warnings, the upgrade hint and numbers on demand; unset = the page below, unchanged
  if (billingV2() !== "off") {
    const demo = (await searchParams).demo;
    const wallet = await readWallet(user.accessToken, tenantId, typeof demo === "string" ? demo : null);
    return (
      <BillingV2
        words={wordsFor(lang, ["bill.", "bv6."])}
        lang={lang}
        base={base}
        help={helpTipFor(lang, base, "billing", true)}
        wallet={wallet}
        facts={facts}
        owner={tenant.role === "owner"}
        topupAmounts={TOPUP_CHOICES.map((paise) => ({ paise, text: formatRupeesShort(paise) }))}
        actions={{ freeStart: freeStartAction.bind(null, tenantId), topup: topupAction.bind(null, tenantId), setLimit: setLimitAction.bind(null, tenantId) }}
      />
    );
  }
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
      facts={facts}
    />
  );
}
