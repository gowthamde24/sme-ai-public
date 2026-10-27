import type { TaskActions } from "@/components/v2/app/tasks/task-actions";

import { answerTaskAction, approveTaskAction, cancelTaskAction, excludeContactsAction, pauseTaskAction, planTaskAction, progressTaskAction, reportTaskAction, resumeTaskAction, runTaskAction, setCapAction, templatesTaskAction } from "./tasks-actions";

/** The task actions with the workspace bound, for a client component (a page and the layout's Ask provider both hand these down). Server code only: it names the server actions. */
export function boundTaskActions(tenantId: string): TaskActions {
  return {
    plan: planTaskAction.bind(null, tenantId),
    answer: answerTaskAction.bind(null, tenantId),
    exclude: excludeContactsAction.bind(null, tenantId),
    approve: approveTaskAction.bind(null, tenantId),
    setCap: setCapAction.bind(null, tenantId),
    run: runTaskAction.bind(null, tenantId),
    pause: pauseTaskAction.bind(null, tenantId),
    resume: resumeTaskAction.bind(null, tenantId),
    cancel: cancelTaskAction.bind(null, tenantId),
    progress: progressTaskAction.bind(null, tenantId),
    report: reportTaskAction.bind(null, tenantId),
    templates: templatesTaskAction.bind(null, tenantId),
  };
}
