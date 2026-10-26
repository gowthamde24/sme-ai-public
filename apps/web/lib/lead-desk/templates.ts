import { bad, int, list, rec, str, word } from "@/lib/api/shape";
import type { PackSummary, Words } from "@/lib/packs/types";

/**
 * The nine "any business with leads" types of Lead Desk (night 4, part A1; contract-leads-pack.md): ordinary business types of the API (`GET /v1/packs` lists them with the three deep ones) that have a LEAD TEMPLATE (a goal, questions,
 * objections, follow-ups). The sign-up groups them under ONE card, "Any business with leads", and then shows the picker of these. A template is DATA of the API (`GET /v1/lead-templates`, public): the web keeps no list of business types in code
 * except the made-up nine of the TEST screens (LEADS_SCREENS=mock). Pure parsing and the test data: no request, no cookie.
 */
export type LeadTemplate = {
  packId: string;
  version: number;
  names: Words;
  summary: Words;
  goalCode: string;
  goalLabel: Words;
  questionCount: number;
  accent: string;
  owlProp: string;
  validated: boolean;
};

const words = (v: unknown, what: string): Words => {
  const r = rec(v, what);
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(r)) if (/^[a-z]{2}$/.test(k)) out[k] = str(x, what, 400);
  if (!out.en) bad(what);
  return out;
};

export function parseTemplates(json: unknown): LeadTemplate[] {
  const x = rec(json, "lead templates");
  return list(x.templates, "templates", 40).map((row) => {
    const r = rec(row, "template");
    const goal = rec(r.goal, "goal");
    return {
      packId: word(r.pack_id, "pack_id", 40),
      version: int(r.version, "version", 1, 10_000),
      names: words(r.names, "names"),
      summary: words(r.summary, "summary"),
      goalCode: word(goal.code, "goal.code", 40),
      goalLabel: words(goal.label, "goal.label"),
      questionCount: int(r.question_count, "question_count", 0, 100),
      accent: word(r.accent, "accent", 40),
      owlProp: word(r.owl_prop, "owl_prop", 40),
      validated: r.validated === true,
    };
  });
}

/** A template as the sign-up card list knows a business type (status `preview`: "Not validated by a real owner yet"). */
export const toPackSummary = (t: LeadTemplate): PackSummary => ({ packId: t.packId, version: t.version, status: "preview", validated: t.validated, names: t.names, summary: t.summary, accent: t.accent, owlProp: t.owlProp });

/** The id of the ONE card that stands for the nine on the first sign-up step (`/signup?type=leads` shows the picker). Not a business type: it is never sent to the API. */
export const LEADS_CARD_ID = "leads";

/** The made-up nine of the test screens (LEADS_SCREENS=mock), in the API's order (by pack id). English, Telugu, Hindi and Kannada drafts. */
const T = (packId: string, owlProp: string, names: [string, string, string, string], summary: [string, string, string, string], goalCode: string, goal: [string, string, string, string], questionCount: number): LeadTemplate => ({
  packId,
  version: 1,
  names: { en: names[0], te: names[1], hi: names[2], kn: names[3] },
  summary: { en: summary[0], te: summary[1], hi: summary[2], kn: summary[3] },
  goalCode,
  goalLabel: { en: goal[0], te: goal[1], hi: goal[2], kn: goal[3] },
  questionCount,
  accent: "leads_orange",
  owlProp,
  validated: false,
});
export const MOCK_TEMPLATES: readonly LeadTemplate[] = [
  T("auto_dealer", "car", ["Auto dealer", "ఆటో డీలర్", "ऑटो डीलर", "ಆಟೋ ಡೀಲರ್"], ["Cars and bikes: book a test drive.", "కార్లు, బైకులు: టెస్ట్ డ్రైవ్ బుక్ చేయండి.", "कार और बाइक: टेस्ट ड्राइव बुक करें।", "ಕಾರು, ಬೈಕ್: ಟೆಸ್ಟ್ ಡ್ರೈವ್ ಬುಕ್ ಮಾಡಿ."], "test_drive", ["Book a test drive", "టెస్ట్ డ్రైవ్ బుక్ చేయండి", "टेस्ट ड्राइव बुक करें", "ಟೆಸ್ಟ್ ಡ್ರೈವ್ ಬುಕ್ ಮಾಡಿ"], 6),
  T("clinic", "stethoscope", ["Clinic", "క్లినిక్", "क्लिनिक", "ಕ್ಲಿನಿಕ್"], ["Patients enquire: book an appointment.", "రోగులు అడుగుతారు: అపాయింట్‌మెంట్ బుక్ చేయండి.", "मरीज पूछते हैं: अपॉइंटमेंट बुक करें।", "ರೋಗಿಗಳು ಕೇಳುತ್ತಾರೆ: ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಿ."], "appointment", ["Book an appointment", "అపాయింట్‌మెంట్ బుక్ చేయండి", "अपॉइंटमेंट बुक करें", "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಿ"], 5),
  T("coaching", "open_book", ["Coaching classes", "కోచింగ్ క్లాసులు", "कोचिंग क्लास", "ಕೋಚಿಂಗ್ ಕ್ಲಾಸ್"], ["Students enquire: book a counselling session.", "విద్యార్థులు అడుగుతారు: కౌన్సెలింగ్ బుక్ చేయండి.", "छात्र पूछते हैं: काउंसलिंग बुक करें।", "ವಿದ್ಯಾರ್ಥಿಗಳು ಕೇಳುತ್ತಾರೆ: ಕೌನ್ಸೆಲಿಂಗ್ ಬುಕ್ ಮಾಡಿ."], "counselling", ["Book a counselling session", "కౌన్సెలింగ్ బుక్ చేయండి", "काउंसलिंग बुक करें", "ಕೌನ್ಸೆಲಿಂಗ್ ಬುಕ್ ಮಾಡಿ"], 6),
  T("gym", "dumbbell", ["Gym", "జిమ్", "जिम", "ಜಿಮ್"], ["Walk-in enquiries: book a trial visit.", "వచ్చే ఎంక్వైరీలు: ట్రయల్ విజిట్ బుక్ చేయండి.", "आने वाली पूछताछ: ट्रायल विज़िट बुक करें।", "ಬರುವ ವಿಚಾರಣೆ: ಟ್ರಯಲ್ ವಿಸಿಟ್ ಬುಕ್ ಮಾಡಿ."], "trial", ["Book a trial visit", "ట్రయల్ విజిట్ బుక్ చేయండి", "ट्रायल विज़िट बुक करें", "ಟ್ರಯಲ್ ವಿಸಿಟ್ ಬುಕ್ ಮಾಡಿ"], 4),
  T("insurance_loans", "shield_check", ["Insurance and loans", "ఇన్సూరెన్స్, లోన్లు", "इंश्योरेंस और लोन", "ಇನ್ಶೂರೆನ್ಸ್, ಸಾಲಗಳು"], ["Find out what they need before an agent calls.", "ఏజెంట్ కాల్ చేసే ముందు వారికి ఏం కావాలో తెలుసుకోండి.", "एजेंट के कॉल से पहले जानें कि उन्हें क्या चाहिए।", "ಏಜೆಂಟ್ ಕರೆ ಮಾಡುವ ಮೊದಲು ಅವರಿಗೇನು ಬೇಕೆಂದು ತಿಳಿಯಿರಿ."], "qualify", ["Find out what they need", "వారికి ఏం కావాలో తెలుసుకోండి", "जानें कि उन्हें क्या चाहिए", "ಅವರಿಗೇನು ಬೇಕೆಂದು ತಿಳಿಯಿರಿ"], 7),
  T("interiors_solar", "sofa_sun", ["Interiors and solar", "ఇంటీరియర్స్, సోలార్", "इंटीरियर और सोलर", "ಇಂಟೀರಿಯರ್ಸ್, ಸೋಲಾರ್"], ["Book a site measurement.", "సైట్ మెజర్‌మెంట్ బుక్ చేయండి.", "साइट मेज़रमेंट बुक करें।", "ಸೈಟ್ ಮೆಷರ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಿ."], "site_measurement", ["Book a site measurement", "సైట్ మెజర్‌మెంట్ బుక్ చేయండి", "साइट मेज़रमेंट बुक करें", "ಸೈಟ್ ಮೆಷರ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಿ"], 6),
  T("real_estate", "building", ["Real estate", "రియల్ ఎస్టేట్", "रियल एस्टेट", "ರಿಯಲ್ ಎಸ್ಟೇಟ್"], ["Property enquiries: book a site visit.", "ప్రాపర్టీ ఎంక్వైరీలు: సైట్ విజిట్ బుక్ చేయండి.", "प्रॉपर्टी पूछताछ: साइट विज़िट बुक करें।", "ಪ್ರಾಪರ್ಟಿ ವಿಚಾರಣೆ: ಸೈಟ್ ವಿಸಿಟ್ ಬುಕ್ ಮಾಡಿ."], "site_visit", ["Book a site visit", "సైట్ విజిట్ బుక్ చేయండి", "साइट विज़िट बुक करें", "ಸೈಟ್ ವಿಸಿಟ್ ಬುಕ್ ಮಾಡಿ"], 7),
  T("travel", "paper_plane", ["Travel", "ట్రావెల్", "ट्रैवल", "ಟ್ರಾವೆಲ್"], ["Trip enquiries: get the details for a quote.", "ట్రిప్ ఎంక్వైరీలు: కోట్ కోసం వివరాలు తీసుకోండి.", "ट्रिप पूछताछ: कोट के लिए जानकारी लें।", "ಟ್ರಿಪ್ ವಿಚಾರಣೆ: ಕೋಟ್‌ಗೆ ವಿವರ ಪಡೆಯಿರಿ."], "quote", ["Get the details for a quote", "కోట్ కోసం వివరాలు తీసుకోండి", "कोट के लिए जानकारी लें", "ಕೋಟ್‌ಗೆ ವಿವರ ಪಡೆಯಿರಿ"], 6),
  T("wholesale_b2b", "delivery_truck", ["Wholesale and B2B", "హోల్‌సేల్, బి2బి", "होलसेल और बी2बी", "ಹೋಲ್‌ಸೇಲ್, ಬಿ2ಬಿ"], ["Business buyers: get the details for a quote.", "బిజినెస్ కొనుగోలుదారులు: కోట్ కోసం వివరాలు తీసుకోండి.", "बिज़नेस खरीदार: कोट के लिए जानकारी लें।", "ಬಿಸಿನೆಸ್ ಖರೀದಿದಾರರು: ಕೋಟ್‌ಗೆ ವಿವರ ಪಡೆಯಿರಿ."], "quote", ["Get the details for a quote", "కోట్ కోసం వివరాలు తీసుకోండి", "कोट के लिए जानकारी लें", "ಕೋಟ್‌ಗೆ ವಿವರ ಪಡೆಯಿರಿ"], 6),
];
