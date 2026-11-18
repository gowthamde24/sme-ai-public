# Free early access: what stops cost per business (18 Nov 2026)

Owner decision: real businesses use the product for free at launch; no billing. The allowances are ONE ROW (`billing.plan_overrides`), enforced by the existing meters:

| What | Value (owner, 18 Nov) | Where |
|---|---|---|
| call minutes a month | 60 | `billing.plan_overrides.call_minutes` |
| business-initiated WhatsApp messages a month | 300 | `billing.plan_overrides.whatsapp_messages` |
| numbers per business | 1 | the Plivo number routes (item 3 of the launch blockers) |
| AI | fair use, as `free_trial` (Rs 20 a day, Rs 300 a month, hard daily cap 3 times the day figure) | `public.plan_ai_allowances` |
| assistant requests that spend model money | 30 an hour (120 of any kind) | `agent_limits` / code default |

How it works: a workspace on the plan `early_access` never lapses (`tenants.billing_exempt` is set by the plan), its meters read the row, every finished real call records its seconds in 30-second pulses (a simulated call or the fake provider costs nothing), and the call paths refuse with `billing_blocked` when the meter is stopped. The meters stop anything ONLY while the platform switch `billing_enforced` is on; with it off they only count.

## Operator commands (run as the database owner; production only with the owner's explicit OK for each)
```sql
-- change the numbers (one row)
select app.operator_set_plan_allowance('early_access', 60, 300);
-- new workspaces start on early_access from now on (nothing changes until this is run)
select app.operator_set_new_tenant_plan('early_access');
-- put an existing workspace on it
update public.tenants set plan = 'early_access' where id = '<workspace id>';
-- enforce the allowances (staging first, for the test; production needs the owner's OK)
select app.operator_set_billing_enforced(true);
-- a friendly business that needs more this month: a top-up row (existing operator function)
select app.operator_billing_topup('<workspace id>', gen_random_uuid(), 'call_minutes', 30);
```
Check: `select * from public.billing_check_usage('<workspace id>', 'call_minutes')` as the Owner (or `billing_get`) shows used, allowance and state.

## What a business sees
At 80 percent a notice; at 100 percent that kind stops (a call is refused `billing_blocked`; an inbound caller gets a hang-up, so a short spoken line is a follow-up); business-initiated messages stay queued; replies inside the 24-hour window, quotes, orders, follow-ups and customers never stop.
