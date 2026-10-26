import { notFound } from "next/navigation";

import { PageTop, SegmentLinks } from "@/components/v2/app/parts";
import { TaskComposer } from "@/components/v2/app/tasks/TaskComposer";
import { TaskList } from "@/components/v2/app/tasks/TaskList";
import { powersOf } from "@/components/v2/app/tasks/task-actions";
import { mutedText, pageMain, pageH2 } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { readTasks, readTemplates } from "@/lib/tasks/source";
import { TASK_TABS, tabOf, templateOffered, INSTRUCTION_MAX, type TaskTab } from "@/lib/tasks/types";
import { taskScreens } from "@/lib/screens/flag";

import { boundTaskActions } from "../tasks-bound";
import { taskContext } from "./prelude";

export const metadata = { title: `Ask Vijaya to do it · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * /app/tenants/[tenantId]/tasks (night 4, job DR part B): "Ask Vijaya to do it". The box where the owner says what to do in plain words (any of six languages), the ready-made task chips, and the owner's tasks in three lists: running,
 * waiting for approval, finished. A tab of Calls. `?new=1` puts the cursor in the box and `?instruction=` fills it (other screens link here). Behind TASK_SCREENS; every role reads, Owner, Admin and Sales make a plan.
 */
export default async function TasksRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/tasks">) {
  if (taskScreens() === "off") notFound();
  const { tenantId } = await params;
  const got = await taskContext(tenantId);
  if (!got.ok) return got.page;
  const { accessToken, tenant, pack } = got.ctx;
  const sp = await searchParams;
  const requested = first(sp.tab);
  const tab: TaskTab = (TASK_TABS as readonly string[]).includes(requested ?? "") ? (requested as TaskTab) : "running";
  const initial = (first(sp.instruction) ?? "").slice(0, INSTRUCTION_MAX);
  const lang = await getLang();
  const base = `/app/tenants/${tenantId}`;
  const ctx = { token: accessToken, tenantId };
  const [tasks, templates] = await Promise.all([readTasks(ctx), readTemplates(ctx)]);
  const words = wordsFor(lang, ["tk.", "pc.", "asst.lang."], ["frame.notyet"]);
  const t = (k: string) => words[k] ?? k;
  const powers = powersOf(tenant.role);
  const offered = templates.ok ? templates.value.templates.filter((x) => templateOffered(x, pack?.packId ?? null)) : [];
  const all = tasks.ok ? tasks.value : [];
  const counts: Record<TaskTab, number> = { running: 0, waiting: 0, finished: 0 };
  for (const x of all) counts[tabOf(x.status)]++;
  const shown = all.filter((x) => tabOf(x.status) === tab);
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={t("tk.title")} sub={t("tk.sub")} />
      <div className="mt-6 max-w-3xl">
        <TaskComposer words={words} base={base} actions={boundTaskActions(tenantId)} templates={offered} canPlan={powers.plan} initial={initial} focus={first(sp.new) === "1"} />
      </div>
      <h2 className={pageH2}>{t("tk.lists.title")}</h2>
      <SegmentLinks label={t("tk.lists.title")} items={TASK_TABS.map((k) => ({ key: k, label: `${t(`tk.tab.${k}`)} (${counts[k]})`, href: `${base}/tasks?tab=${k}`, current: k === tab }))} />
      {tasks.ok ? <TaskList tasks={shown} words={words} base={base} lang={lang} empty={t(`tk.empty.${tab}`)} /> : <p className={mutedText}>{t("frame.notyet")}</p>}
    </main>
  );
}
