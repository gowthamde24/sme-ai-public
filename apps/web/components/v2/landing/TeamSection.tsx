import { TeamIllustration } from "@/components/v2/landing/TeamIllustration";
import { container, h2, lead } from "@/components/v2/landing/ui";
import type { LandingT } from "@/i18n/landing";

const ROLES = ["main", "lead", "research", "requirement", "quote", "followup", "order"] as const;

export function TeamSection({ t }: { t: LandingT }) {
  return (
    <section id="team" aria-labelledby="team-h" className={`${container} scroll-mt-20 py-14 sm:py-20`}>
      <h2 id="team-h" className={h2}>{t("team.title")}</h2>
      <p className={lead}>{t("team.sub")}</p>
      <div className="mt-8 grid items-center gap-8 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)]">
          <TeamIllustration alt={t("team.alt")} />
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {ROLES.map((r) => (
            <li key={r} className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-display text-lg font-semibold">{t(`role.${r}.t`)}</h3>
              <p className="mt-1 text-sm text-muted">{t(`role.${r}.d`)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
