import Link from "next/link";

import { RulesPanel } from "@/components/v2/app/outreach/RulesPanel";
import { PageTop } from "@/components/v2/app/parts";
import { btnQuiet, mutedText, pageH2, pageMain, surface } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { goalsForPack, withBusinessName } from "@/lib/outreach/goals";
import { readPolicy, readRuleTemplates, readRules } from "@/lib/outreach/source";
import { goalNames, languageNames, sourceNames, clockText } from "@/lib/outreach/words";
import { buildSteps, retryPhrase } from "@/components/v2/app/outreach/plan-text";
import { makeT } from "@/components/v2/app/words";
import { outreachScreens } from "@/lib/screens/flag";

import { leadContext } from "../../lead-context";
import { ruleControlAction, saveRuleAction } from "../../outreach-actions";

export const metadata = { title: `Rules · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * /app/tenants/[tenantId]/outreach/rules (owner, 17 Nov): the tab next to Campaigns. The STANDING RULES per lead source (approved once, then nobody clicks per lead) and the calling hours and tries, which used to sit in a folded block under the
 * campaigns. Owner and Admin change the rules; a Sales member reads the hours and tries. Same reads and the same actions as before: nothing was removed, only moved.
 */
export default async function OutreachRulesPage({ params }: PageProps<"/app/tenants/[tenantId]/outreach/rules">) {
  const { tenantId } = await params;
  const got = await leadContext(tenantId, { roles: ["owner", "admin", "sales"], on: outreachScreens() !== "off" });
  if (!got.ok) return got.page;
  const { accessToken, userId, tenant, pack } = got.ctx;
  const lang = await getLang();
  const words = wordsFor(lang, ["ol.", "pc.", "ld.goal.", "ld.source.", "asst.day.", "today.lang.", "cv6."]);
  const base = `/app/tenants/${tenantId}`;
  const ctx = { token: accessToken, tenantId, userId };
  const decider = tenant.role === "owner" || tenant.role === "admin";
  const [rules, policy, templates] = await Promise.all([decider ? readRules(ctx) : Promise.resolve(null), readPolicy(ctx), decider ? readRuleTemplates(ctx) : Promise.resolve(null)]);
  const retryLine = policy ? (policy.retrySteps ? words["ol.policy.retry_steps"]?.replace("{steps}", retryPhrase(makeT(words), buildSteps(0, policy.retrySteps, null)) ?? "") : words["ol.policy.retry"]?.replace("{n}", String(policy.maxAttempts)).replace("{h}", String(policy.retryGapHours))) : null;
  const shown = templates ? templates.map((x) => ({ ...x, preview: withBusinessName(x.preview, tenant.name) })) : null;
  const gn = goalNames(words);
  const sn = sourceNames(words);
  const ln = languageNames();
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["cv6.rules.title"] ?? ""} sub={words["cv6.rules.sub"] ?? ""} />
          {decider || policy ? (
            <div data-part="campaign-rules">
              
              {decider ? (
                <>
          <h2 className={pageH2}>{words["ol.rules.title"]}</h2>
                  <p className={`${mutedText} !mt-0 mb-3`}>{words["ol.rules.sub"]}</p>
                  {rules === null ? (
                    <p className={mutedText}>{words["ol.na"]}</p>
                  ) : (
                    <RulesPanel templatesHref={tenant.role === "owner" || tenant.role === "admin" ? `${base}/chats/templates` : null} words={words} rules={rules} canAdd={tenant.role === "owner"} canControl sourceNames={sn} goalNames={gn} languageNames={ln} actions={{ save: saveRuleAction.bind(null, tenantId), control: ruleControlAction.bind(null, tenantId) }} securityHref="/app/security" defaultLanguage="en" templates={shown} retrySteps={policy?.retrySteps ?? null} goals={goalsForPack(pack?.packId)} />
                  )}
                </>
              ) : null}
              {policy ? (
                <>
          <h2 className={pageH2}>{words["cv6.rules.hours"]}</h2>
                  <section data-part="policy" className={`${surface} flex flex-col gap-2 text-base`}>
                    <p>{words["ol.policy.hours"]?.replace("{days}", policy.hours.days.map((d) => words[`asst.day.${DAY_KEYS[d - 1]}`] ?? "").join(", ")).replace("{from}", clockText(policy.hours.fromMinute)).replace("{to}", clockText(policy.hours.toMinute))}</p>
                    <p>{words["ol.policy.night"]?.replace("{time}", clockText(policy.nightCallMinute))}</p>
                    <p>{retryLine}</p>
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
            </div>
          ) : null}
    </main>
  );
}
