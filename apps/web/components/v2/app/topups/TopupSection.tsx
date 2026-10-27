import type { TopupsView } from "@/lib/topups/types";

import { surface } from "../ui";
import { makeT, type Words } from "../words";
import { LAZY_WORD_PREFIXES } from "./words";
import { alertSentence, topupAlert } from "./alert-text";
import { TopupControls } from "./LazyTopups";
import { TopupHistory } from "./TopupHistory";
import type { TopupActions, UpgradeTarget } from "./types";
import { UsageBars } from "./UsageBars";
import { WaitingCard } from "./WaitingCard";

/**
 * Settings > Plan > Usage and top-ups (night 4, part F2). Minutes and messages used and left in this period (two bars with numbers, the day each runs out at this pace), the notice at 80 and 100 percent, the leads that wait for
 * calls, the packs and the two switches (auto top-up and pay-per-use, both off until turned on), the upgrade with its pro-rata preview, and what was bought with the (fake) invoices. The numbers and the history are drawn on the
 * server with no script; the buttons and forms are one lazy chunk. `view` null = it could not be read ("Not available yet"). The AI itself is not counted here: it is included (fair use).
 */
export function TopupSection({ words, view, canChange, readOnly, mock, upgrades, currentName, actions, topupHref }: { words: Words; view: TopupsView | null; canChange: boolean; readOnly: boolean; mock: boolean; upgrades: readonly UpgradeTarget[]; currentName: string | null; actions: TopupActions; topupHref: string }) {
  const t = makeT(words);
  if (view === null)
    return (
      <section className={surface} aria-label={t("tu.title")} data-topups="unavailable">
        <p className="text-sm text-muted">{t("tu.unavailable")}</p>
      </section>
    );
  const alert = topupAlert(view.usage);
  const controlWords = Object.fromEntries(Object.entries(words).filter(([k]) => LAZY_WORD_PREFIXES.some((p) => k.startsWith(p))));
  return (
    <div className="flex flex-col gap-5" id="topups" data-settings="topups">
      <section className={surface} aria-labelledby="tu-h">
        <h2 id="tu-h" className="font-display text-xl font-semibold">
          {t("tu.title")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("tu.sub")}</p>
        {mock ? (
          <p role="note" className="mt-3 rounded-lg border border-amber-text bg-amber-bg px-3 py-2 text-sm font-medium text-amber-text">
            {t("tu.testmode")}
          </p>
        ) : null}
        <div className="mt-4">
          <UsageBars words={words} usage={view.usage} />
        </div>
        {alert ? (
          <p role={alert.level === 100 ? "alert" : "status"} className={`mt-3 rounded-lg border px-3 py-2 text-sm font-medium ${alert.level === 100 ? "border-red-text bg-red-bg text-red-text" : "border-amber-text bg-amber-bg text-amber-text"}`}>
            {alertSentence(t, alert)}
          </p>
        ) : null}
      </section>
      {view.usage.queuedCalls > 0 ? <WaitingCard words={words} waiting={view.usage.queuedCalls} href={topupHref} canBuy={canChange && !readOnly} /> : null}
      <TopupControls words={controlWords} packs={view.packs} settings={view.settings} upgrades={upgrades} currentName={currentName} canChange={canChange} readOnly={readOnly} mock={mock} actions={actions} />
      <section className={surface} aria-labelledby="tu-record-h">
        <h2 id="tu-record-h" className="font-display text-xl font-semibold">
          {t("tu.record.title")}
        </h2>
        <div className="mt-3">
          <TopupHistory words={words} history={view.history} invoices={view.invoices} />
        </div>
      </section>
    </div>
  );
}
