import { JobChip } from "../ds/JobChip";

/** The short "Started" toast: the solid Done chip (the one shape of Jobs), at the bottom above the phone tabs, fading and rising in with transform and opacity only. */
export function StartedToast({ label }: { label: string }) {
  return (
    <div role="status" data-part="started-toast" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 md:bottom-8">
      <span className="jb-enter rounded-full shadow-[var(--v2-shadow)]">
        <JobChip tone="done" className="!h-10 !px-4 !text-[15px]">
          {label}
        </JobChip>
      </span>
    </div>
  );
}
