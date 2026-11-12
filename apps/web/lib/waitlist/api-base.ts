/**
 * Where the PUBLIC WEBSITE's waitlist form posts (and where its privacy notice version is read), decided by the SERVER at each request. `WAITLIST_API_BASE` is the production API's address (https, no staging or local host).
 * The image's own `NEXT_PUBLIC_API_BASE_URL` is fixed when it is built, and the live site image was built against staging, whose database holds synthetic data only (ADR 0015): so in website mode the form is
 * drawn and posts ONLY when this is set to a good address. Unset, or not good: no form (every "Book a demo" button leads to the contact page) and nothing is sent anywhere. Pure.
 */
export function waitlistApiBase(value: string | undefined = process.env.WAITLIST_API_BASE): string | null {
  const text = (value ?? "").trim().replace(/\/+$/, "");
  if (text === "") return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return null;
  if (host === "localhost" || host.endsWith(".local") || /(^|[.-])staging([.-]|$)/.test(host)) return null;
  return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}`;
}
