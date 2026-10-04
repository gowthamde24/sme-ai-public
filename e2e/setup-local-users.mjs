// Creates extra LOCAL demo users on the demo workspace (Admin, Sales, Viewer and two Sales "labelers"), so the walkthroughs
// can check roles and label 20 leads more than once (a label belongs to one reviewer). Local stack only.
import { supabasePublic, PW } from "./lib.mjs";

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
const token = owner.body.access_token;
const tenants = await call("GET", "/rest/v1/tenants?slug=eq.demo-synthetic-sme&select=id", null, token);
const tenant = tenants.body[0].id;
for (const [name, role] of [["admin", "admin"], ["sales", "sales"], ["viewer", "viewer"], ["labeler1", "sales"], ["labeler2", "sales"]]) {
  const email = `demo-${name}@demo.example.test`;
  let u = await call("POST", "/auth/v1/token?grant_type=password", { email, password: PW });
  if (u.status !== 200) u = await call("POST", "/auth/v1/signup", { email, password: PW });
  const m = await call("POST", "/rest/v1/memberships", { tenant_id: tenant, user_id: u.body.user.id, role }, token, { Prefer: "return=minimal" });
  console.log(`${email} as ${role}: ${m.status === 201 ? "added" : m.status === 409 ? "already a member" : "HTTP " + m.status}`);
}
