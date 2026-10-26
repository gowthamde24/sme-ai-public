import Link from "next/link";

import type { ConsentList } from "@/lib/api/consent-list";
import type { Deletion, DataExport } from "@/lib/api/privacy";
import type { Part } from "@/lib/api/part";

import { card, h2 } from "../cc/kit";
import { PartProblem } from "../cc/PartProblem";
import { link, listPlain } from "../ui";
import { makeT, type Words } from "../words";
import { ConsentListView } from "./ConsentList";
import { DeleteData, ExportMyData } from "../settings/LazyTabs";
import type { PrivacyActions } from "./types";

/**
 * The "Privacy" part of Settings (job CC, screen 2): download my data, delete my account (and the workspace, for the Owner), the consent and opt-out list, and the two older pages (erasing a customer's personal data; the
 * do-not-contact keys). Each part was read on its own: one that could not be read says so in its place (refused, too many tries, or not loaded) and the rest works.
 */
export function PrivacySection({ tenantId, words, role, email, workspaceName, exports, myDeletions, workspaceDeletions, consent, actions, now }: { tenantId: string; words: Words; role: string; email: string; workspaceName: string; exports: Part<DataExport[]>; myDeletions: Part<Deletion[]>; workspaceDeletions: Part<Deletion[]> | null; consent: Part<ConsentList> | null; actions: PrivacyActions; now: number }) {
  const t = makeT(words);
  const isOwner = role === "owner";
  const admin = isOwner || role === "admin";
  const base = `/app/tenants/${tenantId}`;
  const latest = (list: Deletion[]): Deletion | null => list.find((d) => d.status === "scheduled") ?? list.find((d) => d.status === "blocked") ?? null;
  const mine = myDeletions.ok ? latest(myDeletions.data.filter((d) => d.kind === "account")) : null;
  const space = workspaceDeletions?.ok ? latest(workspaceDeletions.data.filter((d) => d.kind === "workspace")) : null;
  return (
    <div className="flex flex-col gap-5" data-settings="privacy">
      {exports.ok ? <ExportMyData words={words} actions={actions} initial={exports.data} isOwner={isOwner} /> : <PartProblem kind={exports.kind} retryAfter={exports.retryAfter} words={words} title={t("prx.exp.title")} />}
      {myDeletions.ok && (!isOwner || workspaceDeletions?.ok !== false) ? (
        <DeleteData words={words} actions={actions} email={email} workspaceName={workspaceName} isOwner={isOwner} accountDeletion={mine} workspaceDeletion={space} now={now} />
      ) : (
        <PartProblem kind={myDeletions.ok ? (workspaceDeletions && !workspaceDeletions.ok ? workspaceDeletions.kind : "other") : myDeletions.kind} retryAfter={myDeletions.ok ? undefined : myDeletions.retryAfter} words={words} title={t("prx.del.account.title")} />
      )}
      {consent ? consent.ok ? <ConsentListView tenantId={tenantId} words={words} list={consent.data} /> : <PartProblem kind={consent.kind} retryAfter={consent.retryAfter} words={words} title={t("prx.consent.title")} /> : null}
      <section className={card} aria-labelledby="prx-more-h">
        <h2 id="prx-more-h" className={h2}>
          {t("prx.more.title")}
        </h2>
        <ul className={listPlain}>
          {admin ? (
            <li>
              <Link href={`${base}/privacy`} className={link}>
                {t("settings.privacy.erasure")}
              </Link>
            </li>
          ) : null}
          {isOwner ? (
            <li>
              <Link href={`${base}/suppression`} className={link}>
                {t("settings.privacy.suppression")}
              </Link>
            </li>
          ) : null}
        </ul>
        {admin ? null : <p className="text-sm text-muted">{t("settings.privacy.note")}</p>}
      </section>
    </div>
  );
}
