import { PlushStill } from "@/components/v2/app/owl/PlushStill";
import { HELPER_AGENTS } from "@/components/v2/app/owl/plush-rig";
import type { HowStep } from "@/components/v2/site/HowSteps";
import type { SiteT } from "@/i18n/site";

const SIX = [1, 2, 3, 4, 5, 6] as const;

/** The six steps (the core revenue engine, one helper for each; Agent OWL leads them and is not a step) in the shared words (home.how.N.*) with each helper's name: the home page and /how-it-works read the same list, so they cannot drift apart. */
export function sixSteps(t: SiteT): HowStep[] {
  return SIX.map((n) => ({ n: String(n), owl: HELPER_AGENTS[n - 1], picture: <PlushStill agent={HELPER_AGENTS[n - 1]} px={72} className="size-[72px]" />, helper: t(`owl.name.${HELPER_AGENTS[n - 1] as "lead_finder"}`), title: t(`home.how.${n}.t`), text: t(`home.how.${n}.d`), you: t(`home.how.${n}.y`) }));
}

/** Agent OWL heading the six steps as the team lead: the one owl that is not a step. A server component with no script. */
export function TeamLead({ t }: { t: SiteT }) {
  return (
    <div data-part="team-lead" className="flex items-center gap-4 rounded-2xl border border-brand-edge bg-brand-bg p-4 sm:p-5">
      <PlushStill agent="main" px={96} className="size-20 sm:size-24" />
      <div className="min-w-0">
        <p className="text-lg font-extrabold leading-tight text-brand-text">{t("owl.name.main")}</p>
        <p className="mt-1 text-base text-ink">{t("home.how.lead")}</p>
      </div>
    </div>
  );
}
