import { notFound } from "next/navigation";

import { PageTop } from "@/components/v2/app/parts";
import { TaskDetail } from "@/components/v2/app/tasks/TaskDetail";
import { powersOf } from "@/components/v2/app/tasks/task-actions";
import { link, mutedText, pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { taskScreens } from "@/lib/screens/flag";
import { readContacts, readReport, readTask } from "@/lib/tasks/source";
import { isOver } from "@/lib/tasks/types";

import { boundTaskActions } from "../../tasks-bound";
import { taskContext } from "../prelude";

export const metadata = { title: `Task · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/tasks/[taskId] (night 4, job DR part B): one task. Its question (if Vijaya needs one answer), its plan card with "Approve all" (the Owner approves once, with the second factor), the live progress ("3 of 12", read again
 * every few seconds), and the report when it is over: the short answer first, then a table per person. Behind TASK_SCREENS; every role reads. The texts the API wrote are drawn as plain text.
 */
export default async function TaskRoute({ params }: PageProps<"/app/tenants/[tenantId]/tasks/[taskId]">) {
  if (taskScreens() === "off") notFound();
  const { tenantId, taskId } = await params;
  if (!isCanonicalUuid(taskId)) notFound();
  const got = await taskContext(tenantId);
  if (!got.ok) return got.page;
  const { accessToken, tenant } = got.ctx;
  const ctx = { token: accessToken, tenantId };
  const read = await readTask(ctx, taskId);
  if (!read.ok && read.error === "not_found") notFound();
  const lang = await getLang();
  const words = wordsFor(lang, ["tk.", "pc.", "asst.lang."], ["frame.notyet"]);
  const base = `/app/tenants/${tenantId}`;
  if (!read.ok)
    return (
      <main className={pageMain} lang={lang}>
        <PageTop title={words["tk.detail.title"] ?? "Task"} />
        <p className={mutedText}>{words["frame.notyet"] ?? "Not available yet"}</p>
      </main>
    );
  const task = read.value;
  const [people, report] = await Promise.all([task.status === "planned" && (task.plan?.contacts_total ?? 0) > 0 ? readContacts(ctx, taskId) : null, isOver(task.status) ? readReport(ctx, taskId) : null]);
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["tk.detail.title"] ?? "Task"} sub={<span className="[overflow-wrap:anywhere]">{task.instruction}</span>} />
      <p className="mt-3">
        <a href={`${base}/tasks`} className={link}>
          {words["tk.back"] ?? "All tasks"}
        </a>
      </p>
      <div className="mt-6 max-w-4xl">
        <TaskDetail
          initialTask={task}
          initialReport={report?.ok ? report.value : null}
          everyone={people?.ok ? people.value.contacts : null}
          words={words}
          lang={lang}
          base={base}
          actions={boundTaskActions(tenantId)}
          powers={powersOf(tenant.role)}
        />
      </div>
    </main>
  );
}
