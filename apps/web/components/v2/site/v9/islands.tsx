import type { SiteKey, SiteT } from "@/i18n/site";
import { VOICES, WA } from "@/lib/site/v9-data";

import { Phone as PhoneClient } from "./clients";
import type { TryPlan } from "./below";
import { FaqClient, HowDemoClient, JobsClient, TryItClient, VoicesClient } from "./lazy";

/**
 * The server side of the home page's islands (landing v9): each reads its words from the string store and hands them to the client component as plain props, so no dictionary reaches the browser.
 * The sample conversations and voices are demo content (lib/site/v9-data.ts), the same in every site language.
 */
const k = (s: string) => s as SiteKey;
const words = (t: SiteT) => ({ online: t(k("v9.phone.online")), message: t(k("v9.phone.message")), today: t(k("v9.phone.today")), live: t(k("v9.phone.live")), ended: t(k("v9.phone.ended")), ai: t(k("v9.phone.ai")) });

export function Phone({ t, id, still }: { t: SiteT; id: string; still: boolean }) {
  return <PhoneClient id={id} still={still} lang="te" demo={WA.te} words={words(t)} />;
}

export function HowDemo({ t }: { t: SiteT }) {
  const w = (n: string) => t(k(`v9.how.w.${n}`));
  return <HowDemoClient w={{ tabs: w("tabs"), phone: words(t), asked: w("asked"), language: w("language"), followUp: w("followup"), status: w("status"), added: w("added") }} />;
}

const PLAN_KEYS = ["enquiry", "visits", "demo", "testdrive", "finder"] as const;
export function TryIt({ t }: { t: SiteT }) {
  const w = (n: string) => t(k(`v9.try.w.${n}`));
  const plans: TryPlan[] = PLAN_KEYS.map((key) => {
    const f = (n: string) => t(k(`v9.try.${key}.${n}`));
    return { key, chip: f("chip"), prompt: f("prompt"), who: f("who"), say: f("say"), when: f("when"), cost: f("cost") };
  });
  return <TryItClient w={{ ask: w("ask"), draft: w("draft"), preview: w("preview"), who: w("who"), says: w("says"), when: w("when"), cost: w("cost"), cta: w("cta"), plans }} />;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
export function Voices({ t }: { t: SiteT }) {
  const labels: Record<string, string> = {};
  for (const v of VOICES) for (const s of [v.ind, v.group, v.dir]) labels[s] = t(k(`v9.voices.l.${slug(s)}`));
  return <VoicesClient w={{ tabs: t(k("v9.voices.w.tabs")), soon: t(k("v9.voices.w.soon")), labels, voices: VOICES }} />;
}

const ICONS = { answer: ["phone", "chat", "list"], followup: ["at", "chat", "clock"] } as const;
export function JobsDemo({ t }: { t: SiteT }) {
  const jobs = (["answer", "followup"] as const).map((key) => ({
    key,
    tab: t(k(`v9.jobs.${key}.tab`)),
    title: t(k(`v9.jobs.${key}.title`)),
    checks: [0, 1, 2].map((i) => t(k(`v9.jobs.${key}.c${i}`))),
    vis: [0, 1, 2].map((i) => ({ icon: ICONS[key][i], small: t(k(`v9.jobs.${key}.v${i}s`)), strong: t(k(`v9.jobs.${key}.v${i}t`)) })),
  }));
  return <JobsClient w={{ tabs: t(k("v9.jobs.w.tabs")), jobs }} />;
}

/** What a late call-back costs, as two plain rows (no metaphor: every word says what happens). */
export function Pipe({ t }: { t: SiteT }) {
  return (
    <div className="cmp" data-part="late-callback">
      <p className="cmp-enq">
        <b>{t(k("v9.cmp.time"))}</b> {t(k("v9.cmp.enq"))}
      </p>
      <div className="cmp-row">
        <small>{t(k("v9.cmp.without"))}</small>
        <p>{t(k("v9.cmp.without.t"))}</p>
      </div>
      <div className="cmp-row is-with">
        <small>{t(k("v9.cmp.with"))}</small>
        <p>{t(k("v9.cmp.with.t"))}</p>
      </div>
    </div>
  );
}

export function Faq({ t }: { t: SiteT }) {
  return <FaqClient items={[0, 1, 2, 3, 4].map((i) => ({ q: t(k(`v9.faq.q${i}`)), a: t(k(`v9.faq.a${i}`)) }))} />;
}

