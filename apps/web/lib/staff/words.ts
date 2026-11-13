/**
 * The words of the staff console. English only, on purpose: it is Stack19's own internal screen (owner, 13 Nov 2026), not the shop app, so it has no entries in i18n/strings and no Telugu, Kannada or Hindi. Internal screens MAY name providers and show our costs; the shop
 * app never does. Client-safe: no request API, nothing imported.
 */
export const NAV = [
  { key: "overview", label: "Overview", href: "/staff" },
  { key: "businesses", label: "Businesses" },
  { key: "support", label: "Support" },
  { key: "money", label: "Money" },
  { key: "usage", label: "Usage & cost" },
  { key: "health", label: "Health" },
  { key: "compliance", label: "Compliance" },
  { key: "audit", label: "Audit log" },
] as const;
export type NavKey = (typeof NAV)[number]["key"];

export const ROLE_BADGE: Record<string, string> = { owner: "OWNER", support: "SUPPORT", finance: "FINANCE" };

export const CHANNEL: Record<string, string> = { phone: "Phone", whatsapp: "WhatsApp", chat: "Chat", email: "Email" };
export const PRIORITY: Record<string, string> = { urgent: "Urgent", high: "High", normal: "Normal" };
export const STATUS: Record<string, string> = { not_live: "Not live", in_training: "In training", live: "Live", paused: "Paused" };

/** Our providers as the console names them (internal only) and what each does for us. */
export const PROVIDER: Record<string, string> = { cartesia: "Cartesia", sarvam: "Sarvam", plivo: "Plivo", anthropic: "Anthropic", meta: "Meta", google: "Google" };
export const PROVIDER_ROLE: Record<string, string> = {
  voice: "Voice (TTS)",
  speech_to_text: "Speech-to-text",
  calls_and_numbers: "Calls & numbers",
  ai_model: "AI model",
  whatsapp: "WhatsApp",
  lead_search: "Lead search",
};

export const HEALTH_WORD: Record<string, string> = { healthy: "Healthy", degraded: "Degraded", down: "Down", unknown: "Not measured" };

export const TEXT = {
  tag: "Staff console",
  brand: "Stack19",
  signedOutTitle: "Your staff session ended",
  signedOutBody: "A staff session ends after 30 minutes without activity. Sign in again to continue.",
  signedOutButton: "Sign in again",
  noAccessTitle: "Staff access is required",
  noAccessBody: "This area is for Stack19 staff. If you should have access, ask the owner.",
  unavailableTitle: "The staff console could not load",
  unavailableBody: "Something went wrong on our side. Try again in a minute.",
  tryAgain: "Try again",
  backToOverview: "Back to Overview",
  privacy: "Every view of a business is logged with a reason. Customer phone numbers and transcripts are masked unless you unmask them (logged separately). The business can see each support view in its own activity log.",
  costsSince: (date: string) => `Costs counted since ${date}. This month's margin is partial.`,
  searchPlaceholder: "Search business, phone, invoice or ticket",
  searchLabel: "Search the staff console",
  searchNone: "Nothing found",
  searchBusinesses: "Businesses",
  searchInvoices: "Invoices",
  searchTickets: "Tickets",
  searchFailed: "Search is not available right now",
  reasonTitle: (name: string) => `Why are you opening ${name}?`,
  reasonIntro: "This is a read-only support view. Your reason is logged, and the business can see that support looked.",
  reasonLegend: "Reason",
  reasonPick: "Choose a reason",
  reasonNote: "What for?",
  reasonNoteMore: "Add a note (optional)",
  reasonChoose: "Choose a reason before you continue.",
  reasonSayWhat: "Say what for, in 3 to 300 characters.",
  reasonOwnerOk: "The business owner must approve support access first.",
  reasonNoAccess: "You do not have access to open this business.",
  reasonFailed: "Could not open the business. Try again.",
  reasonOpen: "Open read-only view",
  reasonCancel: "Cancel",
  view: "View",
  banner: "Support view",
  bannerBody: "Read only. Customer names and numbers are masked. This visit is logged with your reason, and the business can see it.",
  accessRequiredTitle: "Open this business from the Overview first",
  accessRequiredBody: "A support view needs a reason, given first. Your access lasts 15 minutes.",
  ownerOkTitle: "The business owner must approve support access first",
  ownerOkBody: "This business asked to approve each support visit. Ask the owner to approve, then open it again.",
} as const;
