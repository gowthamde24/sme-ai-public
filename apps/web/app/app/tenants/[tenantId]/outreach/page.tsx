import Link from "next/link";

import { HotLeads } from "@/components/v2/app/outreach/HotLeads";
import { RulesPanel } from "@/components/v2/app/outreach/RulesPanel";
import { PageTop } from "@/components/v2/app/parts";
import { WaitingCard } from "@/components/v2/app/topups/WaitingCard";
import { btnMainLink, fieldInput, fieldLabel, mutedText, pageH2, pageMain, pillBrand, pillGreen, pillAmber, pillNeutral, surface, btnQuiet } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { formatRupeesShort } from "@/lib/money";
import { readBatches, readHandoffs, readPolicy, readRules } from "@/lib/outreach/source";
import { SOURCE_TAGS } from "@/lib/outreach/types";
import { goalNames, languageNames, sourceNames, clockText } from "@/lib/outreach/words";
import { outreachScreens, topupScreens } from "@/lib/screens/flag";
import { readUsageCached } from "@/lib/topups/source";

import { handoffActedAction, ruleControlAction, saveRuleAction } from "../outreach-actions";
import { leadContext } from "../lead-context";

export const metadata = { title: `Lead plans · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * /app/tenants/[tenantId]/outreach (night 4, part A3; a tab of Calls): speed to lead in one place. The hot leads waiting for a person, the STANDING RULES per lead source (approved once, then nobody clicks per lead), the plans for
 * batches (an upload, a list: ONE "Approve all" each), and the calling policy in plain words. Owner, Admin and Sales open it (a Sales member sees their own hot leads and the plans; rules and the policy are for Owner and Admin).
 */
export default async function OutreachPage({ params }: PageProps<"/app/tenants/[tenantId]/outreach">) {
  const { tenantId } = await params;
  const got = await leadContext(tenantId, { roles: ["owner", "admin", "sales"], on: outreachScreens() !== "off" });
  if (!got.ok) return got.page;
  const { accessToken, userId, tenant } = got.ctx;
  const lang = await getLang();
  const words = wordsFor(lang, ["ol.", "pc.", "ld.goal.", "ld.source.", "asst.day."]);
  const base = `/app/tenants/${tenantId}`;
  const ctx = { token: accessToken, tenantId, userId };
  const decider = tenant.role === "owner" || tenant.role === "admin";
  // calls that wait for minutes (night 4, F2): the way to top up, on the page where the calls are planned (Owner and Admin read the usage)
  const usage = decider && topupScreens() !== "off" ? await readUsageCached(accessToken, tenantId).catch(() => null) : null;
  const [batches, handoffs, rules, policy] = await Promise.all([readBatches(ctx), readHandoffs(ctx, true), decider ? readRules(ctx) : Promise.resolve(null), decider ? readPolicy(ctx) : Promise.resolve(null)]);
  const mock = outreachScreens() === "mock";
  const gn = goalNames(words);
  const sn = sourceNames(words);
  const ln = languageNames();
  const statusPill = (s: string) => (s === "running" || s === "done" ? pillGreen : s === "paused" ? pillAmber : s === "planned" ? pillBrand : pillNeutral);
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["ol.title"] ?? "Lead plans"} sub={words["ol.sub"] ?? ""} />
      {mock ? (
        <p role="note" className="mt-3 text-sm text-muted">
          {words["ol.mock"]}
        </p>
      ) : null}

      {usage ? <WaitingCard words={wordsFor(lang, ["tu.cta.", "tu.wait."])} waiting={usage.queuedCalls} href={`${base}/settings?section=plan#topups`} canBuy={tenant.role === "owner"} /> : null}

      <h2 className={pageH2}>{words["ol.hot.title"]}</h2>
      {handoffs === null ? <p className={mutedText}>{words["ol.na"]}</p> : <HotLeads words={words} items={handoffs} acted={handoffActedAction.bind(null, tenantId)} />}

      {decider ? (
        <>
          <h2 className={pageH2}>{words["ol.rules.title"]}</h2>
          <p className={`${mutedText} !mt-0 mb-3`}>{words["ol.rules.sub"]}</p>
          {rules === null ? (
            <p className={mutedText}>{words["ol.na"]}</p>
          ) : (
            <RulesPanel words={words} rules={rules} canAdd={tenant.role === "owner"} canControl sourceNames={sn} goalNames={gn} languageNames={ln} actions={{ save: saveRuleAction.bind(null, tenantId), control: ruleControlAction.bind(null, tenantId) }} securityHref="/app/security" defaultLanguage="en" />
          )}
        </>
      ) : null}

      <h2 className={pageH2}>{words["ol.plans.title"]}</h2>
      <form method="get" action={`${base}/outreach/new`} className={`${surface} flex flex-wrap items-end gap-3`}>
        <div className="min-w-0 flex-1">
          <label htmlFor="op-source" className={fieldLabel}>
            {words["ol.plans.source"]}
          </label>
          <select id="op-source" name="source" className={fieldInput} defaultValue="excel_upload">
            {SOURCE_TAGS.map((s) => (
              <option key={s} value={s}>
                {sn[s]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={btnMainLink}>
          {words["ol.plans.make"]}
        </button>
      </form>
      {batches === null ? (
        <p className={mutedText}>{words["ol.na"]}</p>
      ) : batches.length === 0 ? (
        <p className={mutedText}>{words["ol.plans.none"]}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {batches.map(({ batch, plan, progress }) => (
            <li key={batch.id} className={`${surface} flex flex-wrap items-center justify-between gap-3`}>
              <div className="min-w-0">
                <Link href={`${base}/outreach/batches/${batch.id}`} className="font-display text-lg font-bold text-brand-text hover:underline">
                  {batch.name}
                </Link>
                <p className={`${mutedText} !mt-0`}>
                  {gn[batch.goal]} · {words[`ol.plans.people`]?.replace("{n}", String(plan.count))} · {formatRupeesShort(plan.estimatedCostPaise)}
                  {progress ? ` · ${words["ol.progress.of"]?.replace("{done}", String(progress.done)).replace("{total}", String(progress.total))}` : ""}
                </p>
              </div>
              <span className={statusPill(batch.status)}>{words[`pc.state.${batch.status === "cancelled" ? "cancelled" : batch.status}`]}</span>
            </li>
          ))}
        </ul>
      )}

      {policy ? (
        <>
          <h2 className={pageH2}>{words["ol.policy.title"]}</h2>
          <section data-part="policy" className={`${surface} flex flex-col gap-2 text-base`}>
            <p>{words["ol.policy.hours"]?.replace("{days}", policy.hours.days.map((d) => words[`asst.day.${DAY_KEYS[d - 1]}`] ?? "").join(", ")).replace("{from}", clockText(policy.hours.fromMinute)).replace("{to}", clockText(policy.hours.toMinute))}</p>
            <p>{words["ol.policy.night"]?.replace("{time}", clockText(policy.nightCallMinute))}</p>
            <p>{words["ol.policy.retry"]?.replace("{n}", String(policy.maxAttempts)).replace("{h}", String(policy.retryGapHours))}</p>
            <p>{words["ol.policy.handoff"]?.replace("{n}", String(policy.handoffReminderMinutes))}</p>
            <p className={`${mutedText} !mt-0`}>{words["ol.policy.stop"]}</p>
            <div>
              <Link href={`${base}/settings?section=assistant`} className={btnQuiet}>
                {words["ol.policy.change"]}
              </Link>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
