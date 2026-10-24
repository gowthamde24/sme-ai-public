/**
 * The one place that says who we are and how to reach us (job DB). The domain, the four public e-mail addresses, the business and the Grievance Officer are written HERE and nowhere else:
 * the contact page, every footer, the Privacy Policy, the Terms, the data-deletion page and the share/canonical addresses all read them from this file (a test fails if an address appears in
 * any other source file). No phone number and no postal address are published, by the owner's decision.
 *
 * Server and client safe: plain constants, no environment, no secret. The address app e-mails are SENT from is not here: it is the environment setting MAIL_FROM (docs/runbooks/hosting-env-and-secrets.md).
 */
export const DOMAIN = "stack19.com";
/** The address the public site is known by: canonical links, the sitemap, robots.txt host, Open Graph. (The address a deployment is SERVED from, used for the sign-in redirect, is NEXT_PUBLIC_SITE_URL in lib/seo/site.ts.) */
export const CANONICAL_ORIGIN = `https://${DOMAIN}`;

export const BUSINESS = {
  /** The trading name; the product is called the same (design/brand.ts). */
  name: "Stack19",
  proprietor: "Gowtham Reddy Sodanapalli",
  /** How the business is described in the legal texts. */
  description: "a sole proprietorship of Gowtham Reddy Sodanapalli, registered for GST in Andhra Pradesh, India",
} as const;

/** The days we take to answer a privacy request or a grievance (the promise made in the Privacy Policy and on the data-deletion page). */
export const GRIEVANCE_DAYS = 30;

/** The role of each public address, in the order the contact page lists them. */
export const ADDRESS_KEYS = ["hello", "support", "billing", "privacy"] as const;
export type AddressKey = (typeof ADDRESS_KEYS)[number];

export const ADDRESSES: Record<AddressKey, string> = {
  hello: `hello@${DOMAIN}`, // general contact
  support: `support@${DOMAIN}`, // help with the app
  billing: `billing@${DOMAIN}`, // payments and invoices
  privacy: `privacy@${DOMAIN}`, // privacy requests and grievances
};

/** The Grievance Officer named in the Privacy Policy (DPDP Act 2023). */
export const GRIEVANCE_OFFICER = { name: BUSINESS.proprietor, email: ADDRESSES.privacy } as const;

/** What the legal texts may name with a {token}: replaced when a text is drawn (components/v2/legal/LegalDoc.tsx). {brand} is added there from design/brand.ts. */
export const LEGAL_TOKENS: Readonly<Record<string, string>> = {
  hello: ADDRESSES.hello,
  support: ADDRESSES.support,
  billing: ADDRESSES.billing,
  privacy_email: ADDRESSES.privacy,
  proprietor: BUSINESS.proprietor,
  business_description: BUSINESS.description,
  grievance_days: String(GRIEVANCE_DAYS),
  domain: DOMAIN,
};
