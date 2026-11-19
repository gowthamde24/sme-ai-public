import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { ConnectionState } from "@/lib/api/whatsapp";
import type { SettingsV6Data } from "@/app/app/tenants/[tenantId]/settings/settings-v6-data";

import { JobChip, type JobTone } from "../ds/JobChip";
import { btnQuiet } from "../ui";
import { card, sectionTitle } from "../v6/ui";
import type { Say } from "../words";

const WA_TONE: Record<ConnectionState, JobTone> = { connected: "done", connecting: "wait", needs_attention: "fail", not_connected: "info" };
const PHONE_TONE: Record<"not_set_up" | "kyc_pending" | "active", JobTone> = { not_set_up: "info", kyc_pending: "wait", active: "done" };

/** One connection as one sentence, its state as the solid chip and ONE button that opens the screen that already does it (the same screens the Edit buttons of before opened). */
function Line({ what, href, action, children, chip }: { what: string; href: string; action: string; children: ReactNode; chip?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3" data-part="connection">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[16px] leading-snug text-ink">{children}</p>
        {chip ? <p className="m-0 mt-1.5">{chip}</p> : null}
      </div>
      <Link href={href} aria-label={`${action}: ${what}`} className={btnQuiet}>
        {action}
      </Link>
    </li>
  );
}

/**
 * Settings > Connections under JOBS (the simplicity pass): each connection is one sentence and one button ("WhatsApp is connected on +91 98765 43210." [Manage]), its state a solid chip. The four that matter every day are in view; the business phone and the
 * rule for calls put through to you are under "More choices" (a plain details, no script). Nothing new is connected here: every button opens the screen that does it, as before, and Connect with Facebook stays on the WhatsApp screen as built.
 * Only the owner and the admins see the connections; everybody else gets the same sentence as before.
 */
export function ConnectionsSimple({ t, base, settings, admin, data, bizPhone }: { t: Say; base: string; settings: string; admin: boolean; data: SettingsV6Data; bizPhone: string | null }) {
  const wa = data.whatsapp;
  const phone = data.phone;
  const sources = data.sources;
  return (
    <section aria-labelledby="sv6-connections" data-part="settings-connections" data-simple="" className={card}>
      <h2 id="sv6-connections" className={sectionTitle}>
        {t("sv6.con.title")}
      </h2>
      {admin ? (
        <>
          <ul className="mt-1 divide-y divide-line">
            <Line
              what={t("sv6.con.wa")}
              href={`${base}/integrations/whatsapp`}
              action={wa?.state === "connected" ? t("jobs.set.b.con.manage") : t("jobs.set.b.con.connect")}
              chip={wa ? <JobChip tone={WA_TONE[wa.state]}>{t(`wa.state.${wa.state}`)}</JobChip> : null}
            >
              {wa === null ? t("jobs.set.b.con.wa.unknown") : wa.phone ? t("jobs.set.b.con.wa.line", { phone: wa.phone }) : t("jobs.set.b.con.wa.none")}
            </Line>
            <Line what={t("sv6.con.templates")} href={`${base}/chats/templates`} action={t("jobs.set.b.con.open")}>
              {data.templates ? t("jobs.set.b.con.templates.line", { approved: data.templates.approved, review: data.templates.review }) : t("jobs.set.b.con.templates.unknown")}
            </Line>
            <Line what={t("sv6.con.sources")} href={`${base}/lead-sources`} action={sources && sources.active > 0 ? t("jobs.set.b.con.open") : t("jobs.set.b.con.connect")}>
              {sources === null ? t("jobs.set.b.con.sources.unknown") : sources.active > 0 ? t("jobs.set.b.con.sources.line", { n: sources.active }) : t("jobs.set.b.con.sources.none")}
            </Line>
            <Line
              what={t("sv6.con.number")}
              href={`${base}/phone-number`}
              action={phone?.state === "active" ? t("jobs.set.b.con.manage") : t("jobs.set.b.con.setup")}
              chip={phone ? <JobChip tone={PHONE_TONE[phone.state]}>{t(`phv6.state.${phone.state}`)}</JobChip> : null}
            >
              {phone === null ? t("jobs.set.b.con.number.unknown") : phone.number ? t("jobs.set.b.con.number.line", { number: phone.number }) : t("jobs.set.b.con.number.none")}
            </Line>
          </ul>
          <details data-part="more-choices" className="group mt-2 rounded-xl border border-line px-3.5 py-1">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">
                <span className="block font-display text-[16px] font-bold leading-tight text-ink">{t("jobs.set.b.more")}</span>
                <span className="block text-sm text-muted">{t("jobs.set.b.con.more_sub")}</span>
              </span>
              <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <ul className="divide-y divide-line pb-2">
              <Line what={t("settings.biz.phone")} href={`${settings}?section=business`} action={t("today.act.edit")}>
                {bizPhone ? t("jobs.set.b.con.biz.line", { phone: bizPhone }) : t("jobs.set.b.con.biz.none")}
              </Line>
              <Line what={t("sv6.con.rules")} href={`${base}/ai-team/training?section=rules`} action={t("jobs.set.b.con.open")}>
                {t("sv6.con.rules.text")}
              </Line>
            </ul>
          </details>
        </>
      ) : (
        <p className="mt-2 text-base text-muted">{t("sv6.con.admins")}</p>
      )}
    </section>
  );
}
