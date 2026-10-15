import type { SiteOut } from "@contracts";

import type { CompanyChoice } from "./CompanyPicker";

/** What the site form sends to its action (job CO). The site contact is a name and a number typed here; the action makes the contact for this customer (or keeps the one the site already has). */
export type SiteInput = {
  siteId: string;
  companyId: string;
  name: string;
  addressLine: string;
  city: string;
  pin: string;
  lat: string;
  lng: string;
  distanceKm: string;
  laneWidthFt: string;
  nightDelivery: boolean;
  unloadingHelp: boolean;
  accessNotes: string;
  active: boolean;
  /** "keep" = leave the site contact as it is; "new" = make a contact from `contactName` and `contactPhone`; "none" = no site contact. */
  contact: "keep" | "new" | "none";
  contactName: string;
  contactPhone: string;
};
export type SiteResult = { ok: true; site: SiteOut } | { ok: false; error: string; mfa?: boolean };
export type SiteActions = { save: (input: SiteInput) => Promise<SiteResult>; search: (q: string) => Promise<CompanyChoice[]> };
