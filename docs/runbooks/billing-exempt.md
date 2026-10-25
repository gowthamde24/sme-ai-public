# Workspaces that never lapse (job DP part 3)

Customer Zero and the demo workspaces are exempt from the read-only lapse: `access` is always `full`, `can_resume` is false, no reminder is sent, the worker runs them. The flag is `tenants.billing_exempt`, set only by the operator function `app.operator_billing_exempt(tenant_id, true)` (job DI); a client cannot write it. It matters only while the platform's billing switch (`billing_enforced`) is on.

## Staging: the three demo workspaces
`scripts/exempt_demo_workspaces.py` (dry run by default; `--apply` writes): looks up the demo workspaces of staging by the demo owners' addresses (`demo-textiles@demo.example.test` and the two others, made by `scripts/seed_staging.py`) and sets the flag through the linked project (`supabase db query --linked`). Staging only.

## Customer Zero (production)
Not done: there is no production project yet. When it exists, after the first sign-in of the owner, run once as the database owner:
```sql
select app.operator_billing_exempt(t.id, true) from public.tenants t where t.slug = '<customer-zero-slug>';
```
and check `select slug, billing_exempt from public.tenants where billing_exempt;`.

## Local demos
`make seed-demo` and the other seeds make fictional workspaces on a laptop where the billing switch is off; nothing lapses there. Turn the switch on only in a test that sets its own clock.
