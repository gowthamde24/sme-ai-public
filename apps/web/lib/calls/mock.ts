/**
 * The FAKE live call of the screens (job DM), only for CALL_SCREENS=mock: there is no telephony yet, so nothing is called and nothing is heard; the screen shows what the real one will show (the circle, who is on the line, the line being said,
 * the transcript, "Take over the call", "End call"). The names and the words are invented (Telugu, as in the approved design). No network, nothing stored.
 */
export type CallLine = { who: "ai" | "customer"; text: string };
export type LiveCallData = { callee: string; kind: "followup" | "admission" | "reminder"; lang: "te" | "hi" | "kn" | "en"; startedSecondsAgo: number; caption: string; transcript: readonly CallLine[] };

export const MOCK_CALL: LiveCallData = {
  callee: "Ravi Kumar",
  kind: "followup",
  lang: "te",
  startedSecondsAgo: 72,
  caption: "కొత్త డిజైన్ల ఫోటోలు వాట్సాప్‌లో పంపమంటారా?",
  transcript: [
    { who: "ai", text: "నమస్కారం రవి గారు, నేను శ్రీ లక్ష్మి సిల్క్స్ AI అసిస్టెంట్ వాణి. మీరు అడిగిన కంచి పట్టు చీరల గురించి కాల్ చేశాను." },
    { who: "customer", text: "అవునండి, కొత్త డిజైన్లు ఏమైనా వచ్చాయా?" },
    { who: "ai", text: "కొత్త డిజైన్ల ఫోటోలు వాట్సాప్‌లో పంపమంటారా?" },
  ],
};
