import Link from "next/link";

import { AssistantSettings } from "@/components/v2/app/assistant/LazyAssistantSettings";
import { KnowledgeStep } from "@/components/v2/app/lead-setup/KnowledgeStep";
import { PlaybookStep } from "@/components/v2/app/lead-setup/PlaybookStep";
import { WizardFrame } from "@/components/v2/app/lead-setup/WizardFrame";
import { WizardTestCall } from "@/components/v2/app/lead-setup/WizardTestCall";
import { PageTop } from "@/components/v2/app/parts";
import { btnMain, btnQuiet, mutedText, pageMain, surface } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { assistantProfile } from "@/lib/assistant/defaults";
import { readAssistant } from "@/lib/assistant/source";
import { CALL_LANG_NAMES, VOICES } from "@/lib/assistant/types";
import { readKnowledge } from "@/lib/lead-desk/knowledge-source";
import { readPlaybook } from "@/lib/lead-desk/playbook-source";
import { readTemplates } from "@/lib/lead-desk/source";
import { readRules } from "@/lib/outreach/source";
import { withModuleWords } from "@/lib/packs/module-words";
import { assistantScreens, leadsScreens, outreachScreens, voiceSampleScreens } from "@/lib/screens/flag";
import { appT } from "@/i18n/app";

import { saveAssistantAction, testCallAction } from "../assistant-actions";
import { leadContext } from "../lead-context";
import { addFactAction, addFileAction, addPasteAction, decideFactAction, discardSourceAction, draftFactsAction, editFactAction, resetPlaybookAction, savePlaybookAction } from "../lead-setup-actions";

export const metadata = { title: `Set up Lead Desk · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * /app/tenants/[tenantId]/lead-setup?step=N (night 4, part A2): the Lead Desk setup in six short steps, each its own address, each skippable, phone-friendly: 1 what you sell (the assistant learns facts you approve), 2 your kind of business
 * (the template), 3 the goal and the questions (editable), 4 the assistant's name, voice, language and style (the settings that already exist), 5 a test call (a simulation), 6 where your leads come from and going live. Owner and Admin.
 */
export default async function LeadSetupPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/lead-setup">) {
  const { tenantId } = await params;
  const query = await searchParams;
  const got = await leadContext(tenantId, { roles: ["owner", "admin"], on: leadsScreens() !== "off" });
  if (!got.ok) return got.page;
  const { accessToken, userId, tenant, pack } = got.ctx;
  const lang = await getLang();
  const t = appT(lang);
  const words = withModuleWords(wordsFor(lang, ["ld.wiz.", "ld.k.", "ld.p.", "ld.goal.", "ld.source.", "pc.", "asst.", "ol.rule", "ol.hot.none"]), pack);
  const base = `/app/tenants/${tenantId}`;
  const raw = Number(pick(query.step));
  const step = Number.isInteger(raw) && raw >= 1 && raw <= 6 ? raw : 1;
  const owner = tenant.role === "owner";
  const ctx = { token: accessToken, tenantId };
  const next = `${base}/lead-setup?step=${step + 1}`;
  let body: React.ReactNode = null;

  if (step === 1) {
    const k = await readKnowledge(ctx);
    body =
      k === null ? (
        <p className={mutedText}>{words["frame.notyet"] ?? t("frame.notyet")}</p>
      ) : (
        <KnowledgeStep
          words={words}
          sources={k.sources}
          facts={k.facts}
          canPrice={owner}
          securityHref="/app/security"
          nextHref={next}
          actions={{ addPaste: addPasteAction.bind(null, tenantId), addFile: addFileAction.bind(null, tenantId), draft: draftFactsAction.bind(null, tenantId), addFact: addFactAction.bind(null, tenantId), edit: editFactAction.bind(null, tenantId), decide: decideFactAction.bind(null, tenantId), discard: discardSourceAction.bind(null, tenantId) }}
        />
      );
  } else if (step === 2 || step === 3) {
    const [pb, templates] = await Promise.all([readPlaybook(ctx, pack?.packId ?? null), readTemplates()]);
    const mine = pb?.templatePack ? templates.find((x) => x.packId === pb.templatePack) : undefined;
    if (!pb || pb.playbook === null) {
      body = (
        <section className={surface}>
          <p className="text-base">{t("ld.wiz.s2.deep")}</p>
          <div className="mt-3">
            <Link href={next} className={btnMain}>
              {t("ld.wiz.next")}
            </Link>
          </div>
        </section>
      );
    } else if (step === 2) {
      body = (
        <section data-part="template" className={`${surface} flex flex-col gap-2`}>
          <p className="font-display text-xl font-bold">{mine ? (mine.names[lang] ?? mine.names.en) : pb.templatePack}</p>
          {mine ? <p className="text-base">{mine.summary[lang] ?? mine.summary.en}</p> : null}
          <p className="text-base">{t("ld.wiz.s2.goal", { goal: pb.playbook.goalAsk })}</p>
          <p className="text-base">{t("ld.wiz.s2.questions", { n: pb.playbook.questions.length })}</p>
          <p className={`${mutedText} !mt-0`}>{t("ld.wiz.s2.change")}</p>
          <div>
            <Link href={next} className={btnMain}>
              {t("ld.wiz.next")}
            </Link>
          </div>
        </section>
      );
    } else {
      const fieldNames = Object.fromEntries([...pb.playbook.questions, ...(pb.defaults?.questions ?? [])].map((q) => [q.field, words[`ld.field.${q.field}`] ?? q.field.replaceAll("_", " ")]));
      body = <PlaybookStep words={words} read={pb} canEdit={owner} securityHref="/app/security" nextHref={next} fieldNames={fieldNames} actions={{ save: savePlaybookAction.bind(null, tenantId), reset: resetPlaybookAction.bind(null, tenantId) }} />;
    }
  } else if (step === 4) {
    const assistant = await readAssistant(ctx, pack?.modules ?? null);
    body =
      assistant.mode === "ok" ? (
        <AssistantSettings
          words={withModuleWords(wordsFor(lang, ["asst."]), pack)}
          initial={assistant.settings}
          profile={assistantProfile(pack?.modules ?? null)}
          shop={tenant.name}
          langs={CALL_LANG_NAMES}
          voiceNames={Object.fromEntries(VOICES.map((v) => [v, t(`asst.voice.${v}` as "asst.voice.female_warm")])) as Record<(typeof VOICES)[number], string>}
          canEdit={owner}
          testMode={assistantScreens() === "mock"}
          saved={assistant.saved}
          actions={{ save: saveAssistantAction.bind(null, tenantId) }}
          samples={voiceSampleScreens() !== "off" ? { endpoint: `${base}/voice-sample`, mock: voiceSampleScreens() === "mock" } : null}
        />
      ) : (
        <p className={mutedText}>{t("frame.notyet")}</p>
      );
  } else if (step === 5) {
    body = <WizardTestCall words={words} run={testCallAction.bind(null, tenantId)} canRun={owner} lang={lang} />;
  } else {
    const [k, pb, assistant, rules] = await Promise.all([readKnowledge(ctx), readPlaybook(ctx, pack?.packId ?? null), readAssistant(ctx, pack?.modules ?? null), outreachScreens() !== "off" ? readRules({ ...ctx, userId }) : Promise.resolve(null)]);
    const rows: { done: boolean; text: string; href: string }[] = [
      { done: (k?.facts.filter((f) => f.status === "approved").length ?? 0) > 0, text: t("ld.wiz.s6.facts", { n: k?.facts.filter((f) => f.status === "approved").length ?? 0 }), href: `${base}/lead-setup?step=1` },
      { done: pb?.saved === true, text: pb?.playbook ? t(pb.saved ? "ld.wiz.s6.playbook.saved" : "ld.wiz.s6.playbook.default") : t("ld.wiz.s6.playbook.none"), href: `${base}/lead-setup?step=3` },
      { done: assistant.mode === "ok" && assistant.saved, text: t("ld.wiz.s6.assistant"), href: `${base}/lead-setup?step=4` },
      { done: (rules?.length ?? 0) > 0, text: t("ld.wiz.s6.rules", { n: rules?.length ?? 0 }), href: `${base}/outreach` },
    ];
    body = (
      <div data-part="go-live" className="flex flex-col gap-4">
        <ul className={`${surface} flex flex-col gap-2`}>
          {rows.map((r) => (
            <li key={r.href + r.text} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-base">
                <span aria-hidden="true">{r.done ? "✓ " : "○ "}</span>
                <span className="sr-only">{r.done ? t("ld.wiz.s6.done") : t("ld.wiz.s6.todo")}: </span>
                {r.text}
              </span>
              <Link href={r.href} className="min-h-11 py-2 text-base font-semibold text-brand-text hover:underline">
                {r.done ? t("ld.wiz.s6.change") : t("ld.wiz.s6.do")}
              </Link>
            </li>
          ))}
        </ul>
        <section className={`${surface} flex flex-col gap-3`}>
          <h3 className="font-display text-lg font-bold">{t("ld.wiz.s6.sources")}</h3>
          <p className="text-base">{t("ld.wiz.s6.sources.sub")}</p>
          <div className="flex flex-wrap gap-3">
            <Link href={`${base}/lead-sources`} className={btnMain}>
              {t("ld.wiz.s6.sources.link")}
            </Link>
            <Link href={`${base}/import`} className={btnQuiet}>
              {t("ld.wiz.s6.import")}
            </Link>
          </div>
        </section>
        <section className={`${surface} flex flex-col gap-3`}>
          <h3 className="font-display text-lg font-bold">{t("ld.wiz.s6.live")}</h3>
          <p className="text-base">{t("ld.wiz.s6.live.sub")}</p>
          <div>
            <Link href={`${base}/lead-desk`} className={btnMain}>
              {t("ld.wiz.s6.go")}
            </Link>
          </div>
        </section>
      </div>
    );
  }
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={t("ld.wiz.title")} sub={t("ld.wiz.sub")} />
      <div className="mt-6 max-w-3xl">
        <WizardFrame words={words} step={step} base={base}>
          {body}
        </WizardFrame>
      </div>
    </main>
  );
}
