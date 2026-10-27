/**
 * Top-ups of call minutes and business-initiated WhatsApp messages (night 4, part F2). The shapes the screens read; C1's API (contract-topups.md, job E2) is turned into these by lib/api/topups.ts, and the fake provider of the
 * screens (TOPUP_SCREENS=mock, lib/topups/mock.ts) makes the same shapes. Money is integer paise. Only TWO things are counted: call minutes and the WhatsApp messages the business starts; the AI itself stays "included, fair use"
 * and has no number, no rupee and no token anywhere in these shapes.
 */
export const KINDS = ["call_minutes", "whatsapp_messages"] as const;
export type Kind = (typeof KINDS)[number];

/** `ok` below 80 percent, `notice` from 80, `stopped` at 100 percent (or when none is included). */
export type MeterLevel = "ok" | "notice" | "stopped";

export type Overage = { enabled: boolean; units: number; spentPaise: number; capPaise: number; ratePaisePerUnit: number };

/** One meter, as the API reads it (contract-topups.md section 1). Dates are plain India days (YYYY-MM-DD). */
export type Meter = {
  kind: Kind;
  used: number;
  /** null = no ceiling (pay as you go). */
  allowance: number | null;
  remaining: number | null;
  percent: number | null;
  state: MeterLevel;
  included: boolean;
  planAllowance: number | null;
  topupBalance: number;
  nextTopupExpiry: string | null;
  projectedRunOutOn: string | null;
  runsOutBeforePeriodEnd: boolean;
  blocked: boolean;
  overage: Overage | null;
  /** Leads whose call waits for minutes (call_minutes) or messages held in the outbox (whatsapp_messages). */
  queued: number;
};

export type Period = { start: string; end: string; daysLeft: number };

/** The small read: both meters and the period (what a banner, the Today card and the Plan bars need). */
export type UsageView = { period: Period; minutes: Meter; messages: Meter; queuedCalls: number };

export type Pack = {
  code: string;
  kind: Kind;
  units: number;
  pricePaise: number;
  gstRateBp: number;
  gstPaise: number;
  totalPaise: number;
  /** True while the owner of the product has not set the real prices: the screens say "test price". */
  isPlaceholder: boolean;
};
export type Lot = { purchaseId: string; unitsLeft: number; purchasedAt: string; expiresAt: string };
export type Balance = Record<Kind, { units: number; lots: Lot[] }>;
export type TopupSettings = {
  autoMinutesPack: string | null;
  autoMessagesPack: string | null;
  autoMonthlyCapPaise: number;
  overageMinutes: boolean;
  overageMessages: boolean;
  overageMonthlyCapPaise: number;
  overageRatePaisePerMinute: number;
  overageRatePaisePerMessage: number;
  autoSpentPaise: number;
  overageSpentPaise: number;
};
export type Purchase = { id: string; packCode: string; kind: Kind; units: number; source: "manual" | "auto" | "operator"; pricePaise: number; totalPaise: number; purchasedAt: string; expiresAt: string; unitsLeft: number; invoiceId: string | null };
export type InvoiceKind = "topup" | "upgrade" | "overage";
export type Invoice = {
  id: string;
  number: string;
  kind: InvoiceKind;
  description: string;
  issuedAt: string;
  taxablePaise: number;
  gstRateBp: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  sellerName: string;
  sellerStateCode: string | null;
  sellerGstin: string | null;
  buyerGstin: string | null;
  buyerStateCode: string | null;
  /** Every invoice of the fake provider says so. */
  fake: boolean;
  paymentStatus: string;
};

/** What the Plan part shows below the meters: the packs, what is left of them, the two switches, what was bought. */
export type TopupsView = {
  /** "mock" = the fake cookie provider (prices are TEST amounts); "on" = C1's API. */
  mode: "mock" | "on";
  /** The plan in force when the source knows it (test mode does; the API's answer does not carry it, the page fills it from the Plan part). */
  planId: string | null;
  usage: UsageView;
  packs: Pack[];
  balance: Balance;
  settings: TopupSettings;
  history: Purchase[];
  invoices: Invoice[];
};

export type UpgradePreview = {
  fromPlanId: string | null;
  toPlanId: string;
  priceSet: boolean;
  daysInPeriod: number;
  daysLeft: number;
  proratedPaise: number | null;
  gstPaise: number | null;
  totalPaise: number | null;
  newAllowances: { callMinutes: number | null; messages: number | null };
  /** The new allowance starts now; the period does not move. */
  effective: "now";
};

/** What a person is told when a move is refused (each has a word in tu.err.*). */
export type TopupError = "not_available" | "forbidden" | "mfa" | "read_only" | "invalid" | "declined" | "no_plan" | "pack_unknown" | "cap_required" | "not_an_upgrade" | "conflict";
export type TopupResult = { ok: true } | { ok: false; error: TopupError };
export type PreviewResult = { ok: true; preview: UpgradePreview } | { ok: false; error: TopupError };

export type TopupCtx = { token: string; tenantId: string };

/** The settings a person sends (all fields, like the API's PUT). */
export type SettingsInput = { autoMinutesPack: string | null; autoMessagesPack: string | null; autoMonthlyCapPaise: number; overageMinutes: boolean; overageMessages: boolean; overageMonthlyCapPaise: number };
