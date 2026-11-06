import { DEMO_LANGS } from "./lines";

/**
 * The seven-language band (landing v2 part B.3): the greetings in huge outlined type, drifting; a filled copy shows only through a soft window in the middle, so the word passing the centre glows orange. CSS only (design/home2.css);
 * with "reduce motion" it stands still. The words are the greetings themselves, each marked with its language; the second, lit copy is hidden from screen readers.
 */
export function GreetingsBand({ label, line }: { label: string; line: string }) {
  const words = [...DEMO_LANGS, ...DEMO_LANGS];
  const track = (lit: boolean) => (
    <div className="h2-gtrack" aria-hidden={lit ? "true" : undefined}>
      {words.map((l, i) => (
        <span key={i} className="h2-gw" lang={l.code} aria-hidden={i >= DEMO_LANGS.length ? "true" : undefined}>
          {l.word}
        </span>
      ))}
    </div>
  );
  return (
    <section aria-label={label} className="overflow-hidden pb-2 pt-10 lg:pt-16" data-part="greetings">
      <div className="h2-gband">
        {track(false)}
        <div className="h2-gspot" aria-hidden="true">
          {track(true)}
        </div>
      </div>
      <p className="mx-auto mt-3.5 max-w-[1240px] px-4 text-center text-base text-muted lg:px-8">{line}</p>
    </section>
  );
}
