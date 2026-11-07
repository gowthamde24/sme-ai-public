import { formatRupeesShort } from "@/lib/money";

/** The words of a payment reminder draft: fixed text with the ledger's own amount and date, never written by a model, no promise and no threat. The owner reads sample messages before approving the campaign. */
export function reminderText(business: string, amountPaise: number, dueDate: string): string {
  return `Hello, a gentle reminder from ${business.trim().slice(0, 60)}: ${formatRupeesShort(amountPaise)} is due since ${dueDate}. Please pay when you can. Thank you.`;
}
