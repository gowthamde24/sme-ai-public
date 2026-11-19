-- Free early access gets TWO Lead Finder searches a month, like Pay as you go (planner, 19 Nov 2026, owner's plans-and-pricing decision): no charges while early access lasts; the operator can still raise one
-- business's number (app.operator_set_lead_finder_limit) or the plan's (billing.plan_overrides.lead_finder_per_month).
update billing.plan_overrides set lead_finder_per_month = 2, updated_at = now() where plan_id = 'early_access';
