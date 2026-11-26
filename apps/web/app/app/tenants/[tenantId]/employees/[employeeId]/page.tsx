import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { EmployeePage } from "@/components/v2/app/employees/page/EmployeePage";
import { isTab } from "@/components/v2/app/employees/page/tabs";
import type { CatalogueVoice, PageActions } from "@/components/v2/app/employees/page/shared";
import { PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getEmployee, getEmployees } from "@/lib/api/employees";
import { requireUser } from "@/lib/auth/session";
import { readEmployeeLines } from "@/lib/employees/lines";
import { employeeScreens, jobsScreens } from "@/lib/screens/flag";
import { readVoicePicker } from "@/lib/voice-picker/source";

import { loadActivityAction, patchEmployeeAction, previewEmployeeAction, setEmployeePhoneAction, setEmployeeStatusAction, setEmployeeVoiceAction } from "../actions";

export const metadata = { title: `AI employee · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** The words this page names beyond the `emp.` family: the shared voice sentences and the play buttons of the voice picker. */
const VOICE_WORDS = ["vc.per_language", "vc.saved.for", "vc.play_sample", "vc.play.aria", "vc.stop.aria", "vt.play", "vt.stop"] as const;

const soft = <T,>(error: unknown): T | null => {
  if (error instanceof ApiAuthError) redirect("/login");
  return null;
};

/** /app/tenants/[tenantId]/employees/[employeeId] (EMPLOYEES, owner 26 Nov 2026): ONE AI employee in tabs (Overview, Voice and language, Rules, Responsibilities, Activity, Phone). Not there (404) while EMPLOYEES or JOBS is off, for an id that is not a uuid, or an employee that does not exist. Everyone who may open the workspace reads; Owner and Admin change. */
export default async function EmployeeRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/employees/[employeeId]">) {
  if (employeeScreens() === "off" || jobsScreens() === "off") notFound();
  const { tenantId, employeeId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(employeeId)) notFound();
  const user = await requireUser();
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    notFound();
  }
  const lang = await getLang();
  const words = wordsFor(lang, ["emp.", "outcome.cat."], VOICE_WORDS);
  const base = `/app/tenants/${tenantId}`;
  const employee = await getEmployee(user.accessToken, tenantId, employeeId).catch((error) => {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) notFound();
    return null;
  });
  if (!employee) {
    return (
      <main className={pageMain} lang={lang}>
        <PageTop title={words["emp.title"] ?? "Your AI team"} />
        <section data-part="emp-na" className="mt-5 flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 md:p-6">
          <p className="m-0 text-ink">{words["emp.err.unavailable"]}</p>
          <p className="m-0">
            <Link href={`${base}/employees`} prefetch={false} className="font-semibold text-brand-text underline underline-offset-2">
              {words["emp.page.back"]}
            </Link>
          </p>
        </section>
      </main>
    );
  }
  const owns = role === "owner" || role === "admin";
  const tab = (await searchParams).tab;
  const [list, picker, lines] = await Promise.all([
    getEmployees(user.accessToken, tenantId).catch((error) => soft<never>(error)),
    employee.isDefault ? null : readVoicePicker({ token: user.accessToken, tenantId }).catch((error) => soft<never>(error)),
    employee.isDefault ? null : readEmployeeLines(user.accessToken, tenantId),
  ]);
  const catalogue: CatalogueVoice[] | null = picker && picker.mode === "ok" ? picker.data.voices.map((v) => ({ id: v.id, name: v.name, language: v.language, gender: v.gender, recommended: v.recommended })) : null;
  const takenBy: Record<string, string> = {};
  for (const e of list?.employees ?? []) if (e.id !== employee.id && e.phoneNumberId) takenBy[e.phoneNumberId] = e.name;
  const actions: PageActions = {
    patch: patchEmployeeAction.bind(null, tenantId, employeeId),
    setStatus: setEmployeeStatusAction.bind(null, tenantId, employeeId),
    setVoice: setEmployeeVoiceAction.bind(null, tenantId, employeeId),
    setPhone: setEmployeePhoneAction.bind(null, tenantId, employeeId),
    preview: previewEmployeeAction.bind(null, tenantId, employeeId),
    activity: loadActivityAction.bind(null, tenantId, employeeId),
  };
  return (
    <main className={pageMain} lang={lang}>
      <EmployeePage
        employee={employee}
        words={words}
        lang={lang}
        base={base}
        canEdit={owns}
        actions={actions}
        initialTab={isTab(tab) ? tab : "overview"}
        catalogue={catalogue}
        sampleEndpoint={`${base}/voice-pick`}
        lines={lines}
        takenBy={takenBy}
      />
    </main>
  );
}
