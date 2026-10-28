import type { Deletion, DataExport, ExportLink } from "@/lib/api/privacy";

import type { Failed } from "../cc/kit";

/** What the privacy parts call (server actions bound to the workspace by the page). An answer is the thing, or a Failed with a sentence of ours and the API's closed code. */
export type Out<T> = { ok: true; data: T } | Failed;

export interface PrivacyActions {
  requestExport: (scope: "person" | "workspace", exportId: string, confirmName?: string) => Promise<Out<DataExport>>;
  getExport: (exportId: string) => Promise<Out<DataExport>>;
  openLink: (exportId: string) => Promise<Out<ExportLink>>;
  requestAccountDeletion: (requestId: string, email: string) => Promise<Out<Deletion>>;
  cancelAccountDeletion: (requestId: string) => Promise<Out<Deletion>>;
  requestWorkspaceDeletion: (requestId: string, name: string) => Promise<Out<Deletion>>;
  cancelWorkspaceDeletion: (requestId: string) => Promise<Out<Deletion>>;
  executeWorkspaceDeletion: (requestId: string) => Promise<Out<Deletion>>;
}
