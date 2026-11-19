/**
 * The sample call and the WhatsApp that follows, as the home page's phones show them. They are Telugu on every language's page (the example is a Telugu customer), with the page's own language underneath
 * (the `h3.call.N.g` and `h3.wa.N.g` words; none on the Telugu page itself).
 * DRAFT (owner to read): spoken Telugu with English business words in Latin, friendly "అండీ" style. The same lines are in ~/Desktop/stack19-jobs/mocks/landing-v2/TELUGU-DRAFT.md.
 */
export const CALL_TE = [
  "నమస్తే అండీ, Padma Silks కి స్వాగతం. చెప్పండి, ఏం కావాలి?",
  "Kanchi silk saree ఉందా? Wedding కోసం, red colour.",
  "ఉందండీ! శనివారం 11 కి shop కి రండి. Photos WhatsApp లో పంపుతాను.",
] as const;

export const WA_TE = [
  "నమస్తే అండీ! ఇప్పుడే call లో మాట్లాడాం కదా. ఇవి మా red Kanchi silk sarees, 12,500 rupees నుంచి. శనివారం 11 కి రండి.",
  "బాగున్నాయి అండీ. శనివారం వస్తాను.",
  "సరే అండీ, శనివారం 11 కి మీ visit book చేశాను.",
] as const;

/** The four example voices of "Hear our voices" (names are made up; no recording exists yet). */
export const VOICES = [
  { name: "Lakshmi", lang: "te" },
  { name: "Ravi", lang: "hi" },
  { name: "Anitha", lang: "kn" },
  { name: "David", lang: "en" },
] as const;
