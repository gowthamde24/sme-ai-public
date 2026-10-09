// Creates extra LOCAL demo users on the demo workspace (Admin, Sales, Viewer and two Sales "labelers"), so the walkthroughs
// can check roles and label 20 leads more than once (a label belongs to one reviewer). Local stack only.
import { supabasePublic, PW, totp, factorSecret, confirmEmail } from "./lib.mjs";

const { url, anon } = supabasePublic();
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) { console.error("e2e: not a local Supabase stack"); process.exit(2); }

async function call(method, route, body, token, extra = {}) {
  const r = await fetch(url + route, {
    method,
    headers: { apikey: anon, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await r.text();
  return { status: r.status, body: raw ? JSON.parse(raw) : null };
}

const owner = await call("POST", "/auth/v1/token?grant_type=password", { email: "demo-owner@demo.example.test", password: PW });
if (owner.status !== 200) { console.error("e2e: run `make seed-demo` first (the demo owner does not exist)."); process.exit(1); }
// ADR 0016: adding members is a privileged action, so the Owner answers the authenticator challenge first (the secret is read from the
// LOCAL database container, as the demo seed does).
let token = owner.body.access_token;
{
  const user = await call("GET", "/auth/v1/user", null, token);
  const factor = (user.body.factors || []).find((f) => f.status === "verified");
  if (factor) {
    const secret = factorSecret("demo-owner@demo.example.test");
    for (const offset of [0, 1, -1]) {
      const challenge = await call("POST", `/auth/v1/factors/${factor.id}/challenge`, {}, token);
      const verified = await call("POST", `/auth/v1/factors/${factor.id}/verify`, { challenge_id: challenge.body.id, code: totp(secret, offset) }, token);
      if (verified.status === 200) { token = verified.body.access_token; break; }
    }
  }
}
const tenants = await call("GET", "/rest/v1/tenants?slug=eq.demo-synthetic-sme&select=id", null, token);
const tenant = tenants.body[0].id;
for (const [name, role] of [["admin", "admin"], ["sales", "sales"], ["viewer", "viewer"], ["labeler1", "sales"], ["labeler2", "sales"]]) {
  const email = `demo-${name}@demo.example.test`;
  let u = await call("POST", "/auth/v1/token?grant_type=password", { email, password: PW });
  if (u.status !== 200) {
    await call("POST", "/auth/v1/signup", { email, password: PW });
    confirmEmail(email); // the local stack asks for e-mail confirmation; these are throwaway demo accounts
    u = await call("POST", "/auth/v1/token?grant_type=password", { email, password: PW });
  }
  const m = await call("POST", "/rest/v1/memberships", { tenant_id: tenant, user_id: u.body.user.id, role }, token, { Prefer: "return=minimal" });
  console.log(`${email} as ${role}: ${m.status === 201 ? "added" : m.status === 409 ? "already a member" : "HTTP " + m.status}`);
}

// ADR 0016: an Admin needs a second factor to cancel an erasure, export, or change settings. The local Admin gets an authenticator
// (the walkthroughs read its secret from the local database container and type the code, like a person would).
{
  const email = "demo-admin@demo.example.test";
  const session = await call("POST", "/auth/v1/token?grant_type=password", { email, password: PW });
  const bearerToken = session.body.access_token;
  const user = await call("GET", "/auth/v1/user", null, bearerToken);
  if ((user.body.factors || []).some((f) => f.status === "verified")) console.log(`${email}: authenticator already set up`);
  else {
    for (const stale of user.body.factors || []) await call("DELETE", `/auth/v1/factors/${stale.id}`, null, bearerToken);
    const enrolled = await call("POST", "/auth/v1/factors", { factor_type: "totp", friendly_name: "demo" }, bearerToken);
    const challenge = await call("POST", `/auth/v1/factors/${enrolled.body.id}/challenge`, {}, bearerToken);
    let ok = false;
    for (const offset of [0, 1, -1]) {
      const v = await call("POST", `/auth/v1/factors/${enrolled.body.id}/verify`, { challenge_id: challenge.body.id, code: totp(enrolled.body.totp.secret, offset) }, bearerToken);
      if (v.status === 200) { ok = true; break; }
      const again = await call("POST", `/auth/v1/factors/${enrolled.body.id}/challenge`, {}, bearerToken);
      challenge.body.id = again.body.id;
    }
    console.log(`${email}: authenticator ${ok ? "set up" : "FAILED"}`);
  }
}
