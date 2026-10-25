import { ChartNoAxesColumn, FileText, MessageCircle, PhoneCall, RefreshCw, Search, type LucideIcon } from "lucide-react";

/** The six AI workers in the order of the workflow (job DM): Find leads, Research, AI calls, WhatsApp, Outcome, Follow-up. The icon is the picture of each job; step 3 (AI calls) is the one that is in early access. */
export const WORKER_ICONS: readonly LucideIcon[] = [Search, FileText, PhoneCall, MessageCircle, ChartNoAxesColumn, RefreshCw];
export const WORKERS = [1, 2, 3, 4, 5, 6] as const;
export type WorkerNo = (typeof WORKERS)[number];
/** The workers that are not open to everyone yet (they carry an "Early access" tag). */
export const EARLY: readonly WorkerNo[] = [3];
