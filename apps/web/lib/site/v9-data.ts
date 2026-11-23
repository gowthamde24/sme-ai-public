// The sample conversations and sample voices of the home page (landing v9, owner approved 23 Nov 2026). Demo CONTENT, not site copy: each line is what that language's customer or assistant says in the picture, so it is the same in every site language (like lib/site/packs samples). The words around them (labels, titles) are in the string store (v9.*).
export type DemoLang = "te" | "hi" | "kn" | "en";
export type Step = readonly ["in" | "out", string] | readonly ["file", string, string];
export type Demo = { biz: string; label: string; cap: string; steps: readonly Step[]; asked: string; lang: string; next: string };
export type Voice = { ind: string; group: string; who: string; dir: string; lines: Record<DemoLang, string> };
export const DEMO_LANGS: readonly DemoLang[] = ["te", "hi", "kn", "en"];
export const DEMO_LANG_NAMES: Record<DemoLang, string> = { te: "తెలుగు", hi: "हिन्दी", kn: "ಕನ್ನಡ", en: "English" };
export const WAVE_HEIGHTS = [14, 24, 12, 28, 18, 10, 26, 16, 22, 12, 20, 14, 26, 10, 18, 24, 12, 16];

export const WA: Record<DemoLang, Demo> = {
        te: { biz: "Bright Path Academy", label: "00:19 · Telugu live call", cap: "నమస్తే అండీ, Bright Path. ఏ course కావాలి?",
          steps: [["in", "ఇంటర్ తర్వాత MPC batch details మరియు timings పంపించండి."], ["out", "తప్పకుండా అండీ, batch timings మరియు fee structure WhatsApp లో పంపిస్తున్నాను."], ["file", "MPC batch brochure.pdf", "2 pages · PDF"], ["out", "శనివారం 11 గంటలకు demo class బుక్ చేశాను."]],
          asked: "MPC batch & timings", lang: "Telugu + English", next: "Details sent on WhatsApp" },
        hi: { biz: "Shree Homes", label: "00:19 · Hindi live call", cap: "नमस्ते जी, Shree Homes। कौन सा flat देखना है?",
          steps: [["in", "क्या शनिवार सुबह 2BHK site visit मिल सकती है?"], ["out", "जी हाँ, शनिवार 11 बजे की visit तय कर दी है।"], ["file", "Project brochure.pdf", "3 pages · PDF"], ["out", "Location WhatsApp पर भेज दी है।"]],
          asked: "2BHK site visit", lang: "Hindi + English", next: "Location sent on WhatsApp" },
        kn: { biz: "Sunrise Clinic", label: "00:19 · Kannada live call", cap: "ನಮಸ್ಕಾರ, Sunrise Clinic. ಯಾವ ಸಮಯ ಬೇಕು?",
          steps: [["in", "ಸಂಜೆ 5 ಗಂಟೆಗೆ doctor appointment ಸಿಗುತ್ತಾ?"], ["out", "ಹೌದು, ಸಂಜೆ 5:15 ಕ್ಕೆ slot confirm ಮಾಡಿದ್ದೇವೆ."], ["file", "Clinic address & timings.pdf", "1 page · PDF"], ["out", "WhatsApp ನಲ್ಲಿ details ಕಳುಹಿಸಿದ್ದೇವೆ."]],
          asked: "Evening appointment", lang: "Kannada + English", next: "Slot confirmed on WhatsApp" },
        en: { biz: "Green Leaf Store", label: "00:19 · English live call", cap: "Hello, Green Leaf Store. How can I help?",
          steps: [["in", "Do you deliver wholesale orders outside the city this week?"], ["out", "Yes, we deliver on Thursday. I'm sending the price list on WhatsApp."], ["file", "Wholesale price list.pdf", "2 pages · PDF"], ["out", "Thursday 11:00 delivery slot is booked."]],
          asked: "Wholesale delivery", lang: "English", next: "Price list sent on WhatsApp" }
      };

export const VOICES: Voice[] = [
        { ind: "Real estate", group: "Deep & confident", who: "Charan", dir: "Inbound", lines: { te: "ఫ్లాట్ వివరాలు మరియు site visit బుక్ చేయడం", hi: "फ्लैट की जानकारी और site visit तय करना", kn: "ಫ್ಲ್ಯಾಟ್ ಮಾಹಿತಿ ಮತ್ತು site visit ಬುಕ್ ಮಾಡುವುದು", en: "Answers 2BHK enquiries & books site visits" } },
        { ind: "Coaching / education", group: "Bright & young", who: "Ramya", dir: "Inbound", lines: { te: "బ్యాచ్ టైమింగ్స్ మరియు ఫీజు వివరాలు", hi: "नए batch और demo class की जानकारी", kn: "ಬ್ಯಾಚ್ ಸಮಯ ಮತ್ತು demo class ಮಾಹಿತಿ", en: "Shares batch timings & demo class details" } },
        { ind: "School / college", group: "Bright & young", who: "Tarun", dir: "Inbound", lines: { te: "అడ్మిషన్ వివరాలు మరియు క్యాంపస్ విజిట్", hi: "Admission फॉर्म और campus visit तय करना", kn: "Admission ವಿವರ ಮತ್ತು campus visit ಬುಕಿಂಗ್", en: "Guides parents on admissions & campus visits" } },
        { ind: "Clinic", group: "Calm & reassuring", who: "Kavitha", dir: "Inbound", lines: { te: "డాక్టర్ అపాయింట్‌మెంట్ టైమ్ కన్ఫర్మ్ చేయడం", hi: "डॉक्टर की appointment और समय कन्फर्म करना", kn: "ಡಾಕ್ಟರ್ appointment ಸಮಯ ಕನ್ಫರ್ಮ್ ಮಾಡುವುದು", en: "Confirms doctor slots & clinic hours calmly" } },
        { ind: "Car dealer", group: "Energetic", who: "Vikram", dir: "Outbound", lines: { te: "టెస్ట్ డ్రైవ్ స్లాట్ బుక్ చేయడం", hi: "शो-रूम test drive और मॉडल की जानकारी", kn: "ಟೆಸ್ಟ್ ಡ್ರೈವ್ ಮತ್ತು model ಮಾಹಿತಿ", en: "Calls consented leads to schedule test drives" } },
        { ind: "Saree / textile shop", group: "Warm & friendly", who: "Ananya", dir: "Inbound", lines: { te: "కొత్త కలెక్షన్ మరియు షాప్ టైమింగ్స్", hi: "नई साड़ियों और दुकान के समय की जानकारी", kn: "ಹೊಸ ಸೀರೆ collection ಮತ್ತು shop timings", en: "Answers stock questions & shares shop location" } },
        { ind: "Wholesale", group: "Deep & confident", who: "Raghav", dir: "Outbound", lines: { te: "బల్క్ ఆర్డర్ ఎంక్వైరీలు మరియు డెలివరీ", hi: "Bulk order और delivery समय बताना", kn: "ಬಲ್ಕ್ ಆರ್ಡರ್ ಮತ್ತು delivery ವಿವರ", en: "Follows up trade buyers on bulk orders" } },
        { ind: "Loans / insurance", group: "Calm & reassuring", who: "Meera", dir: "Outbound", lines: { te: "డాక్యుమెంట్ చెక్‌లిస్ట్ మరియు కాల్ రిమైండర్", hi: "जरूरी documents और policy renewal कॉल", kn: "ಅಗತ್ಯ documents ಮತ್ತು renewal ನೆನಪು", en: "Explains required documents & schedules callbacks" } }
      ];
