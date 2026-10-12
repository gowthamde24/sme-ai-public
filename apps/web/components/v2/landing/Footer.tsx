import { container } from "@/components/v2/landing/ui";
import { Wordmark } from "@/components/v2/Wordmark";
import { LegalLinks } from "@/components/v2/legal/LegalLinks";
import type { LandingKey, LandingT } from "@/i18n/landing";
import type { Lang } from "@/i18n/lang";

const LINKS: [string, LandingKey][] = [
  ["#shop", "nav.shop"],
  ["#whatsapp", "nav.whatsapp"],
  ["#how", "nav.how"],
  ["#languages", "nav.languages"],
  ["#privacy", "nav.privacy"],
  ["#pricing", "nav.pricing"],
  ["#faq", "nav.faq"],
];
const row = "inline-flex min-h-11 min-w-11 items-center text-sm font-medium text-ink";

export function Footer({ t, lang }: { t: LandingT; lang: Lang }) {
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
        {/* Privacy Policy, Terms and Cookie settings (job BH); Contact stays a plain label until the owner gives an address */}
        <div>
          <LegalLinks lang={lang} direction="column" />
          <span className={`${row} text-muted`}>{t("foot.contact")}</span>
        </div>
      </div>
      <p className={`${container} border-t border-line py-5 text-sm text-muted`}>{t("foot.copy")}</p>
    </footer>
  );
}
