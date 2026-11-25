import type { Connection, Deliveries, Fail, TestResult } from "@/lib/api/crm-push";

type Ok<T> = ({ ok: true } & T) | Fail;
/** What the Connectors page can do (server actions bound to the tenant by the page). `readOnly` (the review sample) draws the screen with every button off. */
export type ConnectorActions = {
  connect: (type: string, input: { credentials: Record<string, string>; settings: Record<string, string>; mapping?: Record<string, string> }) => Promise<Ok<{ connection: Connection }>>;
  change: (type: string, input: { mapping?: Record<string, string>; events?: string[]; active?: boolean }) => Promise<Ok<{ connection: Connection }>>;
  disconnect: (type: string) => Promise<Ok<unknown>>;
  test: (type: string) => Promise<Ok<{ result: TestResult }>>;
  log: (type: string, before: string | null) => Promise<Ok<{ log: Deliveries }>>;
  retry: (type: string) => Promise<Ok<{ requeued: number }>>;
};
export type { Ok };
