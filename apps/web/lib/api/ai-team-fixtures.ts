/**
 * My AI team v2's MADE-UP day (AI_TEAM_SCREENS=mock and the visual tests), in the contract's own wire shape (docs/contracts/ai-team.md) so the same parsers read it. Every name is invented and marked "(example)" where a person could
 * mistake it for real. Nothing here is a real row: the mock mode is for review and pictures only, never a workspace's own day.
 */
type Row = [helper: string, at: string, kind: string, label: string, ref: string, seconds?: number | null, needsOwner?: boolean];

const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ist = (date: string, hhmm: string): string => `${date}T${hhmm}:00+05:30`;

const BUSINESS: Row[] = [
  ["lead_catcher", "09:12", "lead_in", "Anjali Boutique (example) · website form", "lead"],
  ["lead_catcher", "09:40", "lead_in", "Sri Devi Sarees (example) · IndiaMART", "lead"],
  ["lead_catcher", "10:05", "lead_in", "Kavya Textiles (example) · e-mail", "lead"],
  ["lead_catcher", "11:30", "lead_in", "Meena Collections (example) · sheet", "lead"],
  ["lead_catcher", "12:48", "lead_in", "Lakshmi Silk House (example) · IndiaMART", "lead"],
  ["lead_catcher", "13:20", "lead_in", "Padma Weaves (example) · website form", "lead"],
  ["lead_finder", "09:30", "search", "Boutiques in Vijayawada", "prospect"],
  ["lead_finder", "09:34", "found", "18 boutiques found · 3 for you to check", "prospect", null, true],
  ["lead_finder", "11:10", "found", "Ravi Silk Centre (example) · called", "prospect"],
  ["caller", "09:15", "call", "Anjali Boutique (example) · interested", "lead", 184],
  ["caller", "09:52", "call", "Sri Devi Sarees (example) · no answer", "lead", 22],
  ["caller", "10:20", "call", "Kavya Textiles (example) · asked for you", "lead", 96, true],
  ["caller", "10:42", "call", "Ramesh K (example) · interested", "lead", 84],
  ["caller", "11:35", "call", "Meena Collections (example) · call back at 4", "lead", 61],
  ["caller", "12:10", "visit", "Padma Weaves (example) · store visit Sat 11:00", "visit"],
  ["caller", "12:55", "call", "Lakshmi Silk House (example) · interested", "lead", 142],
  ["caller", "13:30", "call", "Ravi Silk Centre (example) · not now", "lead", 38],
  ["followups", "10:00", "message", "Anjali Boutique (example) · catalogue sent", "lead"],
  ["followups", "11:00", "message", "Gowri Sarees (example) · reminder", "lead"],
  ["followups", "12:30", "message", "Sita Fashions (example) · price list", "lead"],
  ["followups", "16:00", "followup_due", "5 due · Meena Collections (example) first", "lead"],
  ["quote_writer", "11:05", "quote", "Quote 14 · Anjali Boutique (example) · for your OK", "quote", null, true],
  ["quote_writer", "12:40", "quote_approved", "Quote 13 · Ramesh K (example) · approved", "quote"],
  ["quote_writer", "13:05", "quote", "Quote 15 · Lakshmi Silk House (example)", "quote"],
  ["order_desk", "12:50", "order", "Order 9 · Ramesh K (example) · confirmed", "order"],
];
const SCHOOL: Row[] = [
  ["lead_catcher", "09:05", "lead_in", "Parent of Aarav (example) · website form", "lead"],
  ["lead_catcher", "10:15", "lead_in", "Parent of Diya (example) · phone", "lead"],
  ["lead_catcher", "12:20", "lead_in", "Parent of Kiran (example) · e-mail", "lead"],
  ["caller", "09:20", "call", "Parent of Aarav (example) · campus visit", "lead", 156],
  ["caller", "10:30", "call", "Parent of Diya (example) · asked for the principal", "lead", 74, true],
  ["caller", "12:35", "call", "Parent of Kiran (example) · no answer", "lead", 18],
  ["followups", "11:00", "message", "Parent of Meera (example) · fee structure sent", "lead"],
  ["followups", "16:30", "followup_due", "3 due · Parent of Diya (example) first", "lead"],
  ["admissions", "09:45", "visit", "Aarav (example) · campus visit Sat 10:00", "visit"],
  ["admissions", "11:40", "admission", "Meera (example) · Class 4 · admitted", "student"],
  ["fee_reminders", "10:00", "fee_reminder", "Term 2 reminder · 42 parents", "campaign"],
  ["fee_reminders", "12:15", "payment", "Rohan (example) · Term 2 paid", "student"],
  ["notices", "13:00", "notice", "Sports day notice · 310 parents", "campaign"],
];

const ORDER_BUSINESS = ["lead_catcher", "lead_finder", "caller", "followups", "quote_writer", "order_desk"];
const ORDER_SCHOOL = ["lead_catcher", "caller", "followups", "admissions", "fee_reminders", "notices"];

/** The made-up day, as the API would answer it. `now` is "HH:MM" India time (the marks after it are left out, except what is due later); `paused` switches helpers off. */
export function aiTeamDayFixture({ school = false, date, now = "14:12", paused = [] as readonly string[], past = false }: { school?: boolean; date: string; now?: string; paused?: readonly string[]; past?: boolean }) {
  const rows = (school ? SCHOOL : BUSINESS).map((r, i) => ({ r, i }));
  const helpers = school ? ORDER_SCHOOL : ORDER_BUSINESS;
  const lanes = helpers.map((helper) => {
    const mine = rows.filter(({ r }) => r[0] === helper && (past || r[2] === "followup_due" || r[1] <= now));
    const marks = mine.map(({ r, i }) => ({ id: `fixture:${ID(i + 1)}`, t: ist(date, r[1]), kind: r[2], seconds: r[5] ?? null, label: r[3], ref: { type: r[4], id: ID(i + 1), href: "" }, needs_owner: !past && r[6] === true }));
    const waiting = marks.filter((m) => m.needs_owner).length;
    const off = paused.includes(helper);
    const status = past
      ? null
      : off
        ? { kind: "paused", text_key: "paused", count: waiting, at: null, who: null, since: ist(date, "11:00") }
        : helper === "caller" && !school
          ? { kind: "busy", text_key: "on_call", count: null, at: null, who: "Ramesh K (example)", since: ist(date, now) }
          : helper === "followups"
            ? { kind: "due", text_key: "due_next", count: school ? 3 : 5, at: ist(date, school ? "16:30" : "16:00"), who: null, since: null }
            : waiting > 0
              ? { kind: "waiting", text_key: "waiting_for_you", count: waiting, at: null, who: null, since: null }
              : { kind: "idle", text_key: "idle", count: null, at: null, who: null, since: null };
    return { helper, enabled: !off, status_now: status, count_today: marks.filter((m) => m.kind !== "followup_due").length, marks };
  });
  const n = (kinds: string[]) => lanes.flatMap((l) => l.marks).filter((m) => kinds.includes(m.kind)).length;
  return {
    date,
    now: ist(date, now),
    day: { opens: "09:00", closes: "20:00", source: "default" },
    lanes,
    flow: school
      ? { steps: [{ key: "enquiries", count: n(["lead_in"]) }, { key: "called", count: n(["call"]) }, { key: "campus_visits", count: n(["visit"]) }, { key: "admissions", count: n(["admission"]) }], extra: [{ key: "fees_collected", count: n(["payment"]) }] }
      : { steps: [{ key: "leads_in", count: n(["lead_in"]) }, { key: "called", count: n(["call"]) }, { key: "interested", count: lanes.flatMap((l) => l.marks).filter((m) => m.label.endsWith("interested")).length }, { key: "quotes", count: n(["quote", "quote_approved"]) }, { key: "orders", count: n(["order"]) }], extra: [] },
    cost_today: { paise: school ? 9200 : 18450, calls_minutes: school ? 4 : 13, messages: school ? 356 : 12, ai_percent: school ? 9 : 14 },
    needs_owner_total: past ? 0 : lanes.reduce((s, l) => s + l.marks.filter((m) => m.needs_owner).length, 0),
  };
}

const NUMBERS: Record<string, { key: string; value: unknown }[]> = {
  caller: [{ key: "connected_percent", value: 71 }, { key: "interested", value: 3 }, { key: "minutes", value: 13 }],
  followups: [{ key: "sent", value: 3 }, { key: "replies", value: 1 }, { key: "due", value: 5 }],
  quote_writer: [{ key: "made", value: 2 }, { key: "approved", value: 1 }, { key: "waiting", value: 1 }],
  order_desk: [{ key: "orders", value: 1 }, { key: "value_paise", value: 12500000 }],
  lead_catcher: [{ key: "leads", value: 6 }, { key: "by_source", value: [{ source: "website", count: 2 }, { source: "indiamart", count: 2 }, { source: "email", count: 1 }, { source: "sheet", count: 1 }] }],
  lead_finder: [{ key: "searches", value: 1 }, { key: "found", value: 18 }, { key: "called", value: 1 }],
};
const SETTINGS: Record<string, { key: string; value: null; path: string }[]> = {
  caller: [{ key: "calling_hours", value: null, path: "/settings?section=assistant" }],
  followups: [{ key: "followup_rules", value: null, path: "/followups/policy" }],
  quote_writer: [{ key: "quote_rules", value: null, path: "/quote-policy" }],
  lead_finder: [{ key: "lead_finder", value: null, path: "/settings?section=leadfinder" }],
};

/** The made-up side panel of one helper (from the made-up day). */
export function aiTeamPanelFixture({ helper, tenantId, school = false, date, role = "owner", paused = [] as readonly string[] }: { helper: string; tenantId: string; school?: boolean; date: string; role?: string; paused?: readonly string[] }) {
  const day = aiTeamDayFixture({ school, date, paused });
  const lane = day.lanes.find((l) => l.helper === helper);
  if (!lane) return null;
  const manages = role === "owner" || role === "admin";
  return {
    helper,
    status_now: lane.status_now,
    enabled: lane.enabled,
    can_switch: manages,
    reason_locked: manages ? null : "owner_or_admin",
    recent: [...lane.marks].filter((m) => m.kind !== "followup_due").reverse().slice(0, 10),
    today: { count: lane.count_today, numbers: NUMBERS[helper] ?? [{ key: "done", value: lane.count_today }] },
    cost_today: manages ? { paise: helper === "caller" ? 9300 : helper === "followups" ? 1200 : 0 } : null,
    settings: (SETTINGS[helper] ?? []).map((s) => ({ key: s.key, value: s.value, href: `/app/tenants/${tenantId}${s.path}` })),
    train_href: "/ai-team/training",
  };
}

const STANDUP: Record<string, { lines: [string, string][]; draft?: boolean }> = {
  en: {
    lines: [
      ["Good morning. Yesterday your team caught 6 new leads and made 8 calls; 3 people were interested.", "yesterday.calls"],
      ["Quote 13 for Ramesh K was approved and became order 9, worth one lakh twenty-five thousand rupees.", "yesterday.orders"],
      ["Two things wait for you: quote 14 for Anjali Boutique, and Kavya Textiles asked to speak to you.", "now.waiting"],
      ["Today: 5 follow-ups are due from four o'clock, and a store visit is booked for Saturday at eleven.", "today.first"],
    ],
  },
  te: {
    lines: [
      ["శుభోదయం. నిన్న మీ బృందం 6 కొత్త లీడ్‌లు తెచ్చింది, 8 కాల్స్ చేసింది; 3 మంది ఆసక్తి చూపారు.", "yesterday.calls"],
      ["రమేష్ కె కోసం కోట్ 13 ఆమోదం పొంది ఆర్డర్ 9 అయింది, విలువ ఒక లక్ష ఇరవై ఐదు వేల రూపాయలు.", "yesterday.orders"],
      ["మీ కోసం రెండు ఎదురుచూస్తున్నాయి: అంజలి బొటిక్ కోట్ 14, కావ్య టెక్స్‌టైల్స్ మీతో మాట్లాడాలని కోరారు.", "now.waiting"],
      ["ఈ రోజు: నాలుగు గంటల నుంచి 5 ఫాలో-అప్‌లు ఉన్నాయి, శనివారం పదకొండు గంటలకు స్టోర్ విజిట్ ఉంది.", "today.first"],
    ],
  },
  hi: {
    lines: [
      ["सुप्रभात। कल आपकी टीम ने 6 नई लीड पकड़ीं और 8 कॉल कीं; 3 लोग इच्छुक थे।", "yesterday.calls"],
      ["रमेश के का कोट 13 मंज़ूर हुआ और ऑर्डर 9 बना, कीमत एक लाख पच्चीस हज़ार रुपये।", "yesterday.orders"],
      ["दो चीज़ें आपका इंतज़ार कर रही हैं: अंजलि बुटीक का कोट 14, और काव्या टेक्सटाइल्स आपसे बात करना चाहते हैं।", "now.waiting"],
      ["आज: चार बजे से 5 फ़ॉलो-अप बाकी हैं, और शनिवार ग्यारह बजे स्टोर विज़िट तय है।", "today.first"],
    ],
  },
  kn: {
    draft: true,
    lines: [
      ["ಶುಭೋದಯ. ನಿನ್ನೆ ನಿಮ್ಮ ತಂಡ 6 ಹೊಸ ಲೀಡ್‌ಗಳನ್ನು ತಂದಿತು, 8 ಕರೆಗಳನ್ನು ಮಾಡಿತು; 3 ಜನ ಆಸಕ್ತಿ ತೋರಿದರು.", "yesterday.calls"],
      ["ರಮೇಶ್ ಕೆ ಅವರ ಕೋಟ್ 13 ಒಪ್ಪಿಗೆ ಪಡೆದು ಆರ್ಡರ್ 9 ಆಯಿತು, ಮೌಲ್ಯ ಒಂದು ಲಕ್ಷ ಇಪ್ಪತ್ತೈದು ಸಾವಿರ ರೂಪಾಯಿ.", "yesterday.orders"],
      ["ನಿಮಗಾಗಿ ಎರಡು ಕಾಯುತ್ತಿವೆ: ಅಂಜಲಿ ಬೊಟಿಕ್‌ನ ಕೋಟ್ 14, ಮತ್ತು ಕಾವ್ಯ ಟೆಕ್ಸ್‌ಟೈಲ್ಸ್ ನಿಮ್ಮೊಂದಿಗೆ ಮಾತನಾಡಲು ಕೇಳಿದ್ದಾರೆ.", "now.waiting"],
      ["ಇಂದು: ನಾಲ್ಕು ಗಂಟೆಯಿಂದ 5 ಫಾಲೋ-ಅಪ್‌ಗಳಿವೆ, ಶನಿವಾರ ಹನ್ನೊಂದು ಗಂಟೆಗೆ ಸ್ಟೋರ್ ಭೇಟಿ ಇದೆ.", "today.first"],
    ],
  },
};

const STANDUP_SCHOOL: Record<string, { lines: [string, string][]; draft?: boolean }> = {
  en: {
    lines: [
      ["Good morning. Yesterday 3 parents enquired and 3 calls were made; one family booked a campus visit.", "yesterday.calls"],
      ["Meera was admitted to Class 4, and Rohan's Term 2 fee was paid.", "yesterday.admissions"],
      ["One thing waits for you: Diya's parent asked to speak to the principal.", "now.waiting"],
      ["Today: 3 follow-ups are due from half past four, and a campus visit is booked for Saturday at ten.", "today.first"],
    ],
  },
  te: {
    lines: [
      ["శుభోదయం. నిన్న 3 మంది తల్లిదండ్రులు విచారించారు, 3 కాల్స్ చేశాం; ఒక కుటుంబం క్యాంపస్ విజిట్ బుక్ చేసింది.", "yesterday.calls"],
      ["మీరా 4వ తరగతిలో చేరింది, రోహన్ టర్మ్ 2 ఫీజు చెల్లించారు.", "yesterday.admissions"],
      ["మీ కోసం ఒకటి ఎదురుచూస్తోంది: దియా తల్లిదండ్రులు ప్రిన్సిపాల్‌తో మాట్లాడాలని కోరారు.", "now.waiting"],
      ["ఈ రోజు: నాలుగున్నర నుంచి 3 ఫాలో-అప్‌లు ఉన్నాయి, శనివారం పది గంటలకు క్యాంపస్ విజిట్ ఉంది.", "today.first"],
    ],
  },
  hi: {
    lines: [
      ["सुप्रभात। कल 3 अभिभावकों ने पूछताछ की और 3 कॉल हुईं; एक परिवार ने कैंपस विज़िट बुक की।", "yesterday.calls"],
      ["मीरा का कक्षा 4 में दाख़िला हुआ, और रोहन की टर्म 2 फ़ीस जमा हुई।", "yesterday.admissions"],
      ["एक चीज़ आपका इंतज़ार कर रही है: दिया के अभिभावक प्रिंसिपल से बात करना चाहते हैं।", "now.waiting"],
      ["आज: साढ़े चार बजे से 3 फ़ॉलो-अप बाकी हैं, और शनिवार दस बजे कैंपस विज़िट तय है।", "today.first"],
    ],
  },
  kn: {
    draft: true,
    lines: [
      ["ಶುಭೋದಯ. ನಿನ್ನೆ 3 ಪೋಷಕರು ವಿಚಾರಿಸಿದರು, 3 ಕರೆಗಳು ಆದವು; ಒಂದು ಕುಟುಂಬ ಕ್ಯಾಂಪಸ್ ಭೇಟಿ ಬುಕ್ ಮಾಡಿತು.", "yesterday.calls"],
      ["ಮೀರಾ 4ನೇ ತರಗತಿಗೆ ಸೇರಿದಳು, ರೋಹನ್ ಅವರ ಟರ್ಮ್ 2 ಶುಲ್ಕ ಪಾವತಿಯಾಯಿತು.", "yesterday.admissions"],
      ["ನಿಮಗಾಗಿ ಒಂದು ಕಾಯುತ್ತಿದೆ: ದಿಯಾ ಅವರ ಪೋಷಕರು ಪ್ರಾಂಶುಪಾಲರೊಂದಿಗೆ ಮಾತನಾಡಲು ಕೇಳಿದ್ದಾರೆ.", "now.waiting"],
      ["ಇಂದು: ನಾಲ್ಕೂವರೆಯಿಂದ 3 ಫಾಲೋ-ಅಪ್‌ಗಳಿವೆ, ಶನಿವಾರ ಹತ್ತು ಗಂಟೆಗೆ ಕ್ಯಾಂಪಸ್ ಭೇಟಿ ಇದೆ.", "today.first"],
    ],
  },
};

/** The made-up stand-up (the words of the example day, a school's own for a school; audio: a short tone made by our own route in mock mode). */
export function standupFixture({ date, language, by = "schedule", leftToday = 3, school = false }: { date: string; language: string; by?: "schedule" | "owner"; leftToday?: number; school?: boolean }) {
  const table = school ? STANDUP_SCHOOL : STANDUP;
  const lang = language in table ? language : "en";
  const s = table[lang];
  return {
    date,
    language: lang,
    generated_at: ist(date, "09:00"),
    by,
    text: s.lines.map((l) => l[0]).join(" "),
    lines: s.lines.map(([text, source]) => ({ text, source })),
    numbers: school
      ? [{ key: "yesterday.enquiries", value: 3 }, { key: "yesterday.calls", value: 3 }, { key: "yesterday.admissions", value: 1 }, { key: "now.waiting", value: 1 }, { key: "today.followups_due", value: 3 }]
      : [{ key: "yesterday.leads", value: 6 }, { key: "yesterday.calls", value: 8 }, { key: "yesterday.interested", value: 3 }, { key: "yesterday.order_value_rupees", value: 125000 }, { key: "now.waiting", value: 2 }, { key: "today.followups_due", value: 5 }],
    audio: { url: "", seconds: 38 },
    audio_reason: null,
    left_today: leftToday,
    ...(s.draft ? { draft: true } : {}),
  };
}
