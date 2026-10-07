import { container } from "@/components/v2/landing/ui";
import { Wordmark } from "@/components/v2/Wordmark";
import type { LandingKey, LandingT } from "@/i18n/landing";

const LINKS: [string, LandingKey][] = [
  ["#how", "nav.how"],
  ["#control", "nav.control"],
  ["#privacy", "nav.privacy"],
  ["#faq", "nav.faq"],
];
const PLACEHOLDERS = ["foot.privacy", "foot.terms", "foot.contact"] as const;
const row = "inline-flex min-h-11 min-w-11 items-center text-sm font-medium text-ink";

export function Footer({ t }: { t: LandingT }) {
  return (
    <footer className="border-t border-line bg-surface">
      <div className={`${container} grid gap-8 py-10 md:grid-cols-3`}>
        <div>
          <Wordmark />
          <p className="mt-3 text-sm text-muted">{t("foot.note")}</p>
        </div>
        <nav aria-label={t("foot.sections")}>
          <ul className="flex flex-col">
            {LINKS.map(([href, k]) => (
              <li key={href}>
                <a href={href} className={`${row} hover:underline`}>{t(k)}</a>
              </li>
            ))}
          </ul>
        </nav>
        {/* plain text, not links: the pages do not exist yet and the labels say so ("(placeholder)") */}
        <ul className="flex flex-col">
          {PLACEHOLDERS.map((k) => (
            <li key={k}>
              <span className={`${row} text-muted`}>{t(k)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className={`${container} border-t border-line py-5 text-sm text-muted`}>{t("foot.copy")}</p>
    </footer>
  );
}
