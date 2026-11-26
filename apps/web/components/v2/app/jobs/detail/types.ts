import type { Reply } from "../../cc/kit";
import type { JobFaq, TestChannel } from "@/lib/jobs/detail";
import type { JobPatched, JobDetailTested } from "@/lib/api/jobs";
import type { JobSwitched } from "@/lib/jobs/types";
import type { SpeaksPatch, WhoTarget, WhoVoiceName } from "@/lib/jobs/who";

/** The changes the job page can make, already bound to the workspace and the job by the page (server actions). null = the person only reads (Sales, Viewer). */
export type JobPageActions = {
  setEnabled: (enabled: boolean) => Promise<Reply<JobSwitched>>;
  rename: (name: string) => Promise<Reply<JobPatched>>;
  setSetting: (key: string, value: string | boolean) => Promise<Reply<JobPatched>>;
  setFindsOut: (key: string, enabled: boolean) => Promise<Reply<JobPatched>>;
  addFaq: (question: string, answer: string) => Promise<Reply<JobFaq>>;
  removeFaq: (faqId: string) => Promise<Reply<{ id: string }>>;
  test: (channel: TestChannel) => Promise<Reply<JobDetailTested>>;
  /** Who talks (language, tone, voice, number): only what changed. Absent = the card is not drawn as changeable. */
  setSpeaks?: (patch: SpeaksPatch) => Promise<Reply<JobPatched>>;
};

/** What the page adds for the Who talks card: the workspace's `voice-pick` route, which plays the recorded sample of one voice (null = no play buttons), the other job the command offers to change, and the change of ANY job of the workspace (the same patch). */
export type WhoExtra = { sampleEndpoint: string | null; target: WhoTarget | null; changeJob: ((jobId: string, patch: SpeaksPatch) => Promise<Reply<JobPatched>>) | null; /** The voices of the workspace's gender, the same list as the voice card (null = no voice list is drawn). */ voices?: readonly WhoVoiceName[] | null };

/** A card of the job page: the same white card as the Jobs list. */
export const jobCard = "rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] md:p-5";
export const jobH2 = "m-0 font-display text-[17px] font-bold leading-tight text-ink";
export const jobBtn = "jb-press write-ctl inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-4 text-[15px] font-semibold disabled:opacity-60";
export const jobBtnMain = `${jobBtn} border-brand-edge bg-brand text-on-brand`;
export const jobBtnQuiet = `${jobBtn} border-edge bg-surface text-ink`;
