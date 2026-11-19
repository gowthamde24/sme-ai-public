import reviewed from "@/i18n/review/pack-labels-reviewed.json";

/**
 * The pack file's own words in Telugu, Hindi and Kannada (`labels.te` ...) are not reviewed by anyone who reads the language. With REVIEWED_TRANSLATIONS_ONLY=1 only the ones the owner has approved
 * (`i18n/review/pack-labels-reviewed.json`: { "te": { "nav.item.chats": "..." } }, written by `npm run i18n:import` from his sheet) are used, and only for a label the pack defines in that language.
 */
export function reviewedPackLabels(lang: string): Readonly<Record<string, string>> {
  return (reviewed as Record<string, Record<string, string>>)[lang] ?? {};
}
