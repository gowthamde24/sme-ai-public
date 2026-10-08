/** Words and shapes that would be a claim we cannot prove today. Used by the string-store tests and the rendered-page tests. */
export const FORBIDDEN_CLAIMS: [RegExp, string][] = [
  [/guarantee/i, "guarantee"],
  [/testimonial/i, "testimonial"],
  [/trusted by/i, "trusted by"],
  [/used by|loved by|chosen by/i, "used/loved/chosen by"],
  [/% of (our |your )?(customers|users|businesses)/i, "% of customers"],
  [/\d\s?%/, "a percentage"],
  [/\d[\d,.]*\s?(\+\s)?(customers|users|businesses|companies|clients|merchants)/i, "a user/customer count"],
  [/\b(rated|rating|\d(\.\d)?\s?stars?|five-star|5-star)\b/i, "a rating"],
  [/\b(award|best-in-class|market leader|number one|#1)\b/i, "a superlative or award"],
  [/\b(certified|compliant|compliance certified|SOC ?2|ISO ?\d+)\b/i, "a certification or compliance claim"],
  [/\b(case stud(y|ies)|success stor(y|ies))\b/i, "a case study"],
  [/\b(millions?|thousands of|hundreds of)\b/i, "a scale claim"],
  [/(sends|will send|can send|automatically sends?|auto-?sends?)\s+(your|the|all|every)?\s*(messages?|quotes?|emails?|e-mails?|whatsapp)/i, "AI sends messages"],
  [/(replaces|no need for)\s+(your\s+)?(staff|team|salespeople)/i, "replacing people"],
];
