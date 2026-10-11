/**
 * Day and month names for the languages the app speaks, written out here (job BE). The browser's own Intl data differs from the server's: Node and Chrome spell October in Hindi differently ("अक्तू॰" and "अक्टू॰"), so a date
 * the SERVER wrote and the browser then formatted for itself made React throw a hydration mismatch (the Outbox in Hindi). A date in these words is the same text on both sides, whatever the runtime's ICU data. The names are
 * the ones the browsers use today. Pure data and pure functions: no Intl.
 */
export type DateLang = "en" | "te" | "hi" | "kn";
type Names = { monthShort: readonly string[]; monthLong: readonly string[]; weekdayShort: readonly string[]; weekdayLong: readonly string[] };

const NAMES: Record<DateLang, Names> = {
  en: {
    monthShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"],
    monthLong: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    weekdayShort: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    weekdayLong: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  },
  te: {
    monthShort: ["జన", "ఫిబ్ర", "మార్చి", "ఏప్రి", "మే", "జూన్", "జులై", "ఆగ", "సెప్టెం", "అక్టో", "నవం", "డిసెం"],
    monthLong: ["జనవరి", "ఫిబ్రవరి", "మార్చి", "ఏప్రిల్", "మే", "జూన్", "జులై", "ఆగస్టు", "సెప్టెంబర్", "అక్టోబర్", "నవంబర్", "డిసెంబర్"],
    weekdayShort: ["సోమ", "మంగళ", "బుధ", "గురు", "శుక్ర", "శని", "ఆది"],
    weekdayLong: ["సోమవారం", "మంగళవారం", "బుధవారం", "గురువారం", "శుక్రవారం", "శనివారం", "ఆదివారం"],
  },
  hi: {
    monthShort: ["जन॰", "फ़र॰", "मार्च", "अप्रैल", "मई", "जून", "जुल॰", "अग॰", "सित॰", "अक्टू॰", "नव॰", "दिस॰"],
    monthLong: ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"],
    weekdayShort: ["सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि", "रवि"],
    weekdayLong: ["सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार", "रविवार"],
  },
  kn: {
    monthShort: ["ಜನ", "ಫೆಬ್ರ", "ಮಾರ್ಚ್", "ಏಪ್ರಿ", "ಮೇ", "ಜೂನ್", "ಜುಲೈ", "ಆಗ", "ಸೆಪ್ಟೆಂ", "ಅಕ್ಟೋ", "ನವೆಂ", "ಡಿಸೆಂ"],
    monthLong: ["ಜನವರಿ", "ಫೆಬ್ರವರಿ", "ಮಾರ್ಚ್", "ಏಪ್ರಿಲ್", "ಮೇ", "ಜೂನ್", "ಜುಲೈ", "ಆಗಸ್ಟ್", "ಸೆಪ್ಟೆಂಬರ್", "ಅಕ್ಟೋಬರ್", "ನವೆಂಬರ್", "ಡಿಸೆಂಬರ್"],
    weekdayShort: ["ಸೋಮ", "ಮಂಗಳ", "ಬುಧ", "ಗುರು", "ಶುಕ್ರ", "ಶನಿ", "ಭಾನು"],
    weekdayLong: ["ಸೋಮವಾರ", "ಮಂಗಳವಾರ", "ಬುಧವಾರ", "ಗುರುವಾರ", "ಶುಕ್ರವಾರ", "ಶನಿವಾರ", "ಭಾನುವಾರ"],
  },
};

const known = (lang: string): DateLang => (lang === "te" || lang === "hi" || lang === "kn" ? lang : "en");

export type DateOpts = { weekday?: "short" | "long"; month: "short" | "long"; year?: boolean };

/** A date as the language writes it: English "Wed, 14 Oct 2026"; Telugu "14 అక్టో 2026, బుధ"; Hindi and Kannada "बुध, 14 अक्टू॰ 2026". `monthIndex` is 0 to 11, `weekdayIndex` is 0 = Monday. */
export function dateText(lang: string, y: number, monthIndex: number, day: number, weekdayIndex: number, o: DateOpts): string {
  const l = known(lang);
  const n = NAMES[l];
  const month = (o.month === "long" ? n.monthLong : n.monthShort)[monthIndex];
  const core = `${day} ${month}${o.year ? ` ${y}` : ""}`;
  if (!o.weekday) return core;
  const wd = (o.weekday === "long" ? n.weekdayLong : n.weekdayShort)[weekdayIndex];
  return l === "te" ? `${core}, ${wd}` : `${wd}, ${core}`;
}

/** The same for a calendar day (year, month 1 to 12, day): the weekday is worked out. */
export function dayText(lang: string, y: number, month: number, day: number, o: DateOpts): string {
  const wd = (new Date(Date.UTC(y, month - 1, day)).getUTCDay() + 6) % 7;
  return dateText(lang, y, month - 1, day, wd, o);
}

/** The name of a weekday (0 = Monday), long or short. */
export const weekdayWord = (lang: string, index: number, style: "short" | "long" = "long"): string => (style === "long" ? NAMES[known(lang)].weekdayLong : NAMES[known(lang)].weekdayShort)[index];
