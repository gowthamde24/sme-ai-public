import type { Reply } from "../../cc/kit";
import type { JobFaq, TestChannel } from "@/lib/jobs/detail";
import type { JobPatched, JobDetailTested } from "@/lib/api/jobs";
import type { JobSwitched } from "@/lib/jobs/types";

/** The changes the job page can make, already bound to the workspace and the job by the page (server actions). null = the person only reads (Sales, Viewer). */
export type JobPageActions = {
  setEnabled: (enabled: boolean) => Promise<Reply<JobSwitched>>;
  rename: (name: string) => Promise<Reply<JobPatched>>;
  setSetting: (key: string, value: string | boolean) => Promise<Reply<JobPatched>>;
  setFindsOut: (key: string, enabled: boolean) => Promise<Reply<JobPatched>>;
  addFaq: (question: string, answer: string) => Promise<Reply<JobFaq>>;
  removeFaq: (faqId: string) => Promise<Reply<{ id: string }>>;
  test: (channel: TestChannel) => Promise<Reply<JobDetailTested>>;
};

/** A card of the job page: the same white card as the Jobs list. */
export const jobCard = "rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] md:p-5";
export const jobH2 = "m-0 font-display text-[17px] font-bold leading-tight text-ink";
export const jobBtn = "jb-press write-ctl inline-flex min-h-10 items-center justify-center gap-2 rounded-full border px-4 text-[15px] font-semibold disabled:opacity-60";
export const jobBtnMain = `${jobBtn} border-brand-edge bg-brand text-on-brand`;
export const jobBtnQuiet = `${jobBtn} border-edge bg-surface text-ink`;
