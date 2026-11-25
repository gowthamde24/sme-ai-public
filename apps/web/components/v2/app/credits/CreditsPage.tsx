import Link from "next/link";

import type { Statement as StatementData, Topup, TopupOptions } from "@/lib/api/credits";
import type { BillingBalance } from "@/lib/billing-v6/balance";

import { AddCredits } from "./AddCredits";
import { LowBalance } from "./LowBalance";
import { Statement } from "./Statement";
import { PageTop } from "../parts";
import { pageMain } from "../ui";
import { makeT, type Words } from "../words";

type Actions = React.ComponentProps<typeof AddCredits>["actions"] & { statement: React.ComponentProps<typeof Statement>["load"] };

/**
 * Credits and billing (mock "Credits and billing"; C1's docs/contracts/credits-topup.md; flag CREDITS_SCREENS): the balance with how many minutes of calls it covers, the last top-up and Add credits (Owner), the low-balance line when the balance covers fewer than 4 minutes,
 * the statement, the invoices (one for each paid top-up, opened as a printable page) and a link to the billing details (the workspace name and GSTIN of Settings). Open rows between hairlines; nothing boxed. Admin sees everything and cannot add.
 */
export function CreditsPage({ words, lang, base, balance, options, topups, statement, owner, actions, help }: { words: Words; lang: string; base: string; balance: BillingBalance | null; options: TopupOptions | null; topups: readonly Topup[] | null; statement: StatementData | null; owner: boolean; actions: Actions; help: React.ReactNode }) {
  const t = makeT(words);
  const minutes = balance?.minutesEstimate ?? null;
  const last = topups?.find((x) => x.state === "paid") ?? null;
  const add = owner && options ? <AddCredits options={options} words={words} actions={actions} /> : null;
  return (
    <main className={pageMain} lang={lang} data-screen="credits">
      {help}
      <PageTop title={t("cr.title")} sub={t("cr.sub")} />
      <div className="mt-4 flex flex-col gap-4">
        {balance?.low && minutes !== null ? <LowBalance minutes={minutes} words={words} add={add} /> : null}
        <div className="flex flex-wrap items-end gap-x-9 gap-y-3 border-t border-ink pt-4" data-part="balance">
          <div>
            <p className="m-0 text-sm text-muted">{t("cr.balance")}</p>
            <p className="m-0 font-display text-[40px] font-bold leading-none tracking-tight text-ink">{balance?.text ?? "—"}</p>
            {minutes !== null ? <p className="m-0 mt-1 text-sm text-muted">{t("cr.minutes", { n: minutes })}</p> : null}
          </div>
          <div>
            <p className="m-0 text-sm text-muted">{t("cr.last")}</p>
            <p className="m-0 text-[22px] font-bold text-ink">{last ? last.addedText : t("cr.none")}</p>
          </div>
          {!balance?.low && add ? <div className="md:ml-auto">{add}</div> : null}
        </div>
        <p className="m-0 border-y border-line py-3 text-[15px] text-muted">{t("cr.note")}</p>

        <section aria-labelledby="cr-st">
          <h2 id="cr-st" className="m-0 mb-2 font-display text-xl font-semibold">
            {t("cr.statement")}
          </h2>
          {statement ? <Statement first={statement} words={words} base={base} load={actions.statement} /> : <p className="m-0 text-[15px] text-muted">{t("cr.err.unavailable")}</p>}
        </section>

        <section aria-labelledby="cr-inv">
          <h2 id="cr-inv" className="m-0 mb-2 font-display text-xl font-semibold">
            {t("cr.invoices")}
          </h2>
          {topups && topups.some((x) => x.invoiceNumber) ? (
            <ul className="m-0 flex list-none flex-col border-t border-ink p-0" data-part="invoices">
              {topups
                .filter((x) => x.invoiceNumber)
                .map((x) => (
                  <li key={x.orderId} className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-line py-3">
                    <Link href={`${base}/billing/invoices/${x.invoiceNumber}`} className="text-[16px] font-semibold text-ink underline underline-offset-2">
                      {t("cr.invoice", { n: x.invoiceNumber ?? "" })}
                    </Link>
                    <span className="text-[15px] text-muted">
                      {x.totalText}
                      {x.refunded ? " · " + t("cr.kind.refund") : ""}
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="m-0 border-y border-line py-4 text-[15px] text-muted">{t("cr.invoices.none")}</p>
          )}
          {topups && topups.some((x) => x.state !== "paid") ? (
            <ul className="m-0 mt-3 flex list-none flex-col p-0" data-part="topup-attempts">
              {topups
                .filter((x) => x.state !== "paid")
                .slice(0, 3)
                .map((x) => (
                  <li key={x.orderId} className="py-1 text-[14px] text-muted">
                    {x.addedText} · {t(`cr.state.${x.state}` as "cr.state.pending")}
                    {x.failureText ? ` · ${x.failureText}` : ""}
                  </li>
                ))}
            </ul>
          ) : null}
        </section>

        <section aria-labelledby="cr-det">
          <h2 id="cr-det" className="m-0 mb-2 font-display text-xl font-semibold">
            {t("cr.details")}
          </h2>
          <p className="m-0 text-[15px] text-muted">{t("cr.details.t")}</p>
          <Link href={`${base}/settings?section=business`} className="mt-2 inline-flex min-h-11 items-center text-[15px] font-semibold text-ink underline underline-offset-4">
            {t("cr.details.go")}
          </Link>
        </section>
      </div>
    </main>
  );
}
