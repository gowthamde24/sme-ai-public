"use server";

import type { Out } from "@/components/v2/app/privacy/types";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { failureOf } from "@/lib/api/failure";
import {
  cancelAccountDeletion,
  cancelWorkspaceDeletion,
  executeWorkspaceDeletion,
  exportLink,
  getMyExport,
  requestAccountDeletion,
  requestExport,
  requestWorkspaceDeletion,
  type DataExport,
  type Deletion,
  type ExportLink,
} from "@/lib/api/privacy";
import { requireUser } from "@/lib/auth/session";

/**
 * Settings > Privacy, what the person does (job CC, screen 2). Each action checks its ids, asks the API with the person's own token (the API checks the role and the second factor) and answers the thing or one sentence of ours with
 * the API's closed code. The signed link of a download is returned to the page that asked, to be opened at once: it is not logged and no page is revalidated with it. Nothing here deletes anything by itself: a deletion waits 14 days.
 */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function run<T>(tenantId: string | null, ids: string[], work: (token: string) => Promise<T>, inputOk = true): Promise<Out<T>> {
  const user = await requireUser();
  const t = appT(await getLang());
  if (!inputOk || (tenantId !== null && !isCanonicalUuid(tenantId)) || ids.some((i) => !uuid.test(i))) return { ok: false, kind: "invalid", error: t("apierr.invalid") };
  try {
    return { ok: true, data: await work(user.accessToken) };
  } catch (error) {
    return failureOf(error, t);
  }
}

export async function requestExportAction(tenantId: string, scope: "person" | "workspace", exportId: string): Promise<Out<DataExport>> {
  return run(tenantId, [exportId], (token) => requestExport(token, exportId, scope === "workspace" ? tenantId : null));
}

export async function getExportAction(tenantId: string, exportId: string): Promise<Out<DataExport>> {
  return run(tenantId, [exportId], (token) => getMyExport(token, exportId));
}

export async function exportLinkAction(tenantId: string, exportId: string): Promise<Out<ExportLink>> {
  return run(tenantId, [exportId], (token) => exportLink(token, exportId));
}

export async function requestAccountDeletionAction(tenantId: string, requestId: string, email: string): Promise<Out<Deletion>> {
  return run(tenantId, [requestId], (token) => requestAccountDeletion(token, requestId, email), typeof email === "string" && email.length >= 3 && email.length <= 320);
}

export async function cancelAccountDeletionAction(tenantId: string, requestId: string): Promise<Out<Deletion>> {
  return run(tenantId, [requestId], (token) => cancelAccountDeletion(token, requestId));
}

export async function requestWorkspaceDeletionAction(tenantId: string, requestId: string, name: string): Promise<Out<Deletion>> {
  return run(tenantId, [requestId], (token) => requestWorkspaceDeletion(token, tenantId, requestId, name), typeof name === "string" && name.length >= 1 && name.length <= 200);
}

export async function cancelWorkspaceDeletionAction(tenantId: string, requestId: string): Promise<Out<Deletion>> {
  return run(tenantId, [requestId], (token) => cancelWorkspaceDeletion(token, tenantId, requestId));
}

export async function executeWorkspaceDeletionAction(tenantId: string, requestId: string): Promise<Out<Deletion>> {
  return run(tenantId, [requestId], (token) => executeWorkspaceDeletion(token, tenantId, requestId));
}