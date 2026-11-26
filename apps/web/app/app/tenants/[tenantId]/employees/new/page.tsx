import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { EmployeeWizard } from "@/components/v2/app/employees/wizard/LazyEmployeeWizard";
import { WIZARD_LANGS, type WizardActions, type WizardVoice } from "@/components/v2/app/employees/wizard/draft";
import { PageTop } from "@/components/v2/app/parts";
import { btnQuiet, pageMain } from "@/components/v2/app/ui";
import { makeT } from "@/components/v2/app/words";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getEmployees } from "@/lib/api/employees";
import { requireUser } from "@/lib/auth/session";
import { employeeScreens, jobsScreens } from "@/lib/screens/flag";
import { readVoicePicker } from "@/lib/voice-picker/source";

import { createEmployeeAction, patchEmployeeAction, previewEmployeeAction, setEmployeeStatusAction, setEmployeeVoiceAction } from "../actions";

export const metadata = { title: `New AI employee · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const box = "m-0 mt-4 rounded-2xl border border-line bg-surface p-5 text-ink";

/**
 * /app/tenants/[tenantId]/employees/new (EMPLOYEES, owner 26 Nov 2026): the "New AI employee" wizard, seven screens (role, name, voice, rules, work, preview, turn on). Owner and Admin only; at the plan's limit the page says so instead of the wizard.
 * The voices come from the workspace's voice picker (the same catalogue as My assistant). Not there (404) while EMPLOYEES or JOBS is off.
 */
export default async function NewEmployeeRoute({ params }: PageProps<"/app/tenants/[tenantId]/employees/new">) {
  if (employeeScreens() === "off" || jobsScreens() === "off") notFound();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  const user = await requireUser();
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    notFound();
  }
  const lang = await getLang();
  const words = wordsFor(lang, ["emp."], ["vc.per_language", "vc.woman", "vc.man", "vc.play_sample", "vc.later"]);
  const t = makeT(words);
  const base = `/app/tenants/${tenantId}`;
  const back = (
    <p className="m-0 mt-4">
      <Link href={`${base}/employees`} prefetch={false} className={btnQuiet}>
        {words["emp.wiz.back_list"]}
      </Link>
    </p>
  );
  const top = <PageTop title={words["emp.new"] ?? "New AI employee"} />;
  if (role !== "owner" && role !== "admin") {
    return (
      <main className={pageMain} lang={lang}>
        {top}
        <p data-part="emp-only-owner" className={box}>
          {words["emp.only_owner"]}
        </p>
        {back}
      </main>
    );
  }
  const list = await getEmployees(user.accessToken, tenantId).catch((error) => {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  });
  if (!list) {
    return (
      <main className={pageMain} lang={lang}>
        {top}
        <p data-part="emp-na" className={box}>
          {words["emp.na"]}
        </p>
        {back}
      </main>
    );
  }
  if (list.employees.length >= list.limit) {
    return (
      <main className={pageMain} lang={lang}>
        {top}
        <section data-part="emp-limit" className={box}>
          <h2 className="m-0 mb-2 text-lg font-semibold">{words["emp.wiz.limit.h"]}</h2>
          <p className="m-0">{list.limit <= 1 ? t("emp.limit.trial") : t("emp.limit.full", { limit: list.limit })}</p>
        </section>
        {back}
      </main>
    );
  }
  const picker = await readVoicePicker({ token: user.accessToken, tenantId }).catch((error) => {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  });
  const voices: WizardVoice[] =
    picker?.mode === "ok"
      ? picker.data.voices.flatMap((v) => ((WIZARD_LANGS as readonly string[]).includes(v.language) ? [{ id: v.id, language: v.language as WizardVoice["language"], name: v.name, label: v.label, gender: v.gender, recommended: v.recommended }] : []))
      : [];
  const actions: WizardActions = {
    create: createEmployeeAction.bind(null, tenantId),
    patch: patchEmployeeAction.bind(null, tenantId),
    setVoice: setEmployeeVoiceAction.bind(null, tenantId),
    preview: previewEmployeeAction.bind(null, tenantId),
    setStatus: setEmployeeStatusAction.bind(null, tenantId),
  };
  return (
    <main className={pageMain} lang={lang}>
      {top}
      <div className="mt-5">
        <EmployeeWizard words={words} base={base} actions={actions} voices={voices} />
      </div>
    </main>
  );
}
