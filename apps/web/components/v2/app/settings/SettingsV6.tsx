import Link from "next/link";
import type { ReactNode } from "react";

import { LangSelect } from "@/components/v2/controls/LangSelect";
import { ThemeChoice, type ThemePick } from "@/components/v2/controls/ThemeChoice";
import type { Lang } from "@/i18n/lang";
import { CALL_LANG_NAMES, type CallLang } from "@/lib/assistant/types";
import type { ConnectionState } from "@/lib/api/whatsapp";

import { PageHeader } from "../ds/PageHeader";
import { StatusPill, type Status } from "../ds/StatusPill";
import { btnQuiet, pageMain } from "../ui";
import { card, sectionTitle } from "../v6/ui";
import { makeT, type Say, type Words } from "../words";

import { BusinessCardV6 } from "./BusinessCardV6";
import type { SettingsV6Data } from "@/app/app/tenants/[tenantId]/settings/settings-v6-data";

type Result = { ok: true } | { ok: false; error: string } | undefined;
export type SettingsV6Props = {
  words: Words;
  lang: Lang;
  base: string;
  title: string;
  /** helpTipFor(lang, base, "settings", true) */
  help: ReactNode;
  /** The Owner and Admin run the business: they edit it and see the connections. */
  admin: boolean;
  data: SettingsV6Data;
  /** The business name the workspace list already knows (shown when the profile could not be read). */
  tenantName: string;
  theme: ThemePick;
  langLabel: string;
  /** Settings > Notifications is a screen of app v4; null where it is not on. */
  notificationsHref: string | null;
  save: (prev: Result, formData: FormData) => Promise<Result>;
};

const WA_STATUS: Record<ConnectionState, Status> = { connected: "completed", connecting: "spam", needs_attention: "rejected", not_connected: "no_answer" };
const PHONE_STATUS: Record<"not_set_up" | "kyc_pending" | "active", Status> = { not_set_up: "no_answer", kyc_pending: "spam", active: "completed" };

/** One line of a card: what it is, its value (or "Not set yet"), and where its Edit goes (a screen that already does it). */
function Row({ t, label, value, note, href, status }: { t: Say; label: string; value: ReactNode | null; note?: string; href?: string | null; status?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5" data-part="settings-row">
      <div className="min-w-0 flex-1">
        <dt className="text-sm text-muted">{label}</dt>
        <dd className={`min-w-0 break-words text-base ${value === null ? "text-muted" : "font-semibold"}`}>
          {value === null ? (status ? null : t("sv6.na")) : value}
          {status ? <span className={value === null ? "" : "ml-2 align-middle"}>{status}</span> : null}
        </dd>
        {note ? <p className="mt-0.5 text-sm text-muted">{note}</p> : null}
      </div>
      {href ? (
        <Link href={href} aria-label={t("sv6.edit.for", { what: label })} className={btnQuiet}>
          {t("today.act.edit")}
        </Link>
      ) : null}
    </div>
  );
}

function Card({ id, title, edit, children }: { id: string; title: string; edit?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`sv6-${id}`} data-part={`settings-${id}`} className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id={`sv6-${id}`} className={sectionTitle}>
          {title}
        </h2>
        {edit}
      </div>
      {children}
    </section>
  );
}

/**
 * Settings of design system v6 (owner 13 Nov 2026): plain cards in the owner's order (Business, Team, Connections, Notifications, Language and theme, Privacy and data, Developer API keys), each showing what is set with an Edit that opens the screen that already does it. Nothing is
 * invented: a value that cannot be read says "Not set yet". ONE place edits here: the Business card (name and city, with one "Publish"); everything else is changed on its own screen. The old tabbed Settings stays at `?section=...`. Privacy and data lines are human-only drafts and
 * start no deletion or export from this page. Developer API keys are test mode only: no key is ever shown.
 */
export function SettingsV6({ words, lang, base, title, help, admin, data, tenantName, theme, langLabel, notificationsHref, save }: SettingsV6Props) {
  const t = makeT(words);
  const settings = `${base}/settings`;
  const biz = data.business;
  const members = data.team;
  const approvers = members?.filter((m) => m.role === "owner" || m.role === "admin") ?? [];
  const named = (m: { name: string | null }) => m.name ?? t("sv6.team.unnamed");
  return (
    <main className={pageMain} lang={lang} data-part="settings-v6">
      <PageHeader title={title} sub={t("sv6.sub")} right={help} />
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BusinessCardV6 words={words} name={biz?.name ?? tenantName} city={biz?.city ?? null} languages={biz?.languages ?? []} canEdit={admin && biz !== null} save={save}>
          <dl className="divide-y divide-line">
            <Row t={t} label={t("sv6.biz.timings")} value={null} note={admin ? t("sv6.biz.timings.where") : undefined} href={admin ? `${base}/my-assistant?tab=knowledge` : null} />
            <Row t={t} label={t("sv6.biz.gst")} value={data.gstin ?? null} href={admin ? `${settings}?section=business` : null} />
            <Row t={t} label={t("sv6.biz.logo")} value={biz?.logoUrl ? t("sv6.biz.logo.set") : null} href={admin ? `${settings}?section=business` : null} />
          </dl>
        </BusinessCardV6>

        <Card id="team" title={t("sv6.team.title")} edit={<Link href={`${base}/team`} aria-label={t("sv6.edit.for", { what: t("sv6.team.title") })} className={btnQuiet}>{t("today.act.edit")}</Link>}>
          {members === null ? (
            <p className="mt-2 text-base text-muted">{t("sv6.na")}</p>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted">{members.length === 1 ? t("sv6.team.one") : t("sv6.team.many", { n: members.length })}</p>
              <ul className="mt-1 divide-y divide-line">
                {members.slice(0, 6).map((m, i) => (
                  <li key={i} className="flex min-w-0 items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-base font-semibold" data-name="">
                      {named(m)}
                    </span>
                    <span className="shrink-0 text-sm text-muted">{t(`team.role.${m.role}`)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <dl className="mt-2 border-t border-line">
            <Row t={t} label={t("sv6.team.approve")} value={approvers.length > 0 ? t("sv6.team.approve.names", { names: approvers.map(named).join(", ") }) : null} note={t("sv6.team.approve.text")} href={admin ? `${base}/quote-policy` : null} />
          </dl>
        </Card>

        <Card id="connections" title={t("sv6.con.title")}>
          {admin ? (
            <dl className="divide-y divide-line">
              <Row
                t={t}
                label={t("sv6.con.wa")}
                value={data.whatsapp?.phone ?? null}
                status={data.whatsapp ? <StatusPill status={WA_STATUS[data.whatsapp.state]}>{t(`wa.state.${data.whatsapp.state}`)}</StatusPill> : null}
                href={`${base}/integrations/whatsapp`}
              />
              <Row t={t} label={t("sv6.con.sources")} value={data.sources ? (data.sources.active > 0 ? t("sv6.con.sources.n", { n: data.sources.active }) : null) : null} href={`${base}/lead-sources`} />
              <Row
                t={t}
                label={t("sv6.con.number")}
                value={data.phone?.number ?? null}
                status={data.phone ? <StatusPill status={PHONE_STATUS[data.phone.state]}>{t(`phv6.state.${data.phone.state}`)}</StatusPill> : null}
                href={`${base}/phone-number`}
              />
              <Row t={t} label={t("settings.biz.phone")} value={biz?.phone ?? null} href={`${settings}?section=business`} />
              <Row t={t} label={t("sv6.con.rules")} value={null} note={t("sv6.con.rules.text")} href={`${base}/my-assistant?tab=rules`} />
            </dl>
          ) : (
            <p className="mt-2 text-base text-muted">{t("sv6.con.admins")}</p>
          )}
        </Card>

        <Card id="notifications" title={t("sv6.not.title")} edit={notificationsHref ? <Link href={notificationsHref} aria-label={t("sv6.edit.for", { what: t("sv6.not.title") })} className={btnQuiet}>{t("today.act.edit")}</Link> : null}>
          <p className="mt-2 text-base text-muted">{t("sv6.not.text")}</p>
        </Card>

        <Card id="language" title={t("sv6.lang.title")}>
          <div className="mt-3 flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-sm text-muted">{t("settings.language.language")}</p>
              <LangSelect lang={lang} label={langLabel} />
            </div>
            <div>
              <p className="mb-1.5 text-sm text-muted">{t("settings.language.appearance")}</p>
              <ThemeChoice initial={theme} label={t("settings.language.appearance")} words={{ system: t("settings.theme.system"), light: t("settings.theme.light"), dark: t("settings.theme.dark") }} />
            </div>
            {biz && biz.languages.length > 0 ? (
              <p className="text-sm text-muted">
                {t("sv6.lang.speaks")}: <span className="font-semibold text-ink">{biz.languages.map((l) => CALL_LANG_NAMES[l as CallLang] ?? l).join(", ")}</span>
              </p>
            ) : null}
          </div>
        </Card>

        <Card id="privacy" title={t("sv6.priv.title")} edit={<Link href={`${settings}?section=privacy`} className={btnQuiet}>{t("sv6.priv.open")}</Link>}>
          <p role="note" className="mt-2 text-sm text-muted">
            {t("sv6.priv.draft")}
          </p>
          <ul className="mt-1 divide-y divide-line">
            {(["export", "delete", "consent"] as const).map((k) => (
              <li key={k} className="py-2.5" data-part={`privacy-${k}`}>
                <p className="text-base font-semibold">{t(`sv6.priv.${k}`)}</p>
                <p className="text-sm text-muted">{t(`sv6.priv.${k}.text`)}</p>
              </li>
            ))}
          </ul>
        </Card>

        {admin ? (
          <Card id="developer" title={t("sv6.dev.title")} edit={<span className="rounded-full border border-line bg-surface-2 px-3 py-1 text-sm font-semibold text-muted">{t("sv6.dev.test")}</span>}>
            <p className="mt-2 text-base text-muted">{t("sv6.dev.text")}</p>
            <p className="mt-2 text-base font-semibold text-muted" data-part="dev-none">
              {t("sv6.dev.none")}
            </p>
            <button type="button" disabled aria-disabled="true" className={`${btnQuiet} mt-3`}>
              {t("sv6.dev.create")}
            </button>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
