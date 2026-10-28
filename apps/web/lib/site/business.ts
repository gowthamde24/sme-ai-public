/**
 * The one place that says who we are and how to reach us (job DB). The domain, the four public e-mail addresses, the business and the Grievance Officer are written HERE and nowhere else:
 * the contact page, every footer, the Privacy Policy, the Terms, the data-deletion page and the share/canonical addresses all read them from this file (a test fails if an address appears in
 * any other source file). No phone number and no street address are published; the town and PIN (Ananthapuramu 515001) are named, as on the GST registration (owner decision of 28 Oct).
 *
 * Server and client safe: plain constants, no environment, no secret. The address app e-mails are SENT from is not here: it is the environment setting MAIL_FROM (docs/runbooks/hosting-env-and-secrets.md).
 */
export const DOMAIN = "stack19.com";
/** The address the public site is known by: canonical links, the sitemap, robots.txt host, Open Graph. (The address a deployment is SERVED from, used for the sign-in redirect, is NEXT_PUBLIC_SITE_URL in lib/seo/site.ts.) */
export const CANONICAL_ORIGIN = `https://${DOMAIN}`;

export const BUSINESS = {
  /** The trading name; the product is called the same (design/brand.ts). */
  name: "Stack19",
  proprietor: "SODANAPALLI GOWTHAM REDDY", // the name as on the GST registration (owner, 28 Oct)
  /** How the business is described in the legal texts. */
  /** The town and PIN as on the GST registration (owner, 28 Oct): no street address is published for now. */
  address: "Ananthapuramu, Andhra Pradesh 515001, India",
  description: "a sole proprietorship of SODANAPALLI GOWTHAM REDDY, Ananthapuramu, Andhra Pradesh 515001, India, registered for GST (trade name Stack19)",
} as const;

/**
 * The days we take to answer (the promise made in the Privacy Policy, on the data-deletion page and on the contact page; owner decision of 24 October, following counsel's note of 8 October):
 * a request to access, correct or erase personal data in `requests`; any other grievance in `grievances`. These two numbers are written here and nowhere else (a test checks).
 */
export const RESPONSE_DAYS = { requests: 7, grievances: 30 } as const;
/**
 * The hours we take to act on a withdrawal of consent (owner decision of 24 October, following counsel's note that withdrawal must be as easy as giving consent and acted on quickly): we stop messages, calls and campaigns to that person.
 * The do-not-contact option inside the app takes effect immediately (the Privacy Policy says so). Written here and nowhere else (a test checks).
 */
export const RESPONSE_HOURS = { withdrawal: 48 } as const;

/**
 * How long we keep what (job DQ, DPDP): the numbers the Privacy notice and the settings words state, the same ones the API enforces and publishes in `GET /v1/privacy/notice` (contract-dpdp.md, `retention`): a lapsed workspace
 * is read-only for `lapsedReadOnlyDays`, the Owner is e-mailed `erasureWarningHours` before it is erased, an account or workspace deletion can be cancelled for `deletionCancelDays`, and the security and audit log is kept `securityLogDays`
 * and then purged. Written here and nowhere else (a test checks).
 */
export const RETENTION = { lapsedReadOnlyDays: 90, erasureWarningHours: 48, deletionCancelDays: 7, securityLogDays: 365 } as const;

/** The role of each public address, in the order the contact page lists them. */
export const ADDRESS_KEYS = ["hello", "support", "billing", "privacy"] as const;
export type AddressKey = (typeof ADDRESS_KEYS)[number];

export const ADDRESSES: Record<AddressKey, string> = {
  hello: `hello@${DOMAIN}`, // general contact
  support: `support@${DOMAIN}`, // help with the app
  billing: `billing@${DOMAIN}`, // payments and invoices
  privacy: `privacy@${DOMAIN}`, // privacy requests and grievances
};

/** Where a security researcher or a customer reports a weakness (the Security page and /.well-known/security.txt). Not one of the contact page's addresses: it is only for reports. The owner makes the alias (security-report.md, "Needs owner"). */
export const SECURITY_ADDRESS = `security@${DOMAIN}`;

/** The Grievance Officer named in the Privacy Policy (DPDP Act 2023). */
export const GRIEVANCE_OFFICER = { name: BUSINESS.proprietor, email: ADDRESSES.privacy } as const;

/** What the legal texts may name with a {token}: replaced when a text is drawn (components/v2/legal/LegalDoc.tsx). {brand} is added there from design/brand.ts. */
export const LEGAL_TOKENS: Readonly<Record<string, string>> = {
  hello: ADDRESSES.hello,
  support: ADDRESSES.support,
  billing: ADDRESSES.billing,
  privacy_email: ADDRESSES.privacy,
  security_email: SECURITY_ADDRESS,
  proprietor: BUSINESS.proprietor,
  business_description: BUSINESS.description,
  request_days: String(RESPONSE_DAYS.requests),
  grievance_days: String(RESPONSE_DAYS.grievances),
  withdrawal_hours: String(RESPONSE_HOURS.withdrawal),
  lapsed_days: String(RETENTION.lapsedReadOnlyDays),
  erasure_warning_hours: String(RETENTION.erasureWarningHours),
  cancel_days: String(RETENTION.deletionCancelDays),
  log_days: String(RETENTION.securityLogDays),
  domain: DOMAIN,
};
